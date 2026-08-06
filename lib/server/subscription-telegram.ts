import { randomBytes, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { getPostgresPool } from "@/lib/server/postgres";
import { sendText } from "@/lib/server/telegram";

const LINK_TTL_MS = 30 * 60 * 1_000;

export type TelegramLinkDatabaseClient = Pick<PoolClient, "query" | "release">;
export type TelegramLinkConnect = () => Promise<TelegramLinkDatabaseClient>;

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function botUsername(environment: Record<string, string | undefined>): string | null {
  const username = environment.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || "";
  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : null;
}

export function isTelegramWebhookAuthorised(
  request: Request,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  const expected = environment.TELEGRAM_WEBHOOK_SECRET?.trim() || "";
  const supplied = request.headers.get("x-telegram-bot-api-secret-token") || "";
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}

export async function createSubscriptionTelegramLink(input: {
  walletAddress: string;
  databaseUrl?: string;
  query?: (text: string, params?: unknown[]) => Promise<unknown>;
  now?: Date;
  environment?: Record<string, string | undefined>;
  makeCode?: () => string;
}): Promise<string | null> {
  const environment = input.environment ?? process.env;
  const username = botUsername(environment);
  const databaseUrl = input.databaseUrl ?? environment.DATABASE_URL?.trim() ?? "";
  const query = input.query ?? (databaseUrl
    ? (text: string, params?: unknown[]) => getPostgresPool(databaseUrl).query(text, params)
    : null);
  if (!username || !query) return null;

  const now = input.now ?? new Date();
  const code = input.makeCode?.() ?? `link_${randomBytes(18).toString("base64url")}`;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) return null;

  try {
    await query(
      `INSERT INTO telegram_link_codes (code, wallet_address, expires_at, created_at)
       VALUES ($1, $2, $3, $4)`,
      [code, input.walletAddress.toLowerCase(), new Date(now.getTime() + LINK_TTL_MS), now],
    );
    return `https://t.me/${username}?start=${code}`;
  } catch {
    return null;
  }
}

export type TelegramWebhookUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { id?: number; username?: string };
  };
};

async function safeRollback(client: TelegramLinkDatabaseClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original failure.
  }
}

export async function consumeTelegramLinkCode(input: {
  code: string;
  telegramUserId: number;
  telegramChatId: number;
  telegramUsername?: string;
  databaseUrl?: string;
  connect?: TelegramLinkConnect;
  now?: Date;
}): Promise<{ linked: boolean; walletAddress: string | null }> {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  const connect = input.connect ?? (databaseUrl
    ? () => getPostgresPool(databaseUrl).connect()
    : null);
  if (!connect) return { linked: false, walletAddress: null };

  const client = await connect();
  const now = input.now ?? new Date();
  try {
    await client.query("BEGIN");
    const codeResult = await client.query<{ wallet_address: string }>(
      `SELECT wallet_address
         FROM telegram_link_codes
        WHERE code = $1
          AND used_at IS NULL
          AND expires_at > $2
        FOR UPDATE`,
      [input.code, now],
    );
    const walletAddress = codeResult.rows[0]?.wallet_address || null;
    if (!walletAddress) {
      await client.query("ROLLBACK");
      return { linked: false, walletAddress: null };
    }

    const updated = await client.query(
      `UPDATE subscriptions
          SET telegram_user_id = $2,
              telegram_chat_id = $3,
              telegram_username = $4,
              telegram_linked_at = $5
        WHERE wallet_address = $1
          AND tier IN ('pro', 'pro_bundle')`,
      [
        walletAddress,
        input.telegramUserId,
        input.telegramChatId,
        input.telegramUsername?.trim().slice(0, 64) || null,
        now,
      ],
    );
    if ((updated as { rowCount?: number }).rowCount === 0) {
      await client.query("ROLLBACK");
      return { linked: false, walletAddress: null };
    }

    await client.query(
      `UPDATE telegram_link_codes SET used_at = $2 WHERE code = $1`,
      [input.code, now],
    );
    await client.query("COMMIT");
    return { linked: true, walletAddress };
  } catch {
    await safeRollback(client);
    return { linked: false, walletAddress: null };
  } finally {
    client.release();
  }
}

export async function handleSubscriptionTelegramUpdate(
  update: TelegramWebhookUpdate,
  options: {
    botToken?: string;
    databaseUrl?: string;
    connect?: TelegramLinkConnect;
    now?: Date;
    send?: typeof sendText;
  } = {},
): Promise<{ handled: boolean; linked: boolean }> {
  const text = update.message?.text?.trim() || "";
  const match = /^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{8,64})$/.exec(text);
  const chatId = update.message?.chat?.id;
  const chatType = update.message?.chat?.type;
  const userId = update.message?.from?.id;
  const privateChat =
    Boolean(chatId && userId) &&
    chatId === userId &&
    (!chatType || chatType === "private");
  if (!match || !privateChat || !chatId || !userId) {
    return { handled: false, linked: false };
  }

  const result = await consumeTelegramLinkCode({
    code: match[1],
    telegramUserId: userId,
    telegramChatId: chatId,
    telegramUsername: update.message?.from?.username,
    databaseUrl: options.databaseUrl,
    connect: options.connect,
    now: options.now,
  });

  const token = options.botToken ?? process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  if (token) {
    const send = options.send ?? sendText;
    const message = result.linked
      ? "Telegram renewal reminders are linked to your Hoodlums subscription. You will receive reminders 5 days, 2 days and on the day it expires."
      : "This Hoodlums Telegram link is invalid, expired or already used. Return to Hoodlums and create a new link after subscribing.";
    try {
      await send(token, String(chatId), message);
    } catch {
      // The database result remains authoritative even if the confirmation message fails.
    }
  }

  return { handled: true, linked: result.linked };
}
