import { getPostgresPool } from "@/lib/server/postgres";
import {
  decryptSocialCredentials,
  encryptSocialCredentials,
} from "@/lib/server/social-credentials-crypto";

// Durable per-wallet X/Telegram connection storage (issue #335). Mirrors
// lib/server/outreach-store.ts's shape: interface + unconfigured fallback +
// test-injectable singleton + Postgres implementation. Credentials are
// encrypted before ever reaching a query parameter — see
// lib/server/social-credentials-crypto.ts.

export type SocialPlatform = "x" | "telegram";
export type SocialConnectionStatus = "connected" | "reconnect_needed";

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return value === "x" || value === "telegram";
}

export type SocialConnection = {
  id: string;
  walletAddress: string;
  platform: SocialPlatform;
  status: SocialConnectionStatus;
  displayName: string;
  externalId: string;
  reconnectReason: string | null;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
};

export type UpsertSocialConnectionInput = {
  walletAddress: string;
  platform: SocialPlatform;
  displayName: string;
  externalId: string;
  /** Plaintext credential payload (e.g. JSON-encoded X token pair, or a Telegram chat id) — encrypted before storage. */
  credentials: string;
};

export type GetSocialCredentialsResult =
  | { status: "ok"; plaintext: string }
  | { status: "not_found" }
  | { status: "invalid" };

export type XOAuthRequestRecord = {
  id: string;
  walletAddress: string;
  requestToken: string;
  requestSecret: string;
  expiresAt: Date;
};

export type ConsumeXOAuthRequestResult =
  | { status: "ok"; walletAddress: string; requestSecret: string }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "replayed" };

export interface SocialConnectionsStore {
  get(walletAddress: string, platform: SocialPlatform): Promise<SocialConnection | null>;
  list(walletAddress: string): Promise<SocialConnection[]>;
  upsert(input: UpsertSocialConnectionInput): Promise<SocialConnection>;
  getCredentials(walletAddress: string, platform: SocialPlatform): Promise<GetSocialCredentialsResult>;
  markReconnectNeeded(walletAddress: string, platform: SocialPlatform, reason: string): Promise<void>;
  recordFailure(walletAddress: string, platform: SocialPlatform, reason: string, threshold: number): Promise<void>;
  resetFailures(walletAddress: string, platform: SocialPlatform): Promise<void>;
  delete(walletAddress: string, platform: SocialPlatform): Promise<void>;
  createXOAuthRequest(input: { walletAddress: string; requestToken: string; requestSecret: string; expiresAt: Date }): Promise<void>;
  consumeXOAuthRequest(requestToken: string, now?: Date): Promise<ConsumeXOAuthRequestResult>;
}

export class SocialConnectionsStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for Social Studio connections.");
    this.name = "SocialConnectionsStoreUnavailableError";
  }
}

const unconfiguredStore: SocialConnectionsStore = {
  async get() {
    return null;
  },
  async list() {
    return [];
  },
  async upsert() {
    throw new SocialConnectionsStoreUnavailableError();
  },
  async getCredentials() {
    return { status: "not_found" };
  },
  async markReconnectNeeded() {
    throw new SocialConnectionsStoreUnavailableError();
  },
  async recordFailure() {
    throw new SocialConnectionsStoreUnavailableError();
  },
  async resetFailures() {
    throw new SocialConnectionsStoreUnavailableError();
  },
  async delete() {
    throw new SocialConnectionsStoreUnavailableError();
  },
  async createXOAuthRequest() {
    throw new SocialConnectionsStoreUnavailableError();
  },
  async consumeXOAuthRequest() {
    return { status: "not_found" };
  },
};

let testStore: SocialConnectionsStore | null = null;
let productionStore: SocialConnectionsStore | null = null;
let productionDatabaseUrl = "";

export function setSocialConnectionsStoreForTests(store: SocialConnectionsStore): void {
  testStore = store;
}

export function resetSocialConnectionsStoreForTests(): void {
  testStore = null;
}

export function getSocialConnectionsStore(): SocialConnectionsStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresSocialConnectionsStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

type ConnectionRow = {
  id: string;
  wallet_address: string;
  platform: string;
  status: string;
  display_name: string;
  external_id: string;
  encrypted_credentials: string;
  reconnect_reason: string | null;
  failure_count: number;
  created_at: Date | string;
  updated_at: Date | string;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function connectionFromRow(row: ConnectionRow): SocialConnection | null {
  if (!isSocialPlatform(row.platform)) return null;
  if (row.status !== "connected" && row.status !== "reconnect_needed") return null;
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    platform: row.platform,
    status: row.status,
    displayName: row.display_name,
    externalId: row.external_id,
    reconnectReason: row.reconnect_reason,
    failureCount: Number(row.failure_count),
    createdAt: asDate(row.created_at).toISOString(),
    updatedAt: asDate(row.updated_at).toISOString(),
  };
}

const CONNECTION_COLUMNS = `id, wallet_address, platform, status, display_name, external_id,
  encrypted_credentials, reconnect_reason, failure_count, created_at, updated_at`;

