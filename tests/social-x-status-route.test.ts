import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as xStatus } from "@/app/api/social/x/status/route";
import { resetSocialStudioActionRateLimitsForTests } from "@/lib/server/api-protection";

function getRequest(path: string) {
  return new Request(`http://localhost:3000${path}`, { method: "GET" });
}

beforeEach(() => {
  resetSocialStudioActionRateLimitsForTests();
  delete process.env.X_SOCIAL_CONSUMER_KEY;
  delete process.env.X_SOCIAL_CONSUMER_SECRET;
});

afterEach(() => {
  resetSocialStudioActionRateLimitsForTests();
  delete process.env.X_SOCIAL_CONSUMER_KEY;
  delete process.env.X_SOCIAL_CONSUMER_SECRET;
});

describe("GET /api/social/x/status", () => {
  it("reports not configured when X_SOCIAL_CONSUMER_KEY is unset", async () => {
    const response = await xStatus(getRequest("/api/social/x/status"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { configured: boolean };
    expect(body.configured).toBe(false);
  });

  it("reports configured once both X consumer keys are set, without ever returning them", async () => {
    process.env.X_SOCIAL_CONSUMER_KEY = "consumer-key-super-secret-token";
    process.env.X_SOCIAL_CONSUMER_SECRET = "consumer-secret-super-secret-token";
    const response = await xStatus(getRequest("/api/social/x/status"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("super-secret-token");
    expect(JSON.parse(text)).toEqual({ configured: true });
  });

  it("treats a missing secret or a whitespace-only key as not configured", async () => {
    process.env.X_SOCIAL_CONSUMER_KEY = "   ";
    process.env.X_SOCIAL_CONSUMER_SECRET = "consumer-secret";
    const response = await xStatus(getRequest("/api/social/x/status"));
    const body = (await response.json()) as { configured: boolean };
    expect(body.configured).toBe(false);
  });
});
