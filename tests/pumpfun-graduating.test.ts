import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchGraduatingTokens,
  mapMoralisBondingPayloadToGraduatingTokens,
  resetGraduatingFeedCacheForTests,
} from "@/lib/server/pumpfun-graduating";

const ORIGINAL_API_KEY = process.env.MORALIS_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  resetGraduatingFeedCacheForTests();
  if (ORIGINAL_API_KEY === undefined) delete process.env.MORALIS_API_KEY;
  else process.env.MORALIS_API_KEY = ORIGINAL_API_KEY;
});

describe("mapMoralisBondingPayloadToGraduatingTokens", () => {
  it("keeps only tokens with progress in the 60-99% window, sorted descending", () => {
    const tokens = mapMoralisBondingPayloadToGraduatingTokens([
      { tokenAddress: "A", symbol: "A", bondingCurveProgress: 59.9 },
      { tokenAddress: "B", symbol: "B", bondingCurveProgress: 60 },
      { tokenAddress: "C", symbol: "C", bondingCurveProgress: 99 },
      { tokenAddress: "D", symbol: "D", bondingCurveProgress: 99.1 },
      { tokenAddress: "E", symbol: "E", bondingCurveProgress: 75 },
    ]);

    expect(tokens.map((t) => t.address)).toEqual(["C", "E", "B"]);
  });

  it("also accepts a payload wrapped under result", () => {
    const tokens = mapMoralisBondingPayloadToGraduatingTokens({
      result: [{ tokenAddress: "A", symbol: "A", bondingCurveProgress: 70 }],
    });
    expect(tokens).toHaveLength(1);
  });

  it("maps name, ticker, artwork and pump.fun url", () => {
    const tokens = mapMoralisBondingPayloadToGraduatingTokens([
      {
        tokenAddress: "Addr1",
        name: "Doggo",
        symbol: "DOGGO",
        logo: "https://example.com/doggo.png",
        bondingCurveProgress: 80,
      },
    ]);

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
    const tokens = mapMoralisBondingPayloadToGraduatingTokens([
      { tokenAddress: "Addr1", symbol: "NONAME", bondingCurveProgress: 80 },
    ]);
    expect(tokens[0].name).toBe("NONAME");
    expect(tokens[0].artworkUrl).toBe("");
  });

  it("drops entries missing an address, a ticker, or a numeric bonding progress", () => {
    const tokens = mapMoralisBondingPayloadToGraduatingTokens([
      { symbol: "NOADDR", bondingCurveProgress: 70 },
      { tokenAddress: "Addr1", bondingCurveProgress: 70 },
      { tokenAddress: "Addr2", symbol: "NOPROGRESS" },
      { tokenAddress: "Addr3", symbol: "BAD", bondingCurveProgress: "not-a-number" },
      { tokenAddress: "Addr4", symbol: "OK", bondingCurveProgress: 70 },
    ]);
    expect(tokens).toEqual([expect.objectContaining({ address: "Addr4" })]);
  });

  it("returns an empty array for missing or malformed payloads", () => {
    expect(mapMoralisBondingPayloadToGraduatingTokens(null)).toEqual([]);
    expect(mapMoralisBondingPayloadToGraduatingTokens(undefined)).toEqual([]);
    expect(mapMoralisBondingPayloadToGraduatingTokens({})).toEqual([]);
    expect(mapMoralisBondingPayloadToGraduatingTokens({ result: "not-an-array" as never })).toEqual([]);
  });

  it("caps the row at 6 tokens even when more qualify", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      tokenAddress: `Addr${index}`,
      symbol: `T${index}`,
      bondingCurveProgress: 60 + index,
    }));
    expect(mapMoralisBondingPayloadToGraduatingTokens(items)).toHaveLength(6);
  });

  it("keeps a token when no last-trade timestamp field is present at all (Moralis never sends one)", () => {
    const tokens = mapMoralisBondingPayloadToGraduatingTokens([
      { tokenAddress: "Addr1", symbol: "OK", bondingCurveProgress: 70 },
    ]);
    expect(tokens).toHaveLength(1);
  });

  it("drops a token only when a present timestamp is older than the ~10 minute staleness window", () => {
    const now = 1_700_000_000_000;

    const stale = mapMoralisBondingPayloadToGraduatingTokens(
      [
        {
          tokenAddress: "Stale",
          symbol: "STALE",
          bondingCurveProgress: 70,
          lastTradeTimestamp: now - 11 * 60 * 1000,
        },
      ],
      now,
    );
    expect(stale).toEqual([]);

    const fresh = mapMoralisBondingPayloadToGraduatingTokens(
      [
        {
          tokenAddress: "Fresh",
          symbol: "FRESH",
          bondingCurveProgress: 70,
          lastTradeTimestamp: now - 5 * 60 * 1000,
        },
      ],
      now,
    );
    expect(fresh).toHaveLength(1);
  });

  it("accepts alias timestamp field names and both seconds and milliseconds epochs", () => {
    const now = 1_700_000_000_000;
    const fiveMinutesAgoSeconds = Math.floor((now - 5 * 60 * 1000) / 1000);

    const tokens = mapMoralisBondingPayloadToGraduatingTokens(
      [
        {
          tokenAddress: "Addr1",
          symbol: "A",
          bondingCurveProgress: 70,
          last_trade_timestamp: fiveMinutesAgoSeconds,
        },
      ],
      now,
    );
    expect(tokens).toHaveLength(1);
  });
});

describe("fetchGraduatingTokens", () => {
  it("returns an error result without calling Moralis when no API key is configured", async () => {
    delete process.env.MORALIS_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchGraduatingTokens()).toEqual({ tokens: [], error: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the Moralis bonding-tokens endpoint with the API key header and maps the response", async () => {
    process.env.MORALIS_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([{ tokenAddress: "Addr1", symbol: "A", bondingCurveProgress: 70 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGraduatingTokens();

    expect(result.error).toBe(false);
    expect(result.tokens).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/bonding");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("test-key");
  });

  it("returns an error result when Moralis responds with a non-success status", async () => {
    process.env.MORALIS_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));

    expect(await fetchGraduatingTokens()).toEqual({ tokens: [], error: true });
  });

  it("returns an error result on network failure or bad JSON instead of throwing", async () => {
    process.env.MORALIS_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await fetchGraduatingTokens()).toEqual({ tokens: [], error: true });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    expect(await fetchGraduatingTokens()).toEqual({ tokens: [], error: true });
  });

  it("caches the result for the TTL window instead of re-fetching on every call", async () => {
    process.env.MORALIS_API_KEY = "test-key";
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ tokenAddress: "Addr1", symbol: "A", bondingCurveProgress: 70 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
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