export function createPostgresSocialConnectionsStore(databaseUrl: string): SocialConnectionsStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async get(walletAddress, platform) {
      const result = await pool.query<ConnectionRow>(
        `SELECT ${CONNECTION_COLUMNS} FROM social_connections WHERE LOWER(wallet_address) = LOWER($1) AND platform = $2`,
        [walletAddress, platform],
      );
      const row = result.rows[0];
      return row ? connectionFromRow(row) : null;
    },

    async list(walletAddress) {
      const result = await pool.query<ConnectionRow>(
        `SELECT ${CONNECTION_COLUMNS} FROM social_connections WHERE LOWER(wallet_address) = LOWER($1) ORDER BY platform`,
        [walletAddress],
      );
      return result.rows.map(connectionFromRow).filter((row): row is SocialConnection => row !== null);
    },

    async upsert(input) {
      const encrypted = encryptSocialCredentials(input.credentials);
      const result = await pool.query<ConnectionRow>(
        `INSERT INTO social_connections (
           wallet_address, platform, status, display_name, external_id, encrypted_credentials,
           reconnect_reason, failure_count
         ) VALUES ($1, $2, 'connected', $3, $4, $5, NULL, 0)
         ON CONFLICT (LOWER(wallet_address), platform) DO UPDATE SET
           status = 'connected',
           display_name = EXCLUDED.display_name,
           external_id = EXCLUDED.external_id,
           encrypted_credentials = EXCLUDED.encrypted_credentials,
           reconnect_reason = NULL,
           failure_count = 0,
           updated_at = NOW()
         RETURNING ${CONNECTION_COLUMNS}`,
        [input.walletAddress, input.platform, input.displayName, input.externalId, encrypted],
      );
      const row = result.rows[0];
      const connection = row ? connectionFromRow(row) : null;
      if (!connection) throw new Error("The Social Studio connection could not be saved.");
      return connection;
    },

    async getCredentials(walletAddress, platform) {
      const result = await pool.query<{ encrypted_credentials: string }>(
        `SELECT encrypted_credentials FROM social_connections WHERE LOWER(wallet_address) = LOWER($1) AND platform = $2`,
        [walletAddress, platform],
      );
      const row = result.rows[0];
      if (!row) return { status: "not_found" };
      const decrypted = decryptSocialCredentials(row.encrypted_credentials);
      if (decrypted.status !== "ok") return { status: decrypted.status === "invalid" ? "invalid" : "not_found" };
      return { status: "ok", plaintext: decrypted.plaintext };
    },

    async markReconnectNeeded(walletAddress, platform, reason) {
      await pool.query(
        `UPDATE social_connections
            SET status = 'reconnect_needed', reconnect_reason = $3, updated_at = NOW()
          WHERE LOWER(wallet_address) = LOWER($1) AND platform = $2`,
        [walletAddress, platform, reason.slice(0, 1000)],
      );
    },

    async recordFailure(walletAddress, platform, reason, threshold) {
      const result = await pool.query<{ failure_count: number }>(
        `UPDATE social_connections
            SET failure_count = failure_count + 1, updated_at = NOW()
          WHERE LOWER(wallet_address) = LOWER($1) AND platform = $2
          RETURNING failure_count`,
        [walletAddress, platform],
      );
      const failureCount = Number(result.rows[0]?.failure_count ?? 0);
      if (failureCount >= threshold) {
        await pool.query(
          `UPDATE social_connections
              SET status = 'reconnect_needed', reconnect_reason = $3, updated_at = NOW()
            WHERE LOWER(wallet_address) = LOWER($1) AND platform = $2`,
          [walletAddress, platform, reason.slice(0, 1000)],
        );
      }
    },

    async resetFailures(walletAddress, platform) {
      await pool.query(
        `UPDATE social_connections SET failure_count = 0, updated_at = NOW()
          WHERE LOWER(wallet_address) = LOWER($1) AND platform = $2`,
        [walletAddress, platform],
      );
    },

    async delete(walletAddress, platform) {
      await pool.query(
        `DELETE FROM social_connections WHERE LOWER(wallet_address) = LOWER($1) AND platform = $2`,
        [walletAddress, platform],
      );
    },

    async createXOAuthRequest(input) {
      // Request-token rows are short-lived auth state, not an activity log — prune expired ones on write.
      await pool.query(`DELETE FROM social_x_oauth_requests WHERE expires_at < NOW()`).catch(() => undefined);
      const encryptedSecret = encryptSocialCredentials(input.requestSecret);
      await pool.query(
        `INSERT INTO social_x_oauth_requests (wallet_address, request_token, encrypted_request_secret, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [input.walletAddress, input.requestToken, encryptedSecret, input.expiresAt],
      );
    },

    async consumeXOAuthRequest(requestToken, now = new Date()) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<{
          wallet_address: string;
          encrypted_request_secret: string;
          expires_at: Date | string;
          used_at: Date | string | null;
        }>(
          `SELECT wallet_address, encrypted_request_secret, expires_at, used_at
             FROM social_x_oauth_requests WHERE request_token = $1 FOR UPDATE`,
          [requestToken],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return { status: "not_found" };
        }
        if (row.used_at) {
          await client.query("COMMIT");
          return { status: "replayed" };
        }
        if (asDate(row.expires_at).getTime() <= now.getTime()) {
          await client.query("COMMIT");
          return { status: "expired" };
        }
        await client.query(`UPDATE social_x_oauth_requests SET used_at = $2 WHERE request_token = $1`, [requestToken, now]);
        await client.query("COMMIT");

        const decrypted = decryptSocialCredentials(row.encrypted_request_secret);
        if (decrypted.status !== "ok") return { status: "not_found" };
        return { status: "ok", walletAddress: row.wallet_address, requestSecret: decrypted.plaintext };
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original database error.
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
