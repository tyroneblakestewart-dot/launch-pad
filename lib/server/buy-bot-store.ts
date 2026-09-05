import { getPostgresPool } from "@/lib/server/postgres";
import { decryptSocialCredentials, encryptSocialCredentials } from "@/lib/server/social-credentials-crypto";
import { isBuyBotStatus, type BuyBotStatus, type BuyBotSummary } from "@/lib/buy-bot-presets";

// Durable per-token Buy Bot registry (owner direction, 5 Sep 2026) — see
// db/migrations/032_social_buy_bots.sql. Follows
// lib/server/social-connections-store.ts's shape exactly: interface +
// unconfigured fallback (reads fail safe, writes throw) + test-injectable
// singleton + Postgres implementation, with the Telegram channel binding
// encrypted at rest through the same lib/server/social-credentials-crypto.ts
// helpers the posting connections use.

export type BuyBot = {
  id: string;
  walletAddress: string;
  chainId: number;
  tokenAddress: string;
  curveAddress: string;
  channelDisplayName: string;
  channelExternalId: string;
  thresholdWei: string;
  status: BuyBotStatus;
  /** Block number of the last announced trade, as a decimal string (bigint-safe). */
  cursorBlockNumber: string;
  cursorLogIndex: number;
  failureCount: number;
  lastError: string | null;
  lastPostedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertBuyBotInput = {
  walletAddress: string;
  chainId: number;
  tokenAddress: string;
  curveAddress: string;
  channelDisplayName: string;
  channelExternalId: string;
  /** Plaintext channel binding (JSON `{ chatId }`) — encrypted before storage. */
  channel: string;
  thresholdWei: string;
  cursorBlockNumber: string;
  cursorLogIndex: number;
};

export type GetBuyBotChannelResult =
  | { status: "ok"; plaintext: string }
  | { status: "not_found" }
  | { status: "invalid" };

export type BuyBotStatusCounts = Record<BuyBotStatus, number>;

export interface BuyBotStore {
  get(walletAddress: string, chainId: number, tokenAddress: string): Promise<BuyBot | null>;
  listForWallet(walletAddress: string): Promise<BuyBot[]>;
  /** Bots the cron should work: status 'active' only, oldest-updated first, bounded. */
  listActive(limit: number): Promise<BuyBot[]>;
  /** Creates the bot, or re-binds an existing one for the same wallet+token (new channel/threshold, status back to active, failures cleared, cursor reset). */
  upsert(input: UpsertBuyBotInput): Promise<BuyBot>;
  /** Threshold and/or pause/resume for the wallet's own bot. Returns null when no bot exists for that wallet+token. */
  updateSettings(
    walletAddress: string,
    chainId: number,
    tokenAddress: string,
    changes: { thresholdWei?: string; status?: "active" | "paused" },
  ): Promise<BuyBot | null>;
  delete(walletAddress: string, chainId: number, tokenAddress: string): Promise<void>;
  getChannel(id: string): Promise<GetBuyBotChannelResult>;
  /** Moves the cursor past an announced trade and stamps last_posted_at; also clears the failure counter. */
  advanceCursor(id: string, cursorBlockNumber: string, cursorLogIndex: number, postedAt: Date): Promise<void>;
  /** Increments the failure counter and stores the reason; flips to reconnect_needed once the threshold is reached. */
  recordFailure(id: string, reason: string, threshold: number): Promise<void>;
  markReconnectNeeded(id: string, reason: string): Promise<void>;
  countByStatus(): Promise<BuyBotStatusCounts>;
  countPostedLast24h(): Promise<number>;
  tableExists(): Promise<boolean>;
}

export class BuyBotStoreUnavailableError extends Error {
  constructor() {
    super("The Buy Bot registry is not configured on this deployment.");
    this.name = "BuyBotStoreUnavailableError";
  }
}

const unconfiguredStore: BuyBotStore = {
  async get() {
    return null;
  },
  async listForWallet() {
    return [];
  },
  async listActive() {
    return [];
  },
  async upsert() {
    throw new BuyBotStoreUnavailableError();
  },
  async updateSettings() {
    throw new BuyBotStoreUnavailableError();
  },
  async delete() {
    throw new BuyBotStoreUnavailableError();
  },
  async getChannel() {
    return { status: "not_found" };
  },
  async advanceCursor() {
    throw new BuyBotStoreUnavailableError();
  },
  async recordFailure() {
    throw new BuyBotStoreUnavailableError();
  },
  async markReconnectNeeded() {
    throw new BuyBotStoreUnavailableError();
  },
  async countByStatus() {
    return { active: 0, paused: 0, reconnect_needed: 0 };
  },
  async countPostedLast24h() {
    return 0;
  },
  async tableExists() {
    return false;
  },
};

let testStore: BuyBotStore | null = null;
let productionStore: BuyBotStore | null = null;
let productionDatabaseUrl = "";

export function setBuyBotStoreForTests(store: BuyBotStore): void {
  testStore = store;
}

export function resetBuyBotStoreForTests(): void {
  testStore = null;
}

export function getBuyBotStore(): BuyBotStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresBuyBotStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

type BuyBotRow = {
  id: string;
  wallet_address: string;
  chain_id: number | string;
  token_address: string;
  curve_address: string;
  channel_display_name: string;
  channel_external_id: string;
  threshold_wei: string | number;
  status: string;
  cursor_block_number: string | number;
  cursor_log_index: number | string;
  failure_count: number | string;
  last_error: string | null;
  last_posted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function botFromRow(row: BuyBotRow): BuyBot | null {
  if (!isBuyBotStatus(row.status)) return null;
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    chainId: Number(row.chain_id),
    tokenAddress: row.token_address,
    curveAddress: row.curve_address,
    channelDisplayName: row.channel_display_name,
    channelExternalId: row.channel_external_id,
    thresholdWei: String(row.threshold_wei),
    status: row.status,
    cursorBlockNumber: String(row.cursor_block_number),
    cursorLogIndex: Number(row.cursor_log_index),
    failureCount: Number(row.failure_count),
    lastError: row.last_error,
    lastPostedAt: row.last_posted_at ? asDate(row.last_posted_at).toISOString() : null,
    createdAt: asDate(row.created_at).toISOString(),
    updatedAt: asDate(row.updated_at).toISOString(),
  };
}

const BOT_COLUMNS = `id, wallet_address, chain_id, token_address, curve_address, channel_display_name,
  channel_external_id, threshold_wei::text AS threshold_wei, status, cursor_block_number::text AS cursor_block_number,
  cursor_log_index, failure_count, last_error, last_posted_at, created_at, updated_at`;

export function createPostgresBuyBotStore(databaseUrl: string): BuyBotStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async get(walletAddress, chainId, tokenAddress) {
      const result = await pool.query<BuyBotRow>(
        `SELECT ${BOT_COLUMNS} FROM social_buy_bots
          WHERE LOWER(wallet_address) = LOWER($1) AND chain_id = $2 AND LOWER(token_address) = LOWER($3)`,
        [walletAddress, chainId, tokenAddress],
      );
      const row = result.rows[0];
      return row ? botFromRow(row) : null;
    },

    async listForWallet(walletAddress) {
      const result = await pool.query<BuyBotRow>(
        `SELECT ${BOT_COLUMNS} FROM social_buy_bots WHERE LOWER(wallet_address) = LOWER($1) ORDER BY created_at DESC LIMIT 50`,
        [walletAddress],
      );
      return result.rows.map(botFromRow).filter((bot): bot is BuyBot => bot !== null);
    },

    async listActive(limit) {
      const result = await pool.query<BuyBotRow>(
        `SELECT ${BOT_COLUMNS} FROM social_buy_bots WHERE status = 'active' ORDER BY updated_at ASC LIMIT $1`,
        [Math.max(1, Math.floor(limit))],
      );
      return result.rows.map(botFromRow).filter((bot): bot is BuyBot => bot !== null);
    },

    async upsert(input) {
      const encrypted = encryptSocialCredentials(input.channel);
      const result = await pool.query<BuyBotRow>(
        `INSERT INTO social_buy_bots (
           wallet_address, chain_id, token_address, curve_address, channel_display_name, channel_external_id,
           encrypted_channel, threshold_wei, status, cursor_block_number, cursor_log_index, failure_count, last_error
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric, 'active', $9::numeric, $10, 0, NULL)
         ON CONFLICT (LOWER(wallet_address), chain_id, LOWER(token_address)) DO UPDATE SET
           curve_address = EXCLUDED.curve_address,
           channel_display_name = EXCLUDED.channel_display_name,
           channel_external_id = EXCLUDED.channel_external_id,
           encrypted_channel = EXCLUDED.encrypted_channel,
           threshold_wei = EXCLUDED.threshold_wei,
           status = 'active',
           cursor_block_number = EXCLUDED.cursor_block_number,
           cursor_log_index = EXCLUDED.cursor_log_index,
           failure_count = 0,
           last_error = NULL,
           updated_at = NOW()
         RETURNING ${BOT_COLUMNS}`,
        [
          input.walletAddress,
          input.chainId,
          input.tokenAddress,
          input.curveAddress,
          input.channelDisplayName,
          input.channelExternalId,
          encrypted,
          input.thresholdWei,
          input.cursorBlockNumber,
          input.cursorLogIndex,
        ],
      );
      const row = result.rows[0];
      const bot = row ? botFromRow(row) : null;
      if (!bot) throw new Error("The Buy Bot could not be saved.");
      return bot;
    },

    async updateSettings(walletAddress, chainId, tokenAddress, changes) {
      const result = await pool.query<BuyBotRow>(
        `UPDATE social_buy_bots
            SET threshold_wei = COALESCE($4::numeric, threshold_wei),
                status = COALESCE($5::text, status),
                failure_count = CASE WHEN $5::text = 'active' THEN 0 ELSE failure_count END,
                last_error = CASE WHEN $5::text = 'active' THEN NULL ELSE last_error END,
                updated_at = NOW()
          WHERE LOWER(wallet_address) = LOWER($1) AND chain_id = $2 AND LOWER(token_address) = LOWER($3)
          RETURNING ${BOT_COLUMNS}`,
        [walletAddress, chainId, tokenAddress, changes.thresholdWei ?? null, changes.status ?? null],
      );
      const row = result.rows[0];
      return row ? botFromRow(row) : null;
    },

    async delete(walletAddress, chainId, tokenAddress) {
      await pool.query(
        `DELETE FROM social_buy_bots WHERE LOWER(wallet_address) = LOWER($1) AND chain_id = $2 AND LOWER(token_address) = LOWER($3)`,
        [walletAddress, chainId, tokenAddress],
      );
    },

    async getChannel(id) {
      const result = await pool.query<{ encrypted_channel: string }>(`SELECT encrypted_channel FROM social_buy_bots WHERE id = $1`, [id]);
      const row = result.rows[0];
      if (!row) return { status: "not_found" };
      const decrypted = decryptSocialCredentials(row.encrypted_channel);
      if (decrypted.status !== "ok") return { status: decrypted.status === "invalid" ? "invalid" : "not_found" };
      return { status: "ok", plaintext: decrypted.plaintext };
    },

    async advanceCursor(id, cursorBlockNumber, cursorLogIndex, postedAt) {
      await pool.query(
        `UPDATE social_buy_bots
            SET cursor_block_number = $2::numeric, cursor_log_index = $3, last_posted_at = $4::timestamptz,
                failure_count = 0, last_error = NULL, updated_at = NOW()
          WHERE id = $1`,
        [id, cursorBlockNumber, cursorLogIndex, postedAt],
      );
    },

    async recordFailure(id, reason, threshold) {
      const result = await pool.query<{ failure_count: number | string }>(
        `UPDATE social_buy_bots SET failure_count = failure_count + 1, last_error = $2, updated_at = NOW() WHERE id = $1 RETURNING failure_count`,
        [id, reason.slice(0, 1000)],
      );
      const failureCount = Number(result.rows[0]?.failure_count ?? 0);
      if (failureCount >= threshold) {
        await pool.query(`UPDATE social_buy_bots SET status = 'reconnect_needed', updated_at = NOW() WHERE id = $1`, [id]);
      }
    },

    async markReconnectNeeded(id, reason) {
      await pool.query(
        `UPDATE social_buy_bots SET status = 'reconnect_needed', last_error = $2, updated_at = NOW() WHERE id = $1`,
        [id, reason.slice(0, 1000)],
      );
    },

    async countByStatus() {
      const result = await pool.query<{ status: string; count: number | string }>(
        `SELECT status, COUNT(*)::int AS count FROM social_buy_bots GROUP BY status`,
      );
      const counts: BuyBotStatusCounts = { active: 0, paused: 0, reconnect_needed: 0 };
      for (const row of result.rows) {
        if (isBuyBotStatus(row.status)) counts[row.status] = Number(row.count);
      }
      return counts;
    },

    async countPostedLast24h() {
      const result = await pool.query<{ count: number | string }>(
        `SELECT COUNT(*)::int AS count FROM social_buy_bots WHERE last_posted_at >= NOW() - INTERVAL '24 hours'`,
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async tableExists() {
      const result = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'social_buy_bots'`,
      );
      return result.rows.length > 0;
    },
  };
}

/** The client-facing projection returned by every /api/social/buy-bot route — never the channel binding, cursor or internal id. */
export function toBuyBotSummary(bot: BuyBot): BuyBotSummary {
  return {
    chainId: bot.chainId,
    tokenAddress: bot.tokenAddress,
    channelDisplayName: bot.channelDisplayName,
    channelExternalId: bot.channelExternalId,
    thresholdWei: bot.thresholdWei,
    status: bot.status,
    lastError: bot.lastError,
    lastPostedAt: bot.lastPostedAt,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
  };
}
