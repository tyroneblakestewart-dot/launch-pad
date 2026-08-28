import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTokenMarketStats } from "@/lib/server/token-market-stats";

const ADDRESS = "0x3bf7447cd055f1475a8b09090c7b062abc9d3798";
const LP_ADDRESS = "0xLPPOOL0000000000000000000000000000000001";

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeFetchMock(options: {
  info?: Record<string, unknown> | null;
  holders?: Array<{ address?: { hash?: string }; value?: string }> | null;
  pairs?: unknown[];
  reject?: boolean;
}) {
  const { info, holders, pairs = [], reject = false } = options;
  return vi.fn(async (input: RequestInfo | URL) => {
    if (reject) throw new Error("network down");
    const url = String(input);
    if (url.includes("api.dexscreener.com")) {
      return new Response(JSON.stringify({ pairs }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/holders")) {
      return new Response(holders === undefined || holders === null ? null : JSON.stringify({ items: holders }), {
        status: holders === undefined || holders === null ? 404 : 200,
      });
    }
    return new Response(info === undefined || info === null ? null : JSON.stringify(info), {
      status: info === undefined || info === null ? 404 : 200,
    });
  });
}

describe("fetchTokenMarketStats", () => {
  it("returns unsupported for a chain with no confirmed data source", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchTokenMarketStats("solana", ADDRESS)).toEqual({ supported: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("has chart: reports live chart, price, liquidity, volume and market cap from the best Dexscreener pair", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        info: { name: "Sheriff Money", symbol: "SHRF", decimals: "18" },
        holders: [{ address: { hash: "0xWhale1" }, value: "100" }],
        pairs: [
          {
            chainId: "robinhood",
            dexId: "uniswap",
            pairAddress: LP_ADDRESS,
            url: "https://dexscreener.com/robinhood/pair-1",
            priceUsd: "0.0002486",
            liquidity: { usd: 61_200 },
            volume: { h24: 92_400 },
            priceChange: { h24: 34.7 },
            marketCap: 248_600,
          },
        ],
      }),
    );

    const stats = await fetchTokenMarketStats("robinhood", ADDRESS);
    if (!stats.supported) throw new Error("expected supported stats");

    expect(stats.chart).toEqual({
      found: true,
      pairUrl: "https://dexscreener.com/robinhood/pair-1",
      embedUrl: "https://dexscreener.com/robinhood/pair-1?embed=1&theme=dark&trades=0&info=0",
      dexId: "uniswap",
    });
    expect(stats.name).toBe("Sheriff Money");
    expect(stats.symbol).toBe("SHRF");
    expect(stats.priceUsd).toBeCloseTo(0.0002486);
    expect(stats.liquidityUsd).toBe(61_200);
    expect(stats.volume24hUsd).toBe(92_400);
    expect(stats.marketCapUsd).toBe(248_600);
    expect(stats.priceChange24hPercent).toBe(34.7);
    expect(stats.lpAddress).toBe(LP_ADDRESS.toLowerCase());
  });

  it("no liquidity: degrades to an unfound chart and null liquidity/volume/price without a Dexscreener pair", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        info: { name: "Sheriff Money", symbol: "SHRF", decimals: "18", circulating_market_cap: "12000" },
        holders: [],
        pairs: [],
      }),
    );

    const stats = await fetchTokenMarketStats("robinhood", ADDRESS);
    if (!stats.supported) throw new Error("expected supported stats");

    expect(stats.chart).toEqual({ found: false });
    expect(stats.liquidityUsd).toBeNull();
    expect(stats.volume24hUsd).toBeNull();
    expect(stats.priceUsd).toBeNull();
    expect(stats.lpAddress).toBeNull();
    // Falls back to Blockscout's circulating market cap when no pair exists yet.
    expect(stats.marketCapUsd).toBe(12_000);
  });

  it("resolves to a graceful degraded result instead of throwing when every request fails", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ reject: true }));

    const stats = await fetchTokenMarketStats("robinhood", ADDRESS);
    expect(stats).toMatchObject({ supported: true, chart: { found: false }, holders: [] });
    if (!stats.supported) throw new Error("expected supported stats");
    expect(stats.error).toBeTruthy();
  });
});
