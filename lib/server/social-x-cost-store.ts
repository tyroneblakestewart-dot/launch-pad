import { getPostgresPool } from "@/lib/server/postgres";

// Per-wallet monthly X API spend tracking (issue #342). X's pay-per-use
// pricing means every successful X API send has a real dollar cost — this
// store records one row per send (db/migrations/019_social_x_cost_control.sql)
// so the posting cron can refuse to spend past an owner-configured monthly
// cap per wallet, and /admin can show the running total. Link-bearing posts
// never reach this store at all: they're routed to the free composer before
// any cost is incurred (see lib/server/social-link-detection.ts and
// social-posting-cron.ts).
//
// Mirrors the interface + unconfigured fallback + test-injectable singleton
// + Postgres implementation shape used by every other social-studio store
// (social-connections-store.ts, social-scheduled-posts-store.ts).

export const DEFAULT_X_API_SEND_COST_USD = 0.015;
export const DEFAULT_X_MONTHLY_COST_CAP_USD = 5;

function readPositiveFloat(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat((raw || "").trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function readXApiSendCostUsd(env: Record<string, string | undefined> = process.env): number {
  return readPositiveFloat(env.SOCIAL_X_API_SEND_COST_USD, DEFAULT_X_API_SEND_COST_USD);
}

export function readXMonthlyCostCapUsd(env: Record<string, string | undefined> = process.env): number {
  return readPositiveFloat(env.SOCIAL_X_MONTHLY_COST_CAP_USD, DEFAULT_X_MONTHLY_COST_CAP_USD);
}

/** [inclusive start, exclusive end) of the UTC calendar month containing `now`. */
export function monthBoundsUtc(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export type WalletMonthlyXCost = {
  walletAddress: string;
  totalUsd: number;
  sendCount: number;
};

export interface SocialXCostStore {
  /** Records one successful X API send's cost against the wallet that owns it. */
  recordSend(walletAddress: string, destinationId: string, costUsd: number, now: Date): Promise<void>;
  /** Sum of costUsd already spent by this wallet in the UTC calendar month containing `now`. */
  monthlyTotalUsd(walletAddress: string, now: Date): Promise<number>;
  /** Per-wallet totals for the UTC calendar month containing `now`, for /admin visibility. */
  monthlyTotalsAllWallets(now: Date): Promise<WalletMonthlyXCost[]>;
}

const unconfiguredStore: SocialXCostStore = {
  async recordSend() {},
  async monthlyTotalUsd() {
    return 0;
  },
  async monthlyTotalsAllWallets() {
    return [];
  },
};

let testStore: SocialXCostStore | null = null;
let productionStore: SocialXCostStore | null = null;
let productionDatabaseUrl = "";

export function setSocialXCostStoreForTests(store: SocialXCostStore): void {
  testStore = store;
}

export function resetSocialXCostStoreForTests(): void {
  testStore = null;
}

export function getSocialXCostStore(): SocialXCostStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresSocialXCostStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

export function createPostgresSocialXCostStore(databaseUrl: string): SocialXCostStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async recordSend(walletAddress, destinationId, costUsd, now) {
      await pool.query(
        `INSERT INTO social_x_send_costs (wallet_address, destination_id, cost_usd, sent_at) VALUES ($1, $2, $3, $4)`,
        [walletAddress, destinationId, costUsd, now],
      );
    },

    async monthlyTotalUsd(walletAddress, now) {
      const { start, end } = monthBoundsUtc(now);
      const result = await pool.query<{ total: string | null }>(
        `SELECT SUM(cost_usd)::text AS total FROM social_x_send_costs
          WHERE LOWER(wallet_address) = LOWER($1) AND sent_at >= $2 AND sent_at < $3`,
        [walletAddress, start, end],
      );
      return Number.parseFloat(result.rows[0]?.total || "0") || 0;
    },

    async monthlyTotalsAllWallets(now) {
      const { start, end } = monthBoundsUtc(now);
      const result = await pool.query<{ wallet_address: string; total: string; send_count: string }>(
        `SELECT wallet_address, SUM(cost_usd)::text AS total, COUNT(*)::text AS send_count
           FROM social_x_send_costs
          WHERE sent_at >= $1 AND sent_at < $2
          GROUP BY wallet_address
          ORDER BY SUM(cost_usd) DESC`,
        [start, end],
      );
      return result.rows.map((row) => ({
        walletAddress: row.wallet_address,
        totalUsd: Number.parseFloat(row.total) || 0,
        sendCount: Number.parseInt(row.send_count, 10) || 0,
      }));
    },
  };
}
