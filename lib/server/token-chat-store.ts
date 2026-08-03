import { CHAT_REPORT_HIDE_THRESHOLD } from "@/lib/server/chat-moderation";
import { getPostgresPool } from "@/lib/server/postgres";
import type { SupportedChain } from "@/lib/types";

// Data-only store for the per-token Hoodchat tab (issue #237). Mirrors
// lib/server/hoodchat-store.ts, scoped to one chain + contract address per
// message instead of a category. Wallet-signature verification and
// challenge replay protection live in lib/server/chat-auth.ts.

export const TOKEN_CHAT_POST_LIMIT_PER_WALLET = 5;
export const TOKEN_CHAT_POST_WINDOW_MS = 60 * 60 * 1000;

export type TokenChatMessage = {
  id: string;
  chain: SupportedChain;
  contractAddress: string;
  walletAddress: string;
  body: string;
  createdAt: string;
  reportCount: number;
  hidden: boolean;
};

export type InsertTokenChatMessageInput = {
  chain: SupportedChain;
  contractAddress: string;
  walletAddress: string;
  body: string;
};

export type TokenChatInsertResult =
  | { status: "posted"; message: TokenChatMessage }
  | { status: "rate_limited" };

export type TokenChatReportResult = { status: "reported" | "not_found"; hidden: boolean };

export interface TokenChatStore {
  insertMessageIfUnderLimit(input: InsertTokenChatMessageInput): Promise<TokenChatInsertResult>;
  listMessages(chain: SupportedChain, contractAddress: string): Promise<TokenChatMessage[]>;
  reportMessage(id: string): Promise<TokenChatReportResult>;
}

export class TokenChatStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for token chat.");
    this.name = "TokenChatStoreUnavailableError";
  }
}

const unconfiguredStore: TokenChatStore = {
  async insertMessageIfUnderLimit() {
    throw new TokenChatStoreUnavailableError();
  },
  async listMessages() {
    return [];
  },
  async reportMessage() {
    return { status: "not_found", hidden: false };
  },
};

let testStore: TokenChatStore | null = null;
let productionStore: TokenChatStore | null = null;
let productionDatabaseUrl = "";

export function setTokenChatStoreForTests(store: TokenChatStore): void {
  testStore = store;
}

export function resetTokenChatStoreForTests(): void {
  testStore = null;
}

export function getTokenChatStore(): TokenChatStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresTokenChatStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

type MessageRow = {
  id: string;
  chain: string;
  contract_address: string;
  wallet_address: string;
  body: string;
  created_at: Date | string;
  report_count: number;
  hidden: boolean;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isSupportedChain(value: string): value is SupportedChain {
  return value === "robinhood" || value === "solana";
}

function messageFromRow(row: MessageRow): TokenChatMessage | null {
  if (!isSupportedChain(row.chain)) return null;
  return {
    id: row.id,
    chain: row.chain,
    contractAddress: row.contract_address,
    walletAddress: row.wallet_address,
    body: row.body,
    createdAt: asDate(row.created_at).toISOString(),
    reportCount: Number(row.report_count),
    hidden: Boolean(row.hidden),
  };
}

const MESSAGE_COLUMNS = `id, chain, contract_address, wallet_address, body, created_at, report_count, hidden`;

export function createPostgresTokenChatStore(databaseUrl: string): TokenChatStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async insertMessageIfUnderLimit(input: InsertTokenChatMessageInput): Promise<TokenChatInsertResult> {
      const countResult = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM token_chat_messages
          WHERE wallet_address = $1
            AND chain = $2
            AND LOWER(contract_address) = LOWER($3)
            AND created_at > NOW() - INTERVAL '1 hour'`,
        [input.walletAddress, input.chain, input.contractAddress],
      );
      if (Number(countResult.rows[0]?.count ?? 0) >= TOKEN_CHAT_POST_LIMIT_PER_WALLET) {
        return { status: "rate_limited" };
      }

      const inserted = await pool.query<MessageRow>(
        `INSERT INTO token_chat_messages (chain, contract_address, wallet_address, body)
         VALUES ($1, $2, $3, $4)
         RETURNING ${MESSAGE_COLUMNS}`,
        [input.chain, input.contractAddress, input.walletAddress, input.body],
      );
      const message = messageFromRow(inserted.rows[0]);
      if (!message) throw new Error("The inserted token chat message could not be mapped safely.");
      return { status: "posted", message };
    },

    async listMessages(chain: SupportedChain, contractAddress: string): Promise<TokenChatMessage[]> {
      const result = await pool.query<MessageRow>(
        `SELECT ${MESSAGE_COLUMNS}
           FROM token_chat_messages
          WHERE hidden = FALSE AND chain = $1 AND LOWER(contract_address) = LOWER($2)
          ORDER BY created_at ASC
          LIMIT 200`,
        [chain, contractAddress],
      );
      return result.rows.map(messageFromRow).filter((message): message is TokenChatMessage => message !== null);
    },

    async reportMessage(id: string): Promise<TokenChatReportResult> {
      const result = await pool.query<{ report_count: number; hidden: boolean }>(
        `UPDATE token_chat_messages
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
