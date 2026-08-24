import { getPostgresPool } from "@/lib/server/postgres";

// Server-side record of on-chain token launches (Milestone A, issue #409
// Part 2). Mirrors lib/server/support-tickets-store.ts's shape: interface +
// unconfigured fallback + test-injectable singleton + Postgres
// implementation. A row is only ever inserted after
// lib/server/token-launch-reconciliation.ts has independently confirmed the
// claim against a live on-chain read — this store trusts its caller to have
// already done that; it does not re-verify anything itself.

/** Server-side cap on how many launches a single list read ever returns. */
export const MAX_TOKEN_LAUNCHES_PER_PAGE = 100;
/** Server-side cap on the admin list. */
export const MAX_ADMIN_TOKEN_LAUNCHES = 200;

export type TokenLaunch = {
  id: string;
  chainId: number;
  tokenAddress: string;
  curveAddress: string;
  creatorWalletAddress: string;
  tokenName: string;
  ticker: string;
  decimals: number;
  wholeTokenSupply: string;
  graduationTargetWei: string;
  graduated: boolean;
  graduatedAt: string | null;
  launchedAt: string;
};

export type RecordTokenLaunchInput = {
  chainId: number;
  tokenAddress: string;
  curveAddress: string;
  creatorWalletAddress: string;
  tokenName: string;
  ticker: string;
  decimals: number;
  wholeTokenSupply: string;
  graduationTargetWei: string;
};

export type ListTokenLaunchesFilter = "all" | "bonding" | "graduated";

export interface TokenLaunchesStore {
  /** Inserts a new launch, or returns the existing row unchanged if (chainId, tokenAddress) was already recorded — idempotent under a double-submitted request. */
  record(input: RecordTokenLaunchInput): Promise<TokenLaunch>;
  list(filter: ListTokenLaunchesFilter, limit: number): Promise<TokenLaunch[]>;
  listForAdmin(): Promise<TokenLaunch[]>;
  /** Marks a launch graduated. A no-op (not an error) once already graduated, so an opportunistic re-check from the read API never double-writes. */
  markGraduated(chainId: number, tokenAddress: string, graduatedAt: Date): Promise<void>;
  countLast24h(): Promise<number>;
  tableExists(): Promise<boolean>;
}

export class TokenLaunchesStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for token launches.");
    this.name = "TokenLaunchesStoreUnavailableError";
  }
}

const unconfiguredStore: TokenLaunchesStore = {
  async record() {
    throw new TokenLaunchesStoreUnavailableError();
  },
  async list() {
    return [];
  },
  async listForAdmin() {
    return [];
  },
  async markGraduated() {
    // Best-effort refresh; nothing to do without storage configured.
  },
  async countLast24h() {
    return 0;
  },
  async tableExists() {
    return false;
  },
};

let testStore: TokenLaunchesStore | null = null;
let productionStore: TokenLaunchesStore | null = null;
let productionDatabaseUrl = "";

export function setTokenLaunchesStoreForTests(store: TokenLaunchesStore): void {
  testStore = store;
}

export function resetTokenLaunchesStoreForTests(): void {
  testStore = null;
}

export function getTokenLaunchesStore(): TokenLaunchesStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresTokenLaunchesStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

type LaunchRow = {
  id: string;
  chain_id: number | string;
  token_address: string;
  curve_address: string;
  creator_wallet_address: string;
  token_name: string;
  ticker: string;
  decimals: number;
  whole_token_supply: string;
  graduation_target_wei: string;
  graduated: boolean;
  graduated_at: Date | string | null;
  launched_at: Date | string;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function launchFromRow(row: LaunchRow): TokenLaunch {
  return {
    id: row.id,
    chainId: Number(row.chain_id),
    tokenAddress: row.token_address,
    curveAddress: row.curve_address,
    creatorWalletAddress: row.creator_wallet_address,
    tokenName: row.token_name,
    ticker: row.ticker,
    decimals: row.decimals,
    wholeTokenSupply: row.whole_token_supply,
    graduationTargetWei: row.graduation_target_wei,
    graduated: row.graduated,
    graduatedAt: row.graduated_at ? asDate(row.graduated_at).toISOString() : null,
    launchedAt: asDate(row.launched_at).toISOString(),
  };
}

const LAUNCH_COLUMNS = `id, chain_id, token_address, curve_address, creator_wallet_address, token_name, ticker, decimals, whole_token_supply, graduation_target_wei, graduated, graduated_at, launched_at`;

export function createPostgresTokenLaunchesStore(databaseUrl: string): TokenLaunchesStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async record(input) {
      const result = await pool.query<LaunchRow>(
        `INSERT INTO token_launches (
           chain_id, token_address, curve_address, creator_wallet_address,
           token_name, ticker, decimals, whole_token_supply, graduation_target_wei
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (chain_id, token_address) DO UPDATE SET chain_id = token_launches.chain_id
         RETURNING ${LAUNCH_COLUMNS}`,
        [
          input.chainId,
          input.tokenAddress,
          input.curveAddress,
          input.creatorWalletAddress,
          input.tokenName,
          input.ticker,
          input.decimals,
          input.wholeTokenSupply,
          input.graduationTargetWei,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("The token launch could not be recorded.");
      return launchFromRow(row);
    },

    async list(filter, limit) {
      const bounded = Math.max(1, Math.min(limit, MAX_TOKEN_LAUNCHES_PER_PAGE));
      if (filter === "all") {
        const result = await pool.query<LaunchRow>(
          `SELECT ${LAUNCH_COLUMNS} FROM token_launches ORDER BY launched_at DESC LIMIT $1`,
          [bounded],
        );
        return result.rows.map(launchFromRow);
      }
      const result = await pool.query<LaunchRow>(
        `SELECT ${LAUNCH_COLUMNS} FROM token_launches WHERE graduated = $1 ORDER BY launched_at DESC LIMIT $2`,
        [filter === "graduated", bounded],
      );
      return result.rows.map(launchFromRow);
    },

    async listForAdmin() {
      const result = await pool.query<LaunchRow>(
        `SELECT ${LAUNCH_COLUMNS} FROM token_launches ORDER BY launched_at DESC LIMIT $1`,
        [MAX_ADMIN_TOKEN_LAUNCHES],
      );
      return result.rows.map(launchFromRow);
    },

    async markGraduated(chainId, tokenAddress, graduatedAt) {
      await pool.query(
        `UPDATE token_launches
            SET graduated = TRUE, graduated_at = $3
          WHERE chain_id = $1 AND token_address = $2 AND graduated = FALSE`,
        [chainId, tokenAddress, graduatedAt],
      );
    },

    async countLast24h() {
      const result = await pool.query<{ count: number | string }>(
        `SELECT COUNT(*)::int AS count FROM token_launches WHERE launched_at >= NOW() - INTERVAL '24 hours'`,
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async tableExists() {
      const result = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'token_launches'`,
      );
      return result.rows.length > 0;
    },
  };
}
