import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRobinhoodTrendingTokens,
  mapGmgnPayloadToTrendingTokens,
} from "@/lib/server/robinhood-trending";

const ORIGINAL_API_KEY = process.env.GMGN_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
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
