import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchGraduatingTokens,
  mapPumpFunCoinsPayloadToGraduatingTokens,
  resetGraduatingFeedCacheForTests,
} from "@/lib/server/pumpfun-graduating";

afterEach(() => {
  vi.unstubAllGlobals();
  resetGraduatingFeedCacheForTests();
});

const NOW = 1_700_000_000_000;
const FRESH_TS = NOW - 5 * 60 * 1000;

// usd_market_cap values chosen so progress = market_cap / 69000 * 100:
// 41,400 -> 60%, 47,610 -> 69%, 68,310 -> 99%, 69,690 -> 101% (out of range)
describe("mapPumpFunCoinsPayloadToGraduatingTokens", () => {
  it("keeps only tokens with progress in the 60-99% window, sorted descending", () => {
    const tokens = mapPumpFunCoinsPayloadToGraduatingTokens(
      [
        { mint: "A", symbol: "A", usd_market_cap: 41_331, last_trade_timestamp: FRESH_TS }, // 59.9%
        { mint: "B", symbol: "B", usd_market_cap: 41_400, last_trade_timestamp: FRESH_TS }, // 60%
        { mint: "C", symbol: "C", usd_market_cap: 68_310, last_trade_timestamp: FRESH_TS }, // 99%
        { mint: "D", symbol: "D", usd_market_cap: 68_379, last_trade_timestamp: FRESH_TS }, // 99.1%
        { mint: "E", symbol: "E", usd_market_cap: 51_750, last_trade_timestamp: FRESH_TS }, // 75%
      ],
      NOW,
    );

    expect(tokens.map((t) => t.address)).toEqual(["C", "E", "B"]);
  });

  it("maps name, ticker, artwork and pump.fun url, deriving progress from market cap", () => {
    const tokens = mapPumpFunCoinsPayloadToGraduatingTokens(
      [
        {
          mint: "Addr1",
          name: "Doggo",
          symbol: "DOGGO",
          image_uri: "https://example.com/doggo.png",
          usd_market_cap: 55_200, // 80%
          last_trade_timestamp: FRESH_TS,
        },
      ],
      NOW,
    );

    expect(tokens).toEqual([
      {
        name: "Doggo",
        ticker: "DOGGO",
        address: "Addr1",
        artworkUrl: "https://example.com/doggo.png",
        progressPercent: 80,
        url: "https://pump.fun/coin/Addr1",
      },
    ]);
  });

  it("falls back to the ticker as the name, and an empty artwork url, when unset", () => {
    const tokens = mapPumpFunCoinsPayloadToGraduatingTokens(
      [{ mint: "Addr1", symbol: "NONAME", usd_market_cap: 55_200, last_trade_timestamp: FRESH_TS }],
      NOW,
    );
    expect(tokens[0].name).toBe("NONAME");
    expect(tokens[0].artworkUrl).toBe("");
  });

  it("excludes tokens already marked complete (already graduated)", () => {
    const tokens = mapPumpFunCoinsPayloadToGraduatingTokens(
      [
        {
          mint: "Addr1",
          symbol: "DONE",
          usd_market_cap: 55_200,
          complete: true,
          last_trade_timestamp: FRESH_TS,
        },
      ],
      NOW,
    );
    expect(tokens).toEqual([]);
  });

  it("drops entries missing a mint, a symbol, or a numeric market cap", () => {
    const tokens = mapPumpFunCoinsPayloadToGraduatingTokens(
      [
        { symbol: "NOADDR", usd_market_cap: 55_200, last_trade_timestamp: FRESH_TS },
        { mint: "Addr1", usd_market_cap: 55_200, last_trade_timestamp: FRESH_TS },
        { mint: "Addr2", symbol: "NOCAP", last_trade_timestamp: FRESH_TS },
        { mint: "Addr3", symbol: "BAD", usd_market_cap: "not-a-number", last_trade_timestamp: FRESH_TS },
        { mint: "Addr4", symbol: "OK", usd_market_cap: 55_200, last_trade_timestamp: FRESH_TS },
      ],
      NOW,
    );
    expect(tokens).toEqual([expect.objectContaining({ address: "Addr4" })]);
  });

  it("returns an empty array for missing or malformed payloads", () => {
    expect(mapPumpFunCoinsPayloadToGraduatingTokens(null)).toEqual([]);
    expect(mapPumpFunCoinsPayloadToGraduatingTokens(undefined)).toEqual([]);
    expect(mapPumpFunCoinsPayloadToGraduatingTokens({} as never)).toEqual([]);
  });

  it("caps the row at 6 tokens even when more qualify", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      mint: `Addr${index}`,
      symbol: `T${index}`,
      usd_market_cap: 41_400 + index * 100,
      last_trade_timestamp: FRESH_TS,
    }));
    expect(mapPumpFunCoinsPayloadToGraduatingTokens(items, NOW)).toHaveLength(6);
  });

  it("drops a token when no last-trade timestamp field is present at all", () => {
    const tokens = mapPumpFunCoinsPayloadToGraduatingTokens(
      [{ mint: "Addr1", symbol: "OK", usd_market_cap: 55_200 }],
      NOW,
    );
    expect(tokens).toEqual([]);
  });

  it("drops a token when its last-trade timestamp is older than the ~10 minute staleness window", () => {
    const stale = mapPumpFunCoinsPayloadToGraduatingTokens(
      [
        {
          mint: "Stale",
          symbol: "STALE",
          usd_market_cap: 55_200,
          last_trade_timestamp: NOW - 11 * 60 * 1000,
        },
      ],
      NOW,
    );
    expect(stale).toEqual([]);

    const fresh = mapPumpFunCoinsPayloadToGraduatingTokens(
      [
        {
          mint: "Fresh",
          symbol: "FRESH",
          usd_market_cap: 55_200,
          last_trade_timestamp: NOW - 5 * 60 * 1000,
        },
      ],
      NOW,
    );
    expect(fresh).toHaveLength(1);
  });

  it("accepts a camelCase alias timestamp field and both seconds and milliseconds epochs", () => {
    const fiveMinutesAgoSeconds = Math.floor((NOW - 5 * 60 * 1000) / 1000);

    const tokens = mapPumpFunCoinsPayloadToGraduatingTokens(
      [
        {
          mint: "Addr1",
          symbol: "A",
          usd_market_cap: 55_200,
          lastTradeTimestamp: fiveMinutesAgoSeconds,
        },
      ],
      NOW,
    );
    expect(tokens).toHaveLength(1);
  });

  it("clamps derived progress to 100 for market caps at or beyond the graduation threshold", () => {
    const tokens = mapPumpFunCoinsPayloadToGraduatingTokens(
      [{ mint: "Addr1", symbol: "OVER", usd_market_cap: 200_000, last_trade_timestamp: FRESH_TS }],
      NOW,
    );
    // Progress of 100 is above the 60-99 window, so it's filtered out either way.
    expect(tokens).toEqual([]);
  });
});

