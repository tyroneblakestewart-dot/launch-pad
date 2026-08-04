import { CHAT_REPORT_HIDE_THRESHOLD } from "@/lib/server/chat-moderation";
import { isHoodchatCategory, type HoodchatCategory } from "@/lib/hoodchat-categories";
import { getPostgresPool } from "@/lib/server/postgres";

// Data-only store for the main /hoodchat feed (issue #237). Wallet-signature
// verification and challenge replay protection live in lib/server/chat-auth.ts
// and are handled by the API route before any of these methods are called —
// this store only ever receives an already-authorised wallet address.

export { isHoodchatCategory, type HoodchatCategory } from "@/lib/hoodchat-categories";

export const HOODCHAT_POST_LIMIT_PER_WALLET = 5;
export const HOODCHAT_POST_WINDOW_MS = 60 * 60 * 1000;

export type HoodchatMessage = {
  id: string;
  walletAddress: string;
  category: HoodchatCategory;
  body: string;
  createdAt: string;
  reportCount: number;
  hidden: boolean;
};

export type InsertHoodchatMessageInput = {
  walletAddress: string;
  category: HoodchatCategory;
  body: string;
};

export type HoodchatInsertResult =
  | { status: "posted"; message: HoodchatMessage }
  | { status: "rate_limited" };

export type HoodchatReportResult = { status: "reported" | "not_found"; hidden: boolean };

export interface HoodchatStore {
  insertMessageIfUnderLimit(input: InsertHoodchatMessageInput): Promise<HoodchatInsertResult>;
  listMessages(category: HoodchatCategory | "all"): Promise<HoodchatMessage[]>;
  reportMessage(id: string): Promise<HoodchatReportResult>;
}

export class HoodchatStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for Hoodchat.");
    this.name = "HoodchatStoreUnavailableError";
  }
}

const unconfiguredStore: HoodchatStore = {
  async insertMessageIfUnderLimit() {
    throw new HoodchatStoreUnavailableError();
  },
  async listMessages() {
    return [];
  },
  async reportMessage() {
    return { status: "not_found", hidden: false };
  },
};

let testStore: HoodchatStore | null = null;
let productionStore: HoodchatStore | null = null;
let productionDatabaseUrl = "";

export function setHoodchatStoreForTests(store: HoodchatStore): void {
  testStore = store;
}

export function resetHoodchatStoreForTests(): void {
  testStore = null;
}

export function getHoodchatStore(): HoodchatStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresHoodchatStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

type MessageRow = {
  id: string;
  wallet_address: string;
  category: string;
  body: string;
  created_at: Date | string;
  report_count: number;
  hidden: boolean;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function messageFromRow(row: MessageRow): HoodchatMessage | null {
  if (!isHoodchatCategory(row.category)) return null;
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    category: row.category,
    body: row.body,
    createdAt: asDate(row.created_at).toISOString(),
    reportCount: Number(row.report_count),
    hidden: Boolean(row.hidden),
  };
}

const MESSAGE_COLUMNS = `id, wallet_address, category, body, created_at, report_count, hidden`;

export function createPostgresHoodchatStore(databaseUrl: string): HoodchatStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async insertMessageIfUnderLimit(input: InsertHoodchatMessageInput): Promise<HoodchatInsertResult> {
      const countResult = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM hoodchat_messages
          WHERE wallet_address = $1
            AND created_at > NOW() - INTERVAL '1 hour'`,
        [input.walletAddress],
      );
      if (Number(countResult.rows[0]?.count ?? 0) >= HOODCHAT_POST_LIMIT_PER_WALLET) {
        return { status: "rate_limited" };
      }

      const inserted = await pool.query<MessageRow>(
        `INSERT INTO hoodchat_messages (wallet_address, category, body)
         VALUES ($1, $2, $3)
         RETURNING ${MESSAGE_COLUMNS}`,
        [input.walletAddress, input.category, input.body],
      );
      const message = messageFromRow(inserted.rows[0]);
      if (!message) throw new Error("The inserted Hoodchat message could not be mapped safely.");
      return { status: "posted", message };
    },

    async listMessages(category: HoodchatCategory | "all"): Promise<HoodchatMessage[]> {
      const result =
        category === "all"
          ? await pool.query<MessageRow>(
              `SELECT ${MESSAGE_COLUMNS}
                 FROM hoodchat_messages
                WHERE hidden = FALSE
                ORDER BY created_at ASC
                LIMIT 200`,
            )
          : await pool.query<MessageRow>(
              `SELECT ${MESSAGE_COLUMNS}
                 FROM hoodchat_messages
                WHERE hidden = FALSE AND category = $1
                ORDER BY created_at ASC
                LIMIT 200`,
              [category],
            );
      return result.rows.map(messageFromRow).filter((message): message is HoodchatMessage => message !== null);
    },

    async reportMessage(id: string): Promise<HoodchatReportResult> {
      const result = await pool.query<{ report_count: number; hidden: boolean }>(
        `UPDATE hoodchat_messages
            SET report_count = report_count + 1,
                hidden = (report_count + 1) >= $2
          WHERE id = $1
          RETURNING report_count, hidden`,
        [id, CHAT_REPORT_HIDE_THRESHOLD],
      );
      const row = result.rows[0];
      if (!row) return { status: "not_found", hidden: false };
      return { status: "reported", hidden: row.hidden };
    },
  };
}
