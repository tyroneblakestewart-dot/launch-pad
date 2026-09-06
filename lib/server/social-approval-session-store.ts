import { getPostgresPool } from "@/lib/server/postgres";

// Approval sessions (owner direction, 6 Sep 2026): one wallet signature
// unlocks post approvals for a day — see db/migrations/034_social_approval_sessions.sql.
// Follows lib/server/user-accounts-store.ts's session half: interface +
// fail-closed unconfigured fallback + test seam + memory + Postgres. Only the
// token's SHA-256 ever reaches the store.

export type ApprovalSession = {
  walletAddress: string;
  expiresAt: string;
};

export interface SocialApprovalSessionStore {
  create(walletAddress: string, sessionTokenHash: string, expiresAt: Date): Promise<void>;
  /** The live (unexpired, unrevoked) session behind a token hash, or null. */
  get(sessionTokenHash: string, now?: Date): Promise<ApprovalSession | null>;
  revoke(sessionTokenHash: string, now?: Date): Promise<void>;
  /** Live sessions right now, for the admin health stage. */
  countActive(now?: Date): Promise<number>;
  tableExists(): Promise<boolean>;
}

export class SocialApprovalSessionStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for Social Studio approval sessions.");
    this.name = "SocialApprovalSessionStoreUnavailableError";
  }
}

const unconfiguredStore: SocialApprovalSessionStore = {
  async create() {
    throw new SocialApprovalSessionStoreUnavailableError();
  },
  // A read failing closed: no session, so the caller asks for a signature.
  async get() {
    return null;
  },
  async revoke() {},
  async countActive() {
    return 0;
  },
  async tableExists() {
    return false;
  },
};

type MemoryRow = { walletAddress: string; expiresAt: Date; revokedAt: Date | null };

/** In-memory store for tests — same contract, no Postgres. */
export function createMemorySocialApprovalSessionStore(): SocialApprovalSessionStore {
  const rows = new Map<string, MemoryRow>();
  return {
    async create(walletAddress, sessionTokenHash, expiresAt) {
      rows.set(sessionTokenHash, { walletAddress: walletAddress.toLowerCase(), expiresAt, revokedAt: null });
    },
    async get(sessionTokenHash, now = new Date()) {
      const row = rows.get(sessionTokenHash);
      if (!row || row.revokedAt || row.expiresAt.getTime() <= now.getTime()) return null;
      return { walletAddress: row.walletAddress, expiresAt: row.expiresAt.toISOString() };
    },
    async revoke(sessionTokenHash, now = new Date()) {
      const row = rows.get(sessionTokenHash);
      if (row && !row.revokedAt) row.revokedAt = now;
    },
    async countActive(now = new Date()) {
      return [...rows.values()].filter((row) => !row.revokedAt && row.expiresAt.getTime() > now.getTime()).length;
    },
    async tableExists() {
      return true;
    },
  };
}

let testStore: SocialApprovalSessionStore | null = null;
let productionStore: SocialApprovalSessionStore | null = null;
let productionDatabaseUrl = "";

export function setSocialApprovalSessionStoreForTests(store: SocialApprovalSessionStore): void {
  testStore = store;
}

export function resetSocialApprovalSessionStoreForTests(): void {
  testStore = null;
}

export function getSocialApprovalSessionStore(): SocialApprovalSessionStore {
  if (testStore) return testStore;
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresSocialApprovalSessionStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

type SessionRow = { wallet_address: string; expires_at: Date | string };

export function createPostgresSocialApprovalSessionStore(databaseUrl: string): SocialApprovalSessionStore {
  const pool = getPostgresPool(databaseUrl);
  return {
    async create(walletAddress, sessionTokenHash, expiresAt) {
      await pool.query(
        `INSERT INTO social_approval_sessions (session_token_hash, wallet_address, expires_at)
         VALUES ($1, LOWER($2), $3::timestamptz)`,
        [sessionTokenHash, walletAddress, expiresAt],
      );
    },
    async get(sessionTokenHash, now = new Date()) {
      const result = await pool.query<SessionRow>(
        `SELECT wallet_address, expires_at FROM social_approval_sessions
          WHERE session_token_hash = $1 AND revoked_at IS NULL AND expires_at > $2::timestamptz`,
        [sessionTokenHash, now],
      );
      const row = result.rows[0];
      if (!row) return null;
      return { walletAddress: row.wallet_address, expiresAt: new Date(row.expires_at).toISOString() };
    },
    async revoke(sessionTokenHash, now = new Date()) {
      await pool.query(
        `UPDATE social_approval_sessions SET revoked_at = $2::timestamptz WHERE session_token_hash = $1 AND revoked_at IS NULL`,
        [sessionTokenHash, now],
      );
    },
    async countActive(now = new Date()) {
      const result = await pool.query<{ count: string | number }>(
        `SELECT COUNT(*)::int AS count FROM social_approval_sessions WHERE revoked_at IS NULL AND expires_at > $1::timestamptz`,
        [now],
      );
      return Number(result.rows[0]?.count ?? 0);
    },
    async tableExists() {
      const result = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'social_approval_sessions'`,
      );
      return result.rows.length > 0;
    },
  };
}
