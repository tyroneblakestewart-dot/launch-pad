import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/market/robinhood-trending/route";
import {
  GENERATE_SITE_STYLE_HEADER,
  ROBINHOOD_TRENDING_LIMIT,
  resetRobinhoodTrendingRateLimitForTests,
} from "@/lib/server/api-protection";
import { resetGmgnMarketCacheForTests } from "@/lib/server/gmgn-market";

const SECRET = "hoodlums-market-test-secret";
const ORIGIN = "https://hoodlums.dev";
const IP = "203.0.113.99";
const ADDRESS = "0x2222222222222222222222222222222222222222";

function request(
  headers: Record<string, string> = {},
  body: unknown = { interval: "5m" },
): Request {
  return new Request("https://hoodlums.dev/api/market/robinhood-trending", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "X-Forwarded-For": IP,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.GENERATE_SITE_STYLE_SHARED_SECRET = SECRET;
  process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN = ORIGIN;
  process.env.GMGN_API_KEY = "gmgn-route-test-key";
  resetRobinhoodTrendingRateLimitForTests();
  resetGmgnMarketCacheForTests();
});

afterEach(() => {
  delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
  delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
  delete process.env.GMGN_API_KEY;
  resetRobinhoodTrendingRateLimitForTests();
  resetGmgnMarketCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/market/robinhood-trending", () => {
  it("rejects missing or wrong shared secrets", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const headers of [
      {},
      { [GENERATE_SITE_STYLE_HEADER]: "wrong" },
    ]) {
      const response = await POST(request(headers));
      expect(response.status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a disallowed Origin", async () => {
    const response = await POST(request({
      Origin: "https://evil.example",
      [GENERATE_SITE_STYLE_HEADER]: SECRET,
    }));
    expect(response.status).toBe(401);
  });

  it("rejects unsupported intervals before calling GMGN", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(
      { [GENERATE_SITE_STYLE_HEADER]: SECRET },
      { interval: "24h" },
    ));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Interval must be 5m or 1h." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns normalised Robinhood trending data without exposing the API key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: {
        rank: [{
          address: ADDRESS,
          name: "Robin Hood",
          symbol: "ROBIN",
          rank: 1,
          market_cap: 100000,
          liquidity: 25000,
          volume: 9000,
          swaps: 88,
          holder_count: 111,
        }],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ [GENERATE_SITE_STYLE_HEADER]: SECRET }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.source).toBe("GMGN");
    expect(payload.interval).toBe("5m");
    expect(payload.tokens).toHaveLength(1);
    expect(payload.tokens[0]).toMatchObject({
      address: ADDRESS,
      symbol: "ROBIN",
      marketCapUsd: 100000,
      volumeUsd: 9000,
    });
    expect(JSON.stringify(payload)).not.toContain("gmgn-route-test-key");
  });

  it("rate limits after 120 requests in one hour", async () => {
    delete process.env.GMGN_API_KEY;
    const authenticated = { [GENERATE_SITE_STYLE_HEADER]: SECRET };

    for (let index = 0; index < ROBINHOOD_TRENDING_LIMIT; index += 1) {
      const response = await POST(request(authenticated));
      expect(response.status).toBe(503);
    }

    const blocked = await POST(request(authenticated));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("RateLimit-Remaining")).toBe("0");
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
