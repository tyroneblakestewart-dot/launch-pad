import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchGraduatingTokens,
  mapBitqueryPoolsToGraduatingTokens,
  resetGraduatingFeedCacheForTests,
  resolveGraduatingTokensArtwork,
} from "@/lib/server/pumpfun-graduating";
import type { GraduatingToken } from "@/lib/server/pumpfun-graduating";

const ORIGINAL_TOKEN = process.env.BITQUERY_ACCESS_TOKEN;

afterEach(() => {
  vi.unstubAllGlobals();
  resetGraduatingFeedCacheForTests();
  if (ORIGINAL_TOKEN === undefined) delete process.env.BITQUERY_ACCESS_TOKEN;
  else process.env.BITQUERY_ACCESS_TOKEN = ORIGINAL_TOKEN;
});

const NOW = 1_700_000_000_000;
const FRESH_TIME = new Date(NOW - 5 * 60 * 1000).toISOString();

// PostAmount maps to progress via 100 - ((PostAmount - 206_900_000) / 793_100_000 * 100).
// Window edges (verified against Bitquery's own 95-100% example):
//   214,831,000 -> 99% (upper bound, inclusive)
//   214,830,000 -> 99.000126...% (still inside)
//   524,140,000 -> 60% (lower bound, inclusive)
//   524,141,000 -> 59.99987...% (just outside)
//   206,900,000 -> 100% (fully graduated, outside window)
function pool(overrides: {
  mint?: string;
  symbol?: string;
  name?: string;
  uri?: string;
  postAmount?: number;
  time?: string;
}) {
  return {
    Block: { Time: overrides.time ?? FRESH_TIME },
    Pool: {
      Base: { PostAmount: overrides.postAmount ?? 524_140_000 },
      Market: {
        BaseCurrency: {
          MintAddress: overrides.mint ?? "Addr1",
          Name: overrides.name,
          Symbol: overrides.symbol ?? "SYM",
          Uri: overrides.uri,
        },
      },
    },
  };
}

function payload(pools: ReturnType<typeof pool>[]) {
  return { data: { Solana: { DEXPools: pools } } };
}

