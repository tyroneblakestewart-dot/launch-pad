import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/market/trending/route";
import {
  getRobinhoodTrendingTokens,
  resetGmgnTrendingCacheForTests,
} from "@/lib/server/gmgn-trending";

const API_KEY = "gmgn-test-key";
const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

function providerResponse() {
  return new Response(
    JSON.stringify({
      code: 0,
      data: [
        {
          address: ADDRESS,
          name: "Robin Token",
          symbol: "ROBIN",
          price: "0.00042",
          market_cap: "125000",
          liquidity: 42000,
          volume: "87500",
          swaps: 321,
          holder_count: 456,
          price_change_percent5m: 12.5,
          dev_team_hold_rate: 0.075,
          smart_degen_count: 4,
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  delete process.env.GMGN_API_KEY;
  vi.unstubAllGlobals();
  resetGmgnTrendingCacheForTests();
});

describe("GMGN Robinhood Chain trending client", () => {
  it("keeps the API key server-side, requests Robinhood 5m data and normalises metrics", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://openapi.gmgn.ai");
      expect(url.pathname).toBe("/v1/market/rank");
      expect(url.searchParams.get("chain")).toBe("robinhood");
      expect(url.searchParams.get("interval")).toBe("5m");
      expect(url.searchParams.get("order_by")).toBe("volume");
      expect(url.searchParams.get("client_id")).toBeTruthy();
      expect(url.searchParams.get("timestamp")).toBeTruthy();
      expect(new Headers(init?.headers).get("X-APIKEY")).toBe(API_KEY);
      return providerResponse();
    });

    const result = await getRobinhoodTrendingTokens("5m", {
      apiKey: API_KEY,
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.tokens).toEqual([
      {
        address: ADDRESS,
        name: "Robin Token",
        symbol: "ROBIN",
        price: 0.00042,
        marketCap: 125000,
        liquidity: 42000,
        volume: 87500,
        swaps: 321,
        holderCount: 456,
        priceChangePercent: 12.5,
        devHoldingRate: 0.075,
        smartMoneyCount: 4,
      },
    ]);
  });

  it("caches each interval briefly instead of calling GMGN on every visitor request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse());
    await getRobinhoodTrendingTokens("1h", {
      apiKey: API_KEY,
      fetchImpl: fetchMock as typeof fetch,
      now: 1_000,
    });
    await getRobinhoodTrendingTokens("1h", {
      apiKey: API_KEY,
      fetchImpl: fetchMock as typeof fetch,
      now: 20_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects missing server configuration without making a provider request", async () => {
    const fetchMock = vi.fn();
    await expect(
      getRobinhoodTrendingTokens("5m", { apiKey: "", fetchImpl: fetchMock as typeof fetch }),
    ).rejects.toThrow("GMGN market data is not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/market/trending", () => {
  it("rejects unsupported intervals", async () => {
    const response = await GET(new Request("https://hoodlums.dev/api/market/trending?interval=24h"));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns cached public JSON without exposing the API key", async () => {
    process.env.GMGN_API_KEY = API_KEY;
    const fetchMock = vi.fn().mockResolvedValue(providerResponse());
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("https://hoodlums.dev/api/market/trending?interval=5m"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=45");
    const payload = await response.json();
    expect(payload.tokens[0].symbol).toBe("ROBIN");
    expect(JSON.stringify(payload)).not.toContain(API_KEY);
  });
});

describe("bonding page market activity wiring", () => {
  it("shows the Robinhood trending component with 5m and 1h controls and a risk notice", async () => {
    const root = process.cwd();
    const [page, component] = await Promise.all([
      readFile(path.join(root, "app/(app)/bonding-curve/page.tsx"), "utf8"),
      readFile(path.join(root, "components/robinhood-trending-tokens.tsx"), "utf8"),
    ]);
    expect(page).toContain("<RobinhoodTrendingTokens />");
    expect(component).toContain("/api/market/trending?interval=${interval}");
    expect(component).toContain('["5m", "1h"]');
    expect(component).toContain("not a safety check or investment recommendation");
    expect(component).not.toContain("GMGN_API_KEY");
  });
});
