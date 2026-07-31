import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/trending-robinhood/route";
import {
  getRobinhoodTrending,
  mapGmgnPayloadToTrendingTokens,
  resetRobinhoodTrendingCacheForTests,
} from "@/lib/server/robinhood-trending";

async function responseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetRobinhoodTrendingCacheForTests();
});

describe("mapGmgnPayloadToTrendingTokens", () => {
  it("maps a data-array payload into ranked trending tokens", () => {
    const tokens = mapGmgnPayloadToTrendingTokens({
      data: [
        { symbol: "KL", name: "kl", address: "0xf3c2000000000000000000000000000000abcd", market_cap: 2_100_000, price_change_5m: 184, logo: "https://gmgn.ai/kl.png" },
        { symbol: "PEEPS", name: "PEEPS", address: "0xaaaa000000000000000000000000000000bbbb", market_cap: 890_000, price_change_5m: 67 },
      ],
    });

    expect(tokens).toEqual([
      {
        rank: 1,
        name: "kl",
        ticker: "KL",
        addressLabel: "0xf3c2…",
        marketCapUsd: 2_100_000,
        percentChange5m: 184,
        artworkUrl: "https://gmgn.ai/kl.png",
        linkUrl: `https://gmgn.ai/robinhood/token/${encodeURIComponent("0xf3c2000000000000000000000000000000abcd")}`,
      },
      {
        rank: 2,
        name: "PEEPS",
        ticker: "PEEPS",
        addressLabel: "0xaaaa…",
        marketCapUsd: 890_000,
        percentChange5m: 67,
        artworkUrl: "",
        linkUrl: `https://gmgn.ai/robinhood/token/${encodeURIComponent("0xaaaa000000000000000000000000000000bbbb")}`,
      },
    ]);
  });

  it("accepts a bare array payload and falls back safely on malformed entries", () => {
    const tokens = mapGmgnPayloadToTrendingTokens([{ market_cap: "not-a-number" }, null]);
    expect(tokens).toEqual([
      {
        rank: 1,
        name: "Unknown",
        ticker: "?",
        addressLabel: "",
        marketCapUsd: 0,
        percentChange5m: 0,
        artworkUrl: "",
        linkUrl: "https://gmgn.ai/",
      },
      {
        rank: 2,
        name: "Unknown",
        ticker: "?",
        addressLabel: "",
        marketCapUsd: 0,
        percentChange5m: 0,
        artworkUrl: "",
        linkUrl: "https://gmgn.ai/",
      },
    ]);
  });

  it("returns an empty list for an unrecognised payload shape", () => {
    expect(mapGmgnPayloadToTrendingTokens(null)).toEqual([]);
    expect(mapGmgnPayloadToTrendingTokens({})).toEqual([]);
    expect(mapGmgnPayloadToTrendingTokens("nope")).toEqual([]);
  });

  it("caps the list at 10 tokens", () => {
    const data = Array.from({ length: 15 }, (_, index) => ({ symbol: `T${index}` }));
    expect(mapGmgnPayloadToTrendingTokens({ data })).toHaveLength(10);
  });
});

describe("getRobinhoodTrending", () => {
  it("returns an error result without calling fetch when GMGN_API_KEY is unset", async () => {
    vi.stubEnv("GMGN_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await getRobinhoodTrending()).toEqual({ tokens: [], error: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and maps tokens when the API key is configured", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ symbol: "HOOD", name: "Hoodlums", address: "0xabc" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await getRobinhoodTrending();
    expect(result.error).toBe(false);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].ticker).toBe("HOOD");
  });

  it("returns an error result when the GMGN call fails or times out", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await getRobinhoodTrending()).toEqual({ tokens: [], error: true });
  });

  it("returns an error result for a non-success response", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));
    expect(await getRobinhoodTrending()).toEqual({ tokens: [], error: true });
  });

  it("caches the result across calls within the window", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getRobinhoodTrending();
    await getRobinhoodTrending();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/trending-robinhood", () => {
  it("returns a graceful unavailable payload when GMGN is not configured", async () => {
    vi.stubEnv("GMGN_API_KEY", "");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({ tokens: [], error: true });
  });
});
