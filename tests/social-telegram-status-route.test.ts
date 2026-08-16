import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as telegramStatus } from "@/app/api/social/telegram/status/route";
import { resetSocialStudioActionRateLimitsForTests } from "@/lib/server/api-protection";

function getRequest(path: string) {
  return new Request(`http://localhost:3000${path}`, { method: "GET" });
}

beforeEach(() => {
  resetSocialStudioActionRateLimitsForTests();
  delete process.env.TELEGRAM_BOT_TOKEN;
});

afterEach(() => {
  resetSocialStudioActionRateLimitsForTests();
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe("GET /api/social/telegram/status", () => {
  it("reports not configured when TELEGRAM_BOT_TOKEN is unset", async () => {
    const response = await telegramStatus(getRequest("/api/social/telegram/status"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { configured: boolean };
    expect(body.configured).toBe(false);
  });

  it("reports configured once TELEGRAM_BOT_TOKEN is set, without ever returning the token itself", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456:super-secret-token";
    const response = await telegramStatus(getRequest("/api/social/telegram/status"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("super-secret-token");
    expect(JSON.parse(text)).toEqual({ configured: true });
  });

  it("treats a whitespace-only token as not configured", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "   ";
    const response = await telegramStatus(getRequest("/api/social/telegram/status"));
    const body = (await response.json()) as { configured: boolean };
    expect(body.configured).toBe(false);
  });
});
