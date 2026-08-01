import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GmgnMarketError,
  getCachedRobinhoodTrending,
  requestRobinhoodTrending,
  resetGmgnMarketCacheForTests,
} from "@/lib/server/gmgn-market";

const API_KEY = "gmgn-test-key";
const ADDRESS = "0x1111111111111111111111111111111111111111";

function providerResponse(rank: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ code: status === 200 ? 0 : 1, data: { rank } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  resetGmgnMarketCacheForTests();
  vi.restoreAllMocks();
});

describe("GMGN Robinhood trending adapter", () => {
  it("uses exist-auth headers and requests Robinhood volume rankings", async () => {
    const fetchMock = vi.fn(async () => providerResponse([
      {
        address: ADDRESS,
        name: "Hood Test",
        symbol: "HOOD",
        rank: "1",
        price: "0.00012",
        market_cap: "125000",
        liquidity: 42000,
        volume: "88000",
        swaps: "321",
        holder_count: 777,
        price_change_percent5m: "12.5",
        dev_team_hold_rate: "0.04",
        smart_degen_count: "3",
        launchpad_platform: "hoodlums",
      },
    ]));

    const result = await requestRobinhoodTrending(API_KEY, "5m", {
      fetchImpl: fetchMock as typeof fetch,
      now: () => 1_700_000_000_000,
      clientId: () => "11111111-1111-4111-8111-111111111111",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe("https://openapi.gmgn.ai/v1/market/rank");
    expect(url.searchParams.get("chain")).toBe("robinhood");
    expect(url.searchParams.get("interval")).toBe("5m");
    expect(url.searchParams.get("order_by")).toBe("volume");
    expect(url.searchParams.get("limit")).toBe("8");
    expect(url.searchParams.get("timestamp")).toBe("1700000000");
    expect(url.searchParams.get("client_id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(new Headers(init?.headers).get("X-APIKEY")).toBe(API_KEY);

    expect(result).toEqual({
      source: "GMGN",
      interval: "5m",
      updatedAt: "2023-11-14T22:13:20.000Z",
      tokens: [
        {
          address: ADDRESS,
          name: "Hood Test",
          symbol: "HOOD",
          rank: 1,
          priceUsd: 0.00012,
          marketCapUsd: 125000,
          liquidityUsd: 42000,
          volumeUsd: 88000,
          swaps: 321,
          holders: 777,
          priceChangePercent: 12.5,
          devTeamHoldRate: 0.04,
          smartMoneyCount: 3,
          launchpad: "hoodlums",
        },
      ],
    });
  });

  it("drops malformed entries instead of inventing token identities", async () => {
    const fetchMock = vi.fn(async () => providerResponse([
      null,
      { address: "not-an-address", symbol: "BAD" },
      { address: ADDRESS, name: "Valid", symbol: "VAL" },
    ]));

    const result = await requestRobinhoodTrending(API_KEY, "1h", {
      fetchImpl: fetchMock as typeof fetch,
      now: () => 2_000,
      clientId: () => "22222222-2222-4222-8222-222222222222",
    });

    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]).toMatchObject({ address: ADDRESS, name: "Valid", symbol: "VAL" });
  });

  it("coalesces repeat requests inside the server cache window", async () => {
    const fetchMock = vi.fn(async () => providerResponse([
      { address: ADDRESS, name: "Cached", symbol: "CACHE" },
    ]));
    let now = 10_000;
    const options = {
      fetchImpl: fetchMock as typeof fetch,
      now: () => now,
      clientId: () => "33333333-3333-4333-8333-333333333333",
    };

    await getCachedRobinhoodTrending(API_KEY, "5m", options);
    await getCachedRobinhoodTrending(API_KEY, "5m", options);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 55_001;
    await getCachedRobinhoodTrending(API_KEY, "5m", options);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces provider status without response bodies or credentials", async () => {
    const fetchMock = vi.fn(async () => new Response("secret provider body", { status: 429 }));

    let caught: unknown;
    try {
      await requestRobinhoodTrending(API_KEY, "5m", {
        fetchImpl: fetchMock as typeof fetch,
        now: () => 2_000,
        clientId: () => "44444444-4444-4444-8444-444444444444",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GmgnMarketError);
    expect(caught).toMatchObject({ kind: "http", status: 429 });
    expect(String(caught)).not.toContain(API_KEY);
    expect(String(caught)).not.toContain("secret provider body");
  });
});