describe("mapBitqueryPoolsToGraduatingTokens", () => {
  it("keeps only pools with progress in the 60-99% window, sorted descending", () => {
    const tokens = mapBitqueryPoolsToGraduatingTokens(
      payload([
        pool({ mint: "A", symbol: "A", postAmount: 524_141_000 }), // 59.99987% -> excluded
        pool({ mint: "B", symbol: "B", postAmount: 524_140_000 }), // 60% -> included
        pool({ mint: "C", symbol: "C", postAmount: 214_831_000 }), // 99% -> included
        pool({ mint: "D", symbol: "D", postAmount: 214_830_000 }), // 99.0001% -> excluded
        pool({ mint: "E", symbol: "E", postAmount: 365_520_000 }), // 80% -> included
      ]),
      NOW,
    );

    expect(tokens.map((t) => t.address)).toEqual(["C", "E", "B"]);
  });

  it("maps mint, name, symbol, artwork uri and pump.fun url, deriving progress from PostAmount", () => {
    const tokens = mapBitqueryPoolsToGraduatingTokens(
      payload([
        pool({
          mint: "Addr1",
          name: "Doggo",
          symbol: "DOGGO",
          uri: "https://example.com/doggo.png",
          postAmount: 389_313_000, // 77% exactly: 206_900_000 + 7_931_000 * (100 - 77)
        }),
      ]),
      NOW,
    );

    expect(tokens).toEqual([
      {
        name: "Doggo",
        ticker: "DOGGO",
        address: "Addr1",
        artworkUrl: "https://example.com/doggo.png",
        progressPercent: 77,
        url: "https://pump.fun/coin/Addr1",
      },
    ]);
  });

  it("falls back to the symbol as the name, and an empty artwork url, when unset", () => {
    const tokens = mapBitqueryPoolsToGraduatingTokens(
      payload([pool({ mint: "Addr1", symbol: "NONAME", postAmount: 400_000_000 })]),
      NOW,
    );
    expect(tokens[0].name).toBe("NONAME");
    expect(tokens[0].artworkUrl).toBe("");
  });

  it("drops entries missing a mint address, a symbol, or a numeric PostAmount", () => {
    const tokens = mapBitqueryPoolsToGraduatingTokens(
      payload([
        pool({ mint: "", symbol: "NOADDR", postAmount: 400_000_000 }),
        pool({ mint: "Addr2", symbol: "", postAmount: 400_000_000 }),
        {
          Block: { Time: FRESH_TIME },
          Pool: { Base: {}, Market: { BaseCurrency: { MintAddress: "Addr3", Symbol: "NOCAP" } } },
        },
        pool({ mint: "Addr4", symbol: "OK", postAmount: 400_000_000 }),
      ]),
      NOW,
    );
    expect(tokens).toEqual([expect.objectContaining({ address: "Addr4" })]);
  });

  it("returns an empty array for missing or malformed payloads", () => {
    expect(mapBitqueryPoolsToGraduatingTokens(null)).toEqual([]);
    expect(mapBitqueryPoolsToGraduatingTokens(undefined)).toEqual([]);
    expect(mapBitqueryPoolsToGraduatingTokens({} as never)).toEqual([]);
    expect(mapBitqueryPoolsToGraduatingTokens({ data: { Solana: {} } } as never)).toEqual([]);
  });

  it("caps the row at 6 tokens even when more qualify", () => {
    const pools = Array.from({ length: 10 }, (_, index) =>
      pool({ mint: `Addr${index}`, symbol: `T${index}`, postAmount: 300_000_000 + index * 100 }),
    );
    expect(mapBitqueryPoolsToGraduatingTokens(payload(pools), NOW)).toHaveLength(6);
  });

  it("drops a pool when Block.Time is missing or unparseable", () => {
    const tokens = mapBitqueryPoolsToGraduatingTokens(
      payload([{ ...pool({ mint: "Addr1", symbol: "OK", postAmount: 400_000_000 }), Block: {} }]),
      NOW,
    );
    expect(tokens).toEqual([]);
  });

  it("drops a pool when its Block.Time is older than the ~10 minute staleness window", () => {
    const stale = mapBitqueryPoolsToGraduatingTokens(
      payload([
        pool({
          mint: "Stale",
          symbol: "STALE",
          postAmount: 400_000_000,
          time: new Date(NOW - 11 * 60 * 1000).toISOString(),
        }),
      ]),
      NOW,
    );
    expect(stale).toEqual([]);

    const fresh = mapBitqueryPoolsToGraduatingTokens(
      payload([
        pool({
          mint: "Fresh",
          symbol: "FRESH",
          postAmount: 400_000_000,
          time: new Date(NOW - 5 * 60 * 1000).toISOString(),
        }),
      ]),
      NOW,
    );
    expect(fresh).toHaveLength(1);
  });

  it("deduplicates by mint, keeping only the newest row per token", () => {
    const tokens = mapBitqueryPoolsToGraduatingTokens(
      payload([
        pool({
          mint: "Addr1",
          symbol: "OLD",
          postAmount: 400_000_000,
          time: new Date(NOW - 8 * 60 * 1000).toISOString(),
        }),
        pool({
          mint: "Addr1",
          symbol: "NEW",
          postAmount: 300_000_000,
          time: new Date(NOW - 1 * 60 * 1000).toISOString(),
        }),
      ]),
      NOW,
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0].ticker).toBe("NEW");
  });

  it("clamps derived progress to 100 for PostAmount at or below the graduation threshold", () => {
    const tokens = mapBitqueryPoolsToGraduatingTokens(
      payload([pool({ mint: "Addr1", symbol: "OVER", postAmount: 100_000_000 })]),
      NOW,
    );
    // Progress of 100 is above the 60-99 window, so it's filtered out either way.
    expect(tokens).toEqual([]);
  });
});

