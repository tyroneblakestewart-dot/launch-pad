import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isTelegramAuthFresh,
  isTelegramHashValid,
  parseTelegramLoginPayload,
  type TelegramLoginPayload,
  TELEGRAM_AUTH_MAX_AGE_SECONDS,
} from "@/lib/server/telegram-oauth";

const BOT_TOKEN = "123456789:AAExampleBotTokenForTestingOnly1234567";

function signPayload(fields: Omit<TelegramLoginPayload, "hash">, botToken = BOT_TOKEN): TelegramLoginPayload {
  const dataCheckString = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHash("sha256").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return { ...fields, hash };
}

describe("Telegram Login Widget verification", () => {
  it("parses a well-shaped payload and coerces numeric fields", () => {
    const raw = {
      id: 12345,
      username: "hoodlums_fan",
      first_name: "Hood",
      auth_date: 1_700_000_000,
      hash: "a".repeat(64),
    };
    const parsed = parseTelegramLoginPayload(raw);
    expect(parsed).toEqual({
      id: 12345,
      username: "hoodlums_fan",
      first_name: "Hood",
      last_name: undefined,
      photo_url: undefined,
      auth_date: 1_700_000_000,
      hash: "a".repeat(64),
    });
  });

  it("rejects payloads missing required fields or with a malformed hash", () => {
    expect(parseTelegramLoginPayload(null)).toBeNull();
    expect(parseTelegramLoginPayload("not-an-object")).toBeNull();
    expect(parseTelegramLoginPayload({ id: 1, auth_date: 1 })).toBeNull();
    expect(parseTelegramLoginPayload({ id: 1, auth_date: 1, hash: "too-short" })).toBeNull();
    expect(parseTelegramLoginPayload({ id: "not-a-number", auth_date: 1, hash: "a".repeat(64) })).toBeNull();
  });

  it("treats blank optional strings as absent", () => {
    const parsed = parseTelegramLoginPayload({
      id: 1,
      auth_date: 1,
      hash: "a".repeat(64),
      username: "   ",
    });
    expect(parsed?.username).toBeUndefined();
  });

  it("accepts a correctly signed payload and rejects a tampered one", () => {
    const payload = signPayload({ id: 555, username: "hoodlums_fan", auth_date: 1_700_000_000 });
    expect(isTelegramHashValid(payload, BOT_TOKEN)).toBe(true);
    expect(isTelegramHashValid({ ...payload, username: "attacker" }, BOT_TOKEN)).toBe(false);
    expect(isTelegramHashValid(payload, "a-different-bot-token")).toBe(false);
  });

  it("is unaffected by the order fields were supplied in, since the check string is always re-sorted", () => {
    const payload = signPayload({
      id: 1,
      auth_date: 1_700_000_000,
      username: "z_user",
      first_name: "A",
      last_name: "B",
    });
    // Re-deriving the payload with keys reinserted in a different order must
    // produce the same object shape and therefore the same verification
    // result — the hash check only cares about the sorted key=value string.
    const reordered: TelegramLoginPayload = {
      last_name: payload.last_name,
      first_name: payload.first_name,
      username: payload.username,
      auth_date: payload.auth_date,
      id: payload.id,
      hash: payload.hash,
    };
    expect(isTelegramHashValid(reordered, BOT_TOKEN)).toBe(true);
  });

  it("accepts auth_date within the freshness window and rejects stale or future timestamps", () => {
    const now = 1_700_100_000_000;
    const nowSeconds = now / 1000;
    expect(isTelegramAuthFresh(nowSeconds, now)).toBe(true);
    expect(isTelegramAuthFresh(nowSeconds - TELEGRAM_AUTH_MAX_AGE_SECONDS, now)).toBe(true);
    expect(isTelegramAuthFresh(nowSeconds - TELEGRAM_AUTH_MAX_AGE_SECONDS - 1, now)).toBe(false);
    expect(isTelegramAuthFresh(nowSeconds + 60, now)).toBe(false);
  });
});
