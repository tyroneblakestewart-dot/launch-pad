import { getAddress } from "viem";
import { getPostgresPool } from "@/lib/server/postgres";

// Data-only store for Street Team add-on interest capture (issue #343).
// Origin/rate-limit checks and wallet-address format validation live in the
// API route before any of these methods are called.

export const STREET_TEAM_INTEREST_PLANS = [
  "free",
  "bond",
  "bond_site",
  "bond_pro_site",
  "pro",
  "pro_bundle",
] as const;

export type StreetTeamInterestPlan = (typeof STREET_TEAM_INTEREST_PLANS)[number];

export function isStreetTeamInterestPlan(value: unknown): value is StreetTeamInterestPlan {
  return typeof value === "string" && (STREET_TEAM_INTEREST_PLANS as readonly string[]).includes(value);
}

export type StreetTeamInterestRecord = {
  id: string;
  walletAddress: string | null;
  currentPlan: StreetTeamInterestPlan;
  createdAt: string;
};

export type StreetTeamInterestSnapshot = {
  status: "ready" | "unavailable";
  message: string;
  count: number;
  recent: StreetTeamInterestRecord[];
};

export interface StreetTeamInterestStore {
  /** Idempotent per wallet — registering the same connected wallet twice never creates a duplicate row. */
  recordInterest(walletAddress: string | null): Promise<StreetTeamInterestRecord>;
  hasInterest(walletAddress: string): Promise<boolean>;
  listRecent(limit?: number): Promise<StreetTeamInterestSnapshot>;
}

export class StreetTeamInterestStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for Street Team interest capture.");
    this.name = "StreetTeamInterestStoreUnavailableError";
  }
}

const unconfiguredStore: StreetTeamInterestStore = {
  async recordInterest() {
    throw new StreetTeamInterestStoreUnavailableError();
  },
  async hasInterest() {
    return false;
  },
  async listRecent() {
    return {
      status: "unavailable",
      message: "DATABASE_URL is not configured.",
      count: 0,
      recent: [],
    };
  },
};

let testStore: StreetTeamInterestStore | null = null;
let productionStore: StreetTeamInterestStore | null = null;
let productionDatabaseUrl = "";

export function setStreetTeamInterestStoreForTests(store: StreetTeamInterestStore): void {
  testStore = store;
}

export function resetStreetTeamInterestStoreForTests(): void {
  testStore = null;
}

export function getStreetTeamInterestStore(): StreetTeamInterestStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresStreetTeamInterestStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

type InterestRow = {
  id: string;
  wallet_address: string | null;
  current_plan: string;
  created_at: Date | string;
};

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function recordFromRow(row: InterestRow): StreetTeamInterestRecord {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    currentPlan: isStreetTeamInterestPlan(row.current_plan) ? row.current_plan : "free",
    createdAt: asIso(row.created_at),
  };
}

export function createPostgresStreetTeamInterestStore(databaseUrl: string): StreetTeamInterestStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async recordInterest(walletAddress: string | null): Promise<StreetTeamInterestRecord> {
      const normalised = walletAddress ? getAddress(walletAddress).toLowerCase() : null;

      const planResult = normalised
        ? await pool.query<{ tier: string | null }>(
            `SELECT tier FROM subscriptions WHERE wallet_address = $1`,
            [normalised],
          )
        : null;
      const rowTier = planResult?.rows[0]?.tier ?? null;
      const currentPlan: StreetTeamInterestPlan = isStreetTeamInterestPlan(rowTier) ? rowTier : "free";

      const inserted = await pool.query<InterestRow>(
        `INSERT INTO street_team_interest (wallet_address, current_plan)
         VALUES ($1, $2)
         ON CONFLICT (wallet_address) WHERE wallet_address IS NOT NULL
         DO UPDATE SET current_plan = EXCLUDED.current_plan
         RETURNING id, wallet_address, current_plan, created_at`,
        [normalised, currentPlan],
      );
      const record = recordFromRow(inserted.rows[0]);
      return record;
    },

    async hasInterest(walletAddress: string): Promise<boolean> {
      const normalised = getAddress(walletAddress).toLowerCase();
      const result = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM street_team_interest WHERE wallet_address = $1) AS exists`,
        [normalised],
      );
      return Boolean(result.rows[0]?.exists);
    },

    async listRecent(limit = 25): Promise<StreetTeamInterestSnapshot> {
      try {
        const [countResult, recentResult] = await Promise.all([
          pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM street_team_interest`),
          pool.query<InterestRow>(
            `SELECT id, wallet_address, current_plan, created_at
               FROM street_team_interest
              ORDER BY created_at DESC
              LIMIT $1`,
            [limit],
          ),
        ]);
        return {
          status: "ready",
          message: "Live Street Team interest signups from Postgres.",
          count: Number(countResult.rows[0]?.count ?? 0),
          recent: recentResult.rows.map(recordFromRow),
        };
      } catch {
        return {
          status: "unavailable",
          message: "Street Team interest data could not be loaded. Apply migration 019_street_team_interest.sql and try again.",
          count: 0,
          recent: [],
        };
      }
    },
  };
}
