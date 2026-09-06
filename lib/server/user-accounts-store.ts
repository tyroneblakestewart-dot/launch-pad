import { getPostgresPool } from "@/lib/server/postgres";

// Google sign-in accounts and their sessions (phase 1, owner direction 6 Sep
// 2026) — see db/migrations/033_user_accounts.sql. A Google account is a
// linked credential to a wallet, never a second identity: at most one wallet
// per account and one account per wallet, enforced here and by the partial
// unique index. Follows the store shape used everywhere else in this repo:
// interface + fail-safe unconfigured fallback (reads return empty, writes
// throw) + test seam + Postgres.

export type UserAccount = {
  id: string;
  googleSub: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  linkedWalletAddress: string | null;
  walletLinkedAt: string | null;
  lastSignInAt: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertGoogleAccountInput = {
  googleSub: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
};

export type LinkWalletResult =
  | { status: "linked"; account: UserAccount }
  | { status: "account_not_found" }
  /** The wallet is already bound to a different Google account. */
  | { status: "wallet_taken" };

export type UserAccountCounts = { accounts: number; linked: number; signedIn7d: number };

export interface UserAccountsStore {
  /** Creates the account on first sign-in, or refreshes email/name and stamps last_sign_in_at on a return visit. */
  upsertGoogleAccount(input: UpsertGoogleAccountInput, now?: Date): Promise<UserAccount>;
  getById(accountId: string): Promise<UserAccount | null>;
  findByWallet(walletAddress: string): Promise<UserAccount | null>;
  linkWallet(accountId: string, walletAddress: string, now?: Date): Promise<LinkWalletResult>;
  unlinkWallet(accountId: string): Promise<void>;
  /** Removes the account and (by cascade) every session. */
  deleteAccount(accountId: string): Promise<void>;
  createSession(accountId: string, sessionTokenHash: string, expiresAt: Date): Promise<void>;
  /** The account a live (unexpired) session belongs to, or null. */
  getSessionAccount(sessionTokenHash: string, now?: Date): Promise<UserAccount | null>;
  destroySession(sessionTokenHash: string): Promise<void>;
  /** Signs the account out everywhere. */
  destroyAccountSessions(accountId: string): Promise<void>;
  listForAdmin(limit: number): Promise<UserAccount[]>;
  counts(now?: Date): Promise<UserAccountCounts>;
  tableExists(): Promise<boolean>;
}

export class UserAccountsStoreUnavailableError extends Error {
  constructor() {
    super("Account storage is not configured on this deployment.");
    this.name = "UserAccountsStoreUnavailableError";
  }
}

const unconfiguredStore: UserAccountsStore = {
  async upsertGoogleAccount() {
    throw new UserAccountsStoreUnavailableError();
  },
  async getById() {
    return null;
  },
  async findByWallet() {
    return null;
  },
  async linkWallet() {
    throw new UserAccountsStoreUnavailableError();
  },
  async unlinkWallet() {
    throw new UserAccountsStoreUnavailableError();
  },
  async deleteAccount() {
    throw new UserAccountsStoreUnavailableError();
  },
  async createSession() {
    throw new UserAccountsStoreUnavailableError();
  },
  async getSessionAccount() {
    return null;
  },
  async destroySession() {
    // Nothing to destroy without storage — logout still clears the cookie.
  },
  async destroyAccountSessions() {
    // Same.
  },
  async listForAdmin() {
    return [];
  },
  async counts() {
    return { accounts: 0, linked: 0, signedIn7d: 0 };
  },
  async tableExists() {
    return false;
  },
};

let testStore: UserAccountsStore | null = null;
let productionStore: UserAccountsStore | null = null;
let productionDatabaseUrl = "";

export function setUserAccountsStoreForTests(store: UserAccountsStore): void {
  testStore = store;
}

export function resetUserAccountsStoreForTests(): void {
  testStore = null;
}

export function getUserAccountsStore(): UserAccountsStore {
  if (testStore) return testStore;
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresUserAccountsStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

type AccountRow = {
  id: string;
  google_sub: string;
  email: string;
  email_verified: boolean;
  display_name: string;
  linked_wallet_address: string | null;
  wallet_linked_at: Date | string | null;
  last_sign_in_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
};

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function accountFromRow(row: AccountRow): UserAccount {
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    displayName: row.display_name,
    linkedWalletAddress: row.linked_wallet_address,
    walletLinkedAt: row.wallet_linked_at ? iso(row.wallet_linked_at) : null,
    lastSignInAt: iso(row.last_sign_in_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const ACCOUNT_COLUMNS = `id, google_sub, email, email_verified, display_name, linked_wallet_address, wallet_linked_at, last_sign_in_at, created_at, updated_at`;

/** Postgres raises 23505 on the partial unique index when a wallet is already bound to another account. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export function createPostgresUserAccountsStore(databaseUrl: string): UserAccountsStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async upsertGoogleAccount(input, now = new Date()) {
      const result = await pool.query<AccountRow>(
        `INSERT INTO user_accounts (google_sub, email, email_verified, display_name, last_sign_in_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz)
         ON CONFLICT (google_sub) DO UPDATE SET
           email = EXCLUDED.email,
           email_verified = EXCLUDED.email_verified,
           display_name = EXCLUDED.display_name,
           last_sign_in_at = EXCLUDED.last_sign_in_at,
           updated_at = NOW()
         RETURNING ${ACCOUNT_COLUMNS}`,
        [input.googleSub, input.email, input.emailVerified, input.displayName, now],
      );
      return accountFromRow(result.rows[0]);
    },

    async getById(accountId) {
      const result = await pool.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM user_accounts WHERE id = $1`, [accountId]);
      return result.rows[0] ? accountFromRow(result.rows[0]) : null;
    },

    async findByWallet(walletAddress) {
      const result = await pool.query<AccountRow>(
        `SELECT ${ACCOUNT_COLUMNS} FROM user_accounts WHERE LOWER(linked_wallet_address) = LOWER($1)`,
        [walletAddress],
      );
      return result.rows[0] ? accountFromRow(result.rows[0]) : null;
    },

    async linkWallet(accountId, walletAddress, now = new Date()) {
      try {
        const result = await pool.query<AccountRow>(
          `UPDATE user_accounts
              SET linked_wallet_address = $2, wallet_linked_at = $3::timestamptz, updated_at = NOW()
            WHERE id = $1
            RETURNING ${ACCOUNT_COLUMNS}`,
          [accountId, walletAddress, now],
        );
        const row = result.rows[0];
        return row ? { status: "linked", account: accountFromRow(row) } : { status: "account_not_found" };
      } catch (error) {
        if (isUniqueViolation(error)) return { status: "wallet_taken" };
        throw error;
      }
    },

    async unlinkWallet(accountId) {
      await pool.query(
        `UPDATE user_accounts SET linked_wallet_address = NULL, wallet_linked_at = NULL, updated_at = NOW() WHERE id = $1`,
        [accountId],
      );
    },

    async deleteAccount(accountId) {
      await pool.query(`DELETE FROM user_accounts WHERE id = $1`, [accountId]);
    },

    async createSession(accountId, sessionTokenHash, expiresAt) {
      await pool.query(
        `INSERT INTO user_sessions (session_token_hash, account_id, expires_at) VALUES ($1, $2, $3::timestamptz)`,
        [sessionTokenHash, accountId, expiresAt],
      );
    },

    async getSessionAccount(sessionTokenHash, now = new Date()) {
      const result = await pool.query<AccountRow>(
        `SELECT ${ACCOUNT_COLUMNS.split(", ").map((column) => `a.${column}`).join(", ")}
           FROM user_sessions s
           JOIN user_accounts a ON a.id = s.account_id
          WHERE s.session_token_hash = $1 AND s.expires_at > $2::timestamptz`,
        [sessionTokenHash, now],
      );
      return result.rows[0] ? accountFromRow(result.rows[0]) : null;
    },

    async destroySession(sessionTokenHash) {
      await pool.query(`DELETE FROM user_sessions WHERE session_token_hash = $1`, [sessionTokenHash]);
    },

    async destroyAccountSessions(accountId) {
      await pool.query(`DELETE FROM user_sessions WHERE account_id = $1`, [accountId]);
    },

    async listForAdmin(limit) {
      const result = await pool.query<AccountRow>(
        `SELECT ${ACCOUNT_COLUMNS} FROM user_accounts ORDER BY last_sign_in_at DESC LIMIT $1`,
        [Math.max(1, Math.min(500, Math.floor(limit)))],
      );
      return result.rows.map(accountFromRow);
    },

    async counts(now = new Date()) {
      const result = await pool.query<{ accounts: number | string; linked: number | string; signed_in_7d: number | string }>(
        `SELECT COUNT(*)::int AS accounts,
                COUNT(linked_wallet_address)::int AS linked,
                COUNT(*) FILTER (WHERE last_sign_in_at >= $1::timestamptz - INTERVAL '7 days')::int AS signed_in_7d
           FROM user_accounts`,
        [now],
      );
      const row = result.rows[0];
      return { accounts: Number(row?.accounts ?? 0), linked: Number(row?.linked ?? 0), signedIn7d: Number(row?.signed_in_7d ?? 0) };
    },

    async tableExists() {
      const result = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('user_accounts', 'user_sessions')`,
      );
      return result.rows.length === 2;
    },
  };
}

/** Client-facing projection: what the account panel needs, never the Google id. */
export function toAccountSummary(account: UserAccount) {
  return {
    email: account.email,
    emailVerified: account.emailVerified,
    displayName: account.displayName,
    linkedWalletAddress: account.linkedWalletAddress,
    walletLinkedAt: account.walletLinkedAt,
  };
}
