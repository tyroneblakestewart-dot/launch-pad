import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Server-side verification for the official Telegram Login Widget
// (https://core.telegram.org/widgets/login), used by the studio's "Connect
// Telegram" control (issue #246). This is unrelated to the bot-token/chat-ID
// publishing flow in lib/server/telegram.ts — that sends messages with a
// caller-supplied bot token; this verifies a login handshake signed by
// TELEGRAM_LOGIN_BOT_TOKEN, a server-only secret.
export const TELEGRAM_AUTH_MAX_AGE_SECONDS = 86_400;

export type TelegramLoginPayload = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

/** Narrows an untrusted request body to a well-shaped Telegram widget payload without trusting field values yet. */
export function parseTelegramLoginPayload(body: unknown): TelegramLoginPayload | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;

  const id = typeof record.id === "number" ? record.id : Number(record.id);
  const authDate = typeof record.auth_date === "number" ? record.auth_date : Number(record.auth_date);
  const hash = typeof record.hash === "string" ? record.hash.trim() : "";
  if (!Number.isFinite(id) || !Number.isFinite(authDate) || !/^[0-9a-f]{64}$/i.test(hash)) {
    return null;
  }

  const optionalString = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  return {
    id,
    auth_date: authDate,
    hash,
    username: optionalString(record.username),
    first_name: optionalString(record.first_name),
    last_name: optionalString(record.last_name),
    photo_url: optionalString(record.photo_url),
  };
}

/**
 * Verifies the widget's HMAC-SHA256 signature per Telegram's documented
 * algorithm: secret_key = SHA256(bot_token); data_check_string is every
 * field except `hash`, formatted `key=value`, sorted alphabetically by key
 * and newline-joined; the hex HMAC of that string using secret_key must
 * equal the supplied hash.
 */
export function isTelegramHashValid(payload: TelegramLoginPayload, botToken: string): boolean {
  const { hash, ...fields } = payload;
  const dataCheckString = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const left = Buffer.from(computedHash);
  const right = Buffer.from(hash.toLowerCase());
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Rejects stale/replayed widget payloads; Telegram itself does not expire `auth_date`. */
export function isTelegramAuthFresh(authDateSeconds: number, nowMs: number = Date.now()): boolean {
  const ageSeconds = nowMs / 1000 - authDateSeconds;
  return ageSeconds >= 0 && ageSeconds <= TELEGRAM_AUTH_MAX_AGE_SECONDS;
}
