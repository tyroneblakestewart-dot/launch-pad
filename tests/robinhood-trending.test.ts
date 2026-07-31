import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRobinhoodTrendingTokens,
  fetchSolanaTrendingTokens,
  mapGmgnPayloadToTrendingTokens,
  resetSolanaTrendingCacheForTests,
} from "@/lib/server/robinhood-trending";

const ORIGINAL_API_KEY = process.env.GMGN_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  resetSolanaTrendingCacheForTests();
  if (ORIGINAL_API_KEY === undefined) delete process.env.GMGN_API_KEY;
  else process.env.GMGN_API_KEY = ORIGINAL_API_KEY;
});

describe("mapGmgnPayloadToTrendingTokens", () => {
  it("maps a ranked GMGN payload into trending tokens with 1-based ranks", () => {
    const tokens = mapGmgnPayloadToTrendingTokens({
      data: {
        rank: [
          {
            address: "0xabc",
            symbol: "KL",
            name: "kl",
            logo: "https://example.com/kl.png",
            usd_market_cap: 2_100_000,
            price_change_percent5m: 184,
          },
          {
            address: "0xdef",
            symbol: "PEEPS",
            usd_market_cap: 890_000,
            price_change_percent5m: -12.4,
          },
        ],
      },
    });

    expect(tokens).toEqual([
      {
        rank: 1,
        name: "kl",
        ticker: "KL",
        address: "0xabc",
        artworkUrl: "https://example.com/kl.png",
        marketCapUsd: 2_100_000,
        priceChangePercent: 184,
        url: "https://gmgn.ai/robinhood/token/0xabc",
      },
      {
        rank: 2,
        name: "PEEPS",
        ticker: "PEEPS",
        address: "0xdef",
        artworkUrl: "",
        marketCapUsd: 890_000,
        priceChangePercent: -12.4,
        url: "https://gmgn.ai/robinhood/token/0xdef",
      },
    ]);
  });

  it("also accepts a bare array under data", () => {
    const tokens = mapGmgnPayloadToTrendingTokens({
      data: [{ address: "0x1", symbol: "A" }],
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].ticker).toBe("A");
  });

  it("drops entries without an address or without any name/symbol", () => {
    const tokens = mapGmgnPayloadToTrendingTokens({
      data: { rank: [{ symbol: "NOADDR" }, { address: "0x1" }, { address: "0x2", name: "Ok" }] },
    });
    expect(tokens).toEqual([
      expect.objectContaining({ address: "0x2", name: "Ok" }),
    ]);
  });

  it("returns an empty array for missing or malformed payloads", () => {
    expect(mapGmgnPayloadToTrendingTokens(null)).toEqual([]);
    expect(mapGmgnPayloadToTrendingTokens(undefined)).toEqual([]);
    expect(mapGmgnPayloadToTrendingTokens({})).toEqual([]);
    expect(mapGmgnPayloadToTrendingTokens({ data: { rank: "not-an-array" as never } })).toEqual([]);
  });

  it("caps the feed at 10 tokens", () => {
    const rank = Array.from({ length: 15 }, (_, index) => ({
      address: `0x${index}`,
      symbol: `T${index}`,
    }));
    expect(mapGmgnPayloadToTrendingTokens({ data: { rank } })).toHaveLength(10);
  });
});

describe("fetchRobinhoodTrendingTokens", () => {
  it("returns an error result without calling GMGN when no API key is configured", async () => {
    delete process.env.GMGN_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchRobinhoodTrendingTokens()).toEqual({ tokens: [], error: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the confirmed GMGN endpoint with a bearer token and maps the response", async () => {
    process.env.GMGN_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { rank: [{ address: "0xabc", symbol: "KL" }] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRobinhoodTrendingTokens();

    expect(result.error).toBe(false);
    expect(result.tokens).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://gmgn.ai/defi/quotation/v1/rank/robinhood/swaps/5m?orderby=swaps&direction=desc",
    );
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["User-Agent"]).toContain("Mozilla/5.0");
  });

  it("returns an error result when GMGN responds with a non-success status", async () => {
    process.env.GMGN_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));

    expect(await fetchRobinhoodTrendingTokens()).toEqual({ tokens: [], error: true });
  });

  it("returns an error result on network failure or bad JSON instead of throwing", async () => {
    process.env.GMGN_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await fetchRobinhoodTrendingTokens()).toEqual({ tokens: [], error: true });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    expect(await fetchRobinhoodTrendingTokens()).toEqual({ tokens: [], error: true });
  });
});

