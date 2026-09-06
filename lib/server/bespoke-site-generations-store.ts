import { getPostgresPool } from "@/lib/server/postgres";

// Count of delivered bespoke pages per wallet (owner decisions, 6 Sep 2026:
// three generations per one-off purchase) — see
// db/migrations/035_bespoke_site_generations.sql. Follows the store shape used
// across lib/server: interface + fail-closed unconfigured fallback + test seam
// + memory + Postgres. The route records a row only after a page was actually
// streamed as complete, so a failed or rejected attempt never counts.

export type RecordBespokeSiteGenerationInput = {
  walletAddress: string;
  projectHash: string;
  model: string;
};

export interface BespokeSiteGenerationsStore {
  /** Delivered pages for this wallet, all time. */
  countForWallet(walletAddress: string): Promise<number>;
  record(input: RecordBespokeSiteGenerationInput): Promise<void>;
  /** Delivered pages across every wallet since `since`, for the admin health stage. */
  countSince(since: Date): Promise<number>;
  tableExists(): Promise<boolean>;
}

export class BespokeSiteGenerationsStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for bespoke site generation counting.");
    this.name = "BespokeSiteGenerationsStoreUnavailableError";
  }
}

const unconfiguredStore: BespokeSiteGenerationsStore = {
  async countForWallet() {
    throw new BespokeSiteGenerationsStoreUnavailableError();
  },
  async record() {
    throw new BespokeSiteGenerationsStoreUnavailableError();
  },
  async countSince() {
    return 0;
  },
  async tableExists() {
    return false;
  },
};

/** In-memory store for tests — same contract, no Postgres. */
export function createMemoryBespokeSiteGenerationsStore(): BespokeSiteGenerationsStore & {
  rows: Array<RecordBespokeSiteGenerationInput & { createdAt: Date }>;
} {
  const rows: Array<RecordBespokeSiteGenerationInput & { createdAt: Date }> = [];
  return {
    rows,
    async countForWallet(walletAddress) {
      const wallet = walletAddress.toLowerCase();
      return rows.filter((row) => row.walletAddress === wallet).length;
    },
    async record(input) {
      rows.push({ ...input, walletAddress: input.walletAddress.toLowerCase(), createdAt: new Date() });
    },
    async countSince(since) {
      return rows.filter((row) => row.createdAt.getTime() >= since.getTime()).length;
    },
    async tableExists() {
      return true;
    },
  };
}

let testStore: BespokeSiteGenerationsStore | null = null;
let productionStore: BespokeSiteGenerationsStore | null = null;
let productionDatabaseUrl = "";

export function setBespokeSiteGenerationsStoreForTests(store: BespokeSiteGenerationsStore): void {
  testStore = store;
}

export function resetBespokeSiteGenerationsStoreForTests(): void {
  testStore = null;
}

export function getBespokeSiteGenerationsStore(): BespokeSiteGenerationsStore {
  if (testStore) return testStore;
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresBespokeSiteGenerationsStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

export function createPostgresBespokeSiteGenerationsStore(databaseUrl: string): BespokeSiteGenerationsStore {
  const pool = getPostgresPool(databaseUrl);
  return {
    async countForWallet(walletAddress) {
      const result = await pool.query<{ count: string | number }>(
        `SELECT COUNT(*)::int AS count FROM bespoke_site_generations WHERE wallet_address = LOWER($1)`,
        [walletAddress],
      );
      return Number(result.rows[0]?.count ?? 0);
    },
    async record(input) {
      await pool.query(
        `INSERT INTO bespoke_site_generations (wallet_address, project_hash, model) VALUES (LOWER($1), $2, $3)`,
        [input.walletAddress, input.projectHash.toLowerCase(), input.model.slice(0, 64)],
      );
    },
    async countSince(since) {
      const result = await pool.query<{ count: string | number }>(
        `SELECT COUNT(*)::int AS count FROM bespoke_site_generations WHERE created_at >= $1::timestamptz`,
        [since],
      );
      return Number(result.rows[0]?.count ?? 0);
    },
    async tableExists() {
      const result = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bespoke_site_generations'`,
      );
      return result.rows.length > 0;
    },
  };
}
