import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTrendingToken,
  fetchRobinhoodTrendingTokens,
  filterRobinhoodBoosts,
  resetRobinhoodTrendingCacheForTests,
} from "@/lib/server/robinhood-trending";

beforeEach(() => {
  resetRobinhoodTrendingCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRobinhoodTrendingCacheForTests();
});

describe("filterRobinhoodBoosts", () => {
  it("keeps only entries whose chainId names Robinhood Chain", () => {
    const result = filterRobinhoodBoosts([
      { chainId: "solana", tokenAddress: "0x1" },
      { chainId: "robinhood", tokenAddress: "0x2" },
      { chainId: "Robinhood-Testnet", tokenAddress: "0x3" },
    ]);
    expect(result).toEqual([
      { chainId: "robinhood", tokenAddress: "0x2" },
      { chainId: "Robinhood-Testnet", tokenAddress: "0x3" },
    ]);
  });

  it("drops malformed entries and non-array payloads", () => {
    expect(filterRobinhoodBoosts(null)).toEqual([]);
    expect(filterRobinhoodBoosts(undefined)).toEqual([]);
    expect(
      filterRobinhoodBoosts([{ chainId: "robinhood" }, { tokenAddress: "0x1" }, "not-an-object"]),
    ).toEqual([]);
  });

  it("caps the feed at 10 tokens", () => {
    const boosts = Array.from({ length: 15 }, (_, index) => ({
      chainId: "robinhood",
      tokenAddress: `0x${index}`,
    }));
    expect(filterRobinhoodBoosts(boosts)).toHaveLength(10);
  });
});

describe("buildTrendingToken", () => {
  it("maps a boost and its best pair into a trending token", () => {
    const token = buildTrendingToken(
      { chainId: "robinhood", tokenAddress: "0xabc", icon: "https://example.com/kl.png" },
      {
        baseToken: { name: "kl", symbol: "KL" },
        priceChange: { m5: 184 },
        marketCap: 2_100_000,
        url: "https://dexscreener.com/robinhood/0xabc",
      },
      1,
    );
    expect(token).toEqual({
      rank: 1,
      name: "kl",
      ticker: "KL",
      address: "0xabc",
      artworkUrl: "https://example.com/kl.png",
      marketCapUsd: 2_100_000,
      priceChangePercent: 184,
      url: "https://dexscreener.com/robinhood/0xabc",
    });
  });

  it("falls back to a dexscreener URL and zeroed stats when no pair is found", () => {
    const token = buildTrendingToken({ chainId: "robinhood", tokenAddress: "0xdef" }, null, 2);
    expect(token).toEqual({
      rank: 2,
      name: "Unknown",
      ticker: "?",
      address: "0xdef",
      artworkUrl: "",
      marketCapUsd: 0,
      priceChangePercent: 0,
      url: "https://dexscreener.com/robinhood/0xdef",
    });
  });

  it("returns null for a boost missing its address or chain", () => {
    expect(buildTrendingToken({ tokenAddress: "0x1" }, null, 1)).toBeNull();
    expect(buildTrendingToken({ chainId: "robinhood" }, null, 1)).toBeNull();
  });
});

describe("fetchRobinhoodTrendingTokens", () => {
  it("returns an empty, non-error result when there are no Robinhood-chain boosts", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify([{ chainId: "solana", tokenAddress: "0x1" }]), {
            status: 200,
          }),
        ),
    );
    expect(await fetchRobinhoodTrendingTokens()).toEqual({ tokens: [], error: false });
  });

  it("fetches boosts then enriches each with its best pair", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("token-boosts/top/v1")) {
        return new Response(
          JSON.stringify([{ chainId: "robinhood", tokenAddress: "0xabc", icon: "icon.png" }]),
          { status: 200 },
        );
      }
      if (String(url).includes("token-pairs/v1/robinhood/0xabc")) {
        return new Response(
          JSON.stringify([
            {
              baseToken: { name: "kl", symbol: "KL" },
              priceChange: { m5: 12 },
              marketCap: 500_000,
              liquidity: { usd: 10_000 },
              url: "https://dexscreener.com/robinhood/0xabc",
            },
          ]),
          { status: 200 },
        );
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRobinhoodTrendingTokens();
    expect(result).toEqual({
      tokens: [
        {
          rank: 1,
          name: "kl",
          ticker: "KL",
          address: "0xabc",
          artworkUrl: "icon.png",
          marketCapUsd: 500_000,
          priceChangePercent: 12,
          url: "https://dexscreener.com/robinhood/0xabc",
        },
      ],
      error: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an error result when the boosts request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));
    expect(await fetchRobinhoodTrendingTokens()).toEqual({ tokens: [], error: true });
  });

  it("returns an error result on network failure or bad JSON instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await fetchRobinhoodTrendingTokens()).toEqual({ tokens: [], error: true });

    resetRobinhoodTrendingCacheForTests();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    expect(await fetchRobinhoodTrendingTokens()).toEqual({ tokens: [], error: true });
  });

  it("still returns the boosted token even if its pair lookup fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("token-boosts/top/v1")) {
        return new Response(JSON.stringify([{ chainId: "robinhood", tokenAddress: "0xabc" }]), {
          status: 200,
        });
      }
      return new Response("down", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRobinhoodTrendingTokens();
    expect(result).toEqual({
      tokens: [
        {
          rank: 1,
          name: "Unknown",
          ticker: "?",
          address: "0xabc",
          artworkUrl: "",
          marketCapUsd: 0,
          priceChangePercent: 0,
          url: "https://dexscreener.com/robinhood/0xabc",
        },
      ],
      error: false,
    });
  });

  it("caches results for repeat calls within the TTL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchRobinhoodTrendingTokens();
    await fetchRobinhoodTrendingTokens();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