describe("fetchGraduatingTokens", () => {
  it("calls the pump.fun coins endpoint with no API key and maps the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { mint: "Addr1", symbol: "A", usd_market_cap: 55_200, last_trade_timestamp: Date.now() },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGraduatingTokens();

    expect(result.error).toBe(false);
    expect(result.tokens).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=market_cap&order=DESC&includeNsfw=false",
    );
    const headers = init?.headers as Record<string, string>;
    expect(headers["Accept"]).toBe("application/json");
  });

  it("returns an error result when pump.fun responds with a non-success status (e.g. an IP block)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("blocked", { status: 403 })));

    expect(await fetchGraduatingTokens()).toEqual({ tokens: [], error: true });
  });

  it("returns an error result on network failure or bad JSON instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await fetchGraduatingTokens()).toEqual({ tokens: [], error: true });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    expect(await fetchGraduatingTokens()).toEqual({ tokens: [], error: true });
  });

  it("caches the result for the TTL window instead of re-fetching on every call", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([{ mint: "Addr1", symbol: "A", usd_market_cap: 55_200, last_trade_timestamp: 1_000_000 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchGraduatingTokens();
    await fetchGraduatingTokens();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + 60_001);
    await fetchGraduatingTokens();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    now.mockRestore();
  });
});