describe("fetchSolanaTrendingTokens", () => {
  function makeFetchMock(options: {
    boosts?: Array<{ chainId?: string; tokenAddress?: string }> | null;
    boostsStatus?: number;
    pairsByAddress?: Record<string, unknown[]>;
  }) {
    const { boosts = [], boostsStatus = 200, pairsByAddress = {} } = options;
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("token-boosts/top/v1")) {
        return new Response(JSON.stringify(boosts), {
          status: boostsStatus,
          headers: { "Content-Type": "application/json" },
        });
      }
      const match = url.match(/tokens\/([^/?]+)/);
      const address = match ? decodeURIComponent(match[1]) : "";
      return new Response(JSON.stringify({ pairs: pairsByAddress[address] || [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  }

  it("discovers boosted Solana addresses, filters out other chains, and enriches each with Dexscreener pair data", async () => {
    const fetchMock = makeFetchMock({
      boosts: [
        { chainId: "solana", tokenAddress: "SoL111" },
        { chainId: "ethereum", tokenAddress: "0xignored" },
        { chainId: "solana", tokenAddress: "SoL222" },
      ],
      pairsByAddress: {
        SoL111: [
          {
            chainId: "solana",
            pairAddress: "pair-1",
            url: "https://dexscreener.com/solana/pair-1",
            liquidity: { usd: 500 },
            baseToken: { name: "Sol One", symbol: "SOL1", address: "SoL111" },
            priceChange: { h24: 12.5 },
            marketCap: 1_500_000,
            info: { imageUrl: "https://example.com/sol1.png" },
          },
        ],
        SoL222: [
          {
            chainId: "solana",
            pairAddress: "pair-2",
            liquidity: { usd: 900 },
            baseToken: { symbol: "SOL2", address: "SoL222" },
            priceChange: { h24: -4 },
            fdv: 400_000,
          },
        ],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSolanaTrendingTokens();

    expect(result.error).toBe(false);
    expect(result.tokens).toEqual([
      {
        rank: 1,
        name: "Sol One",
        ticker: "SOL1",
        address: "SoL111",
        artworkUrl: "https://example.com/sol1.png",
        marketCapUsd: 1_500_000,
        priceChangePercent: 12.5,
        url: "https://dexscreener.com/solana/pair-1",
      },
      {
        rank: 2,
        name: "SOL2",
        ticker: "SOL2",
        address: "SoL222",
        artworkUrl: "",
        marketCapUsd: 400_000,
        priceChangePercent: -4,
        url: "https://dexscreener.com/solana/SoL222",
      },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("token-boosts/top/v1");
  });

  it("caps enrichment at 10 boosted Solana addresses", async () => {
    const boosts = Array.from({ length: 15 }, (_, index) => ({
      chainId: "solana",
      tokenAddress: `Addr${index}`,
    }));
    const pairsByAddress = Object.fromEntries(
      boosts.map((item) => [
        item.tokenAddress,
        [{ chainId: "solana", pairAddress: item.tokenAddress, baseToken: { symbol: "T", address: item.tokenAddress } }],
      ]),
    );
    const fetchMock = makeFetchMock({ boosts, pairsByAddress });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSolanaTrendingTokens();

    expect(result.tokens).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(11); // 1 boosts request + 10 enrichment requests
  });

  it("returns an empty, non-error result when no Solana tokens are currently boosted", async () => {
    const fetchMock = makeFetchMock({ boosts: [{ chainId: "ethereum", tokenAddress: "0xabc" }] });
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchSolanaTrendingTokens()).toEqual({ tokens: [], error: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips addresses with no matching Dexscreener pair data, without failing the whole feed", async () => {
    const fetchMock = makeFetchMock({
      boosts: [
        { chainId: "solana", tokenAddress: "Good1" },
        { chainId: "solana", tokenAddress: "Empty1" },
      ],
      pairsByAddress: {
        Good1: [{ chainId: "solana", pairAddress: "p1", baseToken: { symbol: "G", address: "Good1" } }],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSolanaTrendingTokens();
    expect(result.error).toBe(false);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].ticker).toBe("G");
  });

  it("returns an error result when the boosts feed responds with a non-success status", async () => {
    const fetchMock = makeFetchMock({ boosts: [], boostsStatus: 503 });
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchSolanaTrendingTokens()).toEqual({ tokens: [], error: true });
  });

  it("returns an error result on network failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await fetchSolanaTrendingTokens()).toEqual({ tokens: [], error: true });
  });

  it("caches the combined result for the TTL window instead of re-fetching on every call", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetchMock = makeFetchMock({
      boosts: [{ chainId: "solana", tokenAddress: "Cache1" }],
      pairsByAddress: {
        Cache1: [{ chainId: "solana", pairAddress: "p1", baseToken: { symbol: "C", address: "Cache1" } }],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchSolanaTrendingTokens();
    await fetchSolanaTrendingTokens();
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 boosts + 1 enrichment, cached on the second call

    now.mockReturnValue(1_000_000 + 30_001);
    await fetchSolanaTrendingTokens();
    expect(fetchMock).toHaveBeenCalledTimes(4);

    now.mockRestore();
  });
});