describe("fetchGraduatingTokens", () => {
  it("returns an error result and skips the network call when BITQUERY_ACCESS_TOKEN is unset", async () => {
    delete process.env.BITQUERY_ACCESS_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchGraduatingTokens()).toEqual({ tokens: [], error: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an error result when BITQUERY_ACCESS_TOKEN is empty", async () => {
    process.env.BITQUERY_ACCESS_TOKEN = "   ";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchGraduatingTokens()).toEqual({ tokens: [], error: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs a GraphQL query to Bitquery's EAP endpoint with a bearer token and maps the response", async () => {
    process.env.BITQUERY_ACCESS_TOKEN = "test-token";
    const realNowTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          payload([pool({ mint: "Addr1", symbol: "A", postAmount: 400_000_000, time: realNowTime })]),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGraduatingTokens();

    expect(result.error).toBe(false);
    expect(result.tokens).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://streaming.bitquery.io/eap");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init?.body as string);
    expect(body.query).toContain("DEXPools");
    expect(body.variables.program).toBe("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    expect(body.query).toContain("$minPostAmount: String!");
    expect(body.query).toContain("$maxPostAmount: String!");
    expect(body.variables.minPostAmount).toBe("214831000");
    expect(body.variables.maxPostAmount).toBe("524140000");
  });

  it("returns an error result when Bitquery responds with a non-success status", async () => {
    process.env.BITQUERY_ACCESS_TOKEN = "test-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));

    expect(await fetchGraduatingTokens()).toEqual({ tokens: [], error: true });
  });

  it("returns an error result when the response body contains GraphQL errors", async () => {
    process.env.BITQUERY_ACCESS_TOKEN = "test-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ message: "bad query" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    expect(await fetchGraduatingTokens()).toEqual({ tokens: [], error: true });
  });

  it("returns an error result on network failure or bad JSON instead of throwing", async () => {
    process.env.BITQUERY_ACCESS_TOKEN = "test-token";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await fetchGraduatingTokens()).toEqual({ tokens: [], error: true });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    expect(await fetchGraduatingTokens()).toEqual({ tokens: [], error: true });
  });

  it("caches the result for the TTL window instead of re-fetching on every call", async () => {
    process.env.BITQUERY_ACCESS_TOKEN = "test-token";
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          payload([
            pool({ mint: "Addr1", symbol: "A", postAmount: 400_000_000, time: new Date(1_000_000).toISOString() }),
          ]),
        ),
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

function graduatingToken(overrides: Partial<GraduatingToken> = {}): GraduatingToken {
  return {
    name: "Doggo",
    ticker: "DOGGO",
    address: "Addr1",
    artworkUrl: "",
    progressPercent: 80,
    url: "https://pump.fun/coin/Addr1",
    ...overrides,
  };
}

describe("resolveGraduatingTokensArtwork (issue #295)", () => {
  it("passes a direct (non-.json) artwork URI through unresolved, without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await resolveGraduatingTokensArtwork([
      graduatingToken({ artworkUrl: "https://example.com/doggo.png" }),
    ]);

    expect(tokens[0].artworkUrl).toBe("https://example.com/doggo.png");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rewrites a direct ipfs:// artwork URI to the public gateway without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await resolveGraduatingTokensArtwork([
      graduatingToken({ artworkUrl: "ipfs://bafybeidoggo/image.png" }),
    ]);

    expect(tokens[0].artworkUrl).toBe("https://ipfs.io/ipfs/bafybeidoggo/image.png");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a .json metadata URI and resolves artworkUrl from its image field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ image: "https://example.com/doggo-art.png" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await resolveGraduatingTokensArtwork([
      graduatingToken({ artworkUrl: "https://pump.fun/metadata/addr1.json" }),
    ]);

    expect(tokens[0].artworkUrl).toBe("https://example.com/doggo-art.png");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://pump.fun/metadata/addr1.json",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("rewrites an ipfs:// image field found inside metadata JSON to the public gateway", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ image: "ipfs://bafybeidoggo/art.png" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const tokens = await resolveGraduatingTokensArtwork([
      graduatingToken({ artworkUrl: "https://pump.fun/metadata/addr1.json" }),
    ]);

    expect(tokens[0].artworkUrl).toBe("https://ipfs.io/ipfs/bafybeidoggo/art.png");
  });

  it("resolves multiple tokens' artwork in parallel", async () => {
    // A fresh Response per call: Response.json() can only be read once, and
    // mockResolvedValue would otherwise hand back the same consumed body.
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ image: "https://example.com/art.png" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await resolveGraduatingTokensArtwork([
      graduatingToken({ address: "A", artworkUrl: "https://pump.fun/metadata/a.json" }),
      graduatingToken({ address: "B", artworkUrl: "https://pump.fun/metadata/b.json" }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tokens.map((t) => t.artworkUrl)).toEqual([
      "https://example.com/art.png",
      "https://example.com/art.png",
    ]);
  });

  it("falls back to an empty artworkUrl when the metadata fetch fails, times out, or has no image field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    let tokens = await resolveGraduatingTokensArtwork([
      graduatingToken({ artworkUrl: "https://pump.fun/metadata/addr1.json" }),
    ]);
    expect(tokens[0].artworkUrl).toBe("");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    tokens = await resolveGraduatingTokensArtwork([
      graduatingToken({ artworkUrl: "https://pump.fun/metadata/addr1.json" }),
    ]);
    expect(tokens[0].artworkUrl).toBe("");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }),
      ),
    );
    tokens = await resolveGraduatingTokensArtwork([
      graduatingToken({ artworkUrl: "https://pump.fun/metadata/addr1.json" }),
    ]);
    expect(tokens[0].artworkUrl).toBe("");

    // Same shape as what a real fetch does once the 3s AbortController fires.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })),
    );
    tokens = await resolveGraduatingTokensArtwork([
      graduatingToken({ artworkUrl: "https://pump.fun/metadata/addr1.json" }),
    ]);
    expect(tokens[0].artworkUrl).toBe("");
  });

  it("leaves an already-empty artworkUrl empty without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await resolveGraduatingTokensArtwork([graduatingToken({ artworkUrl: "" })]);

    expect(tokens[0].artworkUrl).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
