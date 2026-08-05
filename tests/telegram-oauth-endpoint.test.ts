import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as verify } from "@/app/api/auth/telegram/verify/route";
import { resetSocialOAuthRateLimitsForTests } from "@/lib/server/api-protection";
import {
  createMemoryAdminOperationsState,
  createMemoryAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";

const BOT_TOKEN = "123456789:AAExampleBotTokenForTestingOnly1234567";

function signedTelegramUser(
  overrides: Partial<Record<"id" | "username" | "auth_date", unknown>> = {},
  botToken = BOT_TOKEN,
) {
  const fields = {
    id: 555,
    username: "hoodlums_fan",
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  const dataCheckString = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHash("sha256").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return { ...fields, hash };
}

function verifyRequest(body: unknown, ip = "203.0.113.5") {
  return new Request("http://localhost:3000/api/auth/telegram/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify(body),
  });
}

describe("Telegram Login Widget verify route", () => {
  beforeEach(() => {
    resetSocialOAuthRateLimitsForTests();
    vi.stubEnv("TELEGRAM_LOGIN_BOT_TOKEN", BOT_TOKEN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAdminOperationsStoreForTests();
  });

  it("accepts a correctly signed, fresh payload and returns the username", async () => {
    const response = await verify(verifyRequest(signedTelegramUser()));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, username: "hoodlums_fan" });
  });

  it("rejects a payload with a bad signature", async () => {
    const payload = signedTelegramUser();
    const response = await verify(verifyRequest({ ...payload, username: "attacker" }));
    expect(response.status).toBe(401);
  });

  it("rejects a stale payload", async () => {
    const payload = signedTelegramUser({ auth_date: Math.floor(Date.now() / 1000) - 90_000 });
    const response = await verify(verifyRequest(payload));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("rejects a Telegram account with no public username", async () => {
    const payload = signedTelegramUser({ username: undefined });
    const response = await verify(verifyRequest(payload));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("no public username");
  });

  it("rejects malformed JSON bodies", async () => {
    const response = await verify(
      new Request("http://localhost:3000/api/auth/telegram/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("reports not-configured when TELEGRAM_LOGIN_BOT_TOKEN is unset", async () => {
    vi.unstubAllEnvs();
    const response = await verify(verifyRequest(signedTelegramUser()));
    expect(response.status).toBe(503);
  });

  it("respects the telegram-oauth admin isolation switch", async () => {
    const state = createMemoryAdminOperationsState();
    setAdminOperationsStoreForTests(createMemoryAdminOperationsStore(state));
    await createMemoryAdminOperationsStore(state).setServiceIsolation({
      key: "telegram-oauth",
      isolated: true,
      reason: "Rotating the bot token.",
    });

    const response = await verify(verifyRequest(signedTelegramUser()));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "SERVICE_ISOLATED" });
  });

  it("rate limits repeated verify requests from the same IP", async () => {
    let lastResponse: Response | null = null;
    for (let i = 0; i < 31; i++) {
      lastResponse = await verify(verifyRequest(signedTelegramUser(), "198.51.100.9"));
    }
    expect(lastResponse!.status).toBe(429);
  });
});
