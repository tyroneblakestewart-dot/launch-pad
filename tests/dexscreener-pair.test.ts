import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/dexscreener-pair/route";
import {
  buildDexscreenerPairResult,
  isValidDexAddress,
  selectBestPair,
  type DexPair,
} from "@/lib/server/dexscreener";

const ADDRESS = "0x3bf7447cd055f1475a8b09090c7b062abc9d3798";

function makeRequest(address?: string): NextRequest {
  const url = new URL("http://localhost/api/dexscreener-pair");
  if (address !== undefined) url.searchParams.set("address", address);
  return new NextRequest(url);
}

async function responseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Dexscreener server functions", () => {
  it("accepts supported EVM and long alphanumeric addresses", () => {
    expect(isValidDexAddress(ADDRESS)).toBe(true);
    expect(isValidDexAddress("A".repeat(24))).toBe(true);
    expect(isValidDexAddress("A".repeat(80))).toBe(true);
  });

  it("rejects missing, short, long and special-character addresses", () => {
    expect(isValidDexAddress("")).toBe(false);
    expect(isValidDexAddress("A".repeat(23))).toBe(false);
    expect(isValidDexAddress("A".repeat(81))).toBe(false);
    expect(isValidDexAddress(`${"A".repeat(24)}-`)).toBe(false);
  });

  it("selects the valid pair with the highest liquidity", () => {
    const pairs: DexPair[] = [
      {
        chainId: "robinhood",
        pairAddress: "pair-low",
        liquidity: { usd: 100 },
        volume: { h24: 1000 },
      },
      { pairAddress: "missing-chain", liquidity: { usd: 1_000_000 } },
      {
        chainId: "robinhood",
        pairAddress: "pair-high",
        liquidity: { usd: 500 },
        volume: { h24: 10 },
      },
    ];

    expect(selectBestPair(pairs)?.pairAddress).toBe("pair-high");
    expect(pairs[0].pairAddress).toBe("pair-low");
  });

  it("uses 24-hour volume as the tie-breaker", () => {
    const pair = selectBestPair([
      {
        chainId: "chain",
        pairAddress: "lower-volume",
        liquidity: { usd: 500 },
        volume: { h24: 9 },
      },
      {
        chainId: "chain",
        pairAddress: "higher-volume",
        liquidity: { usd: 500 },
        volume: { h24: 10 },
      },
    ]);
    expect(pair?.pairAddress).toBe("higher-volume");
  });

  it("returns null when no complete pair exists", () => {
    expect(selectBestPair([])).toBeNull();
    expect(selectBestPair([{ chainId: "chain" }, { pairAddress: "pair" }])).toBeNull();
  });

  it("builds fallback and provider-supplied pair URLs", () => {
    expect(buildDexscreenerPairResult(null)).toEqual({ found: false });

    expect(
      buildDexscreenerPairResult({
        chainId: "rh",
        pairAddress: "pair-address",
        dexId: "noxa",
        liquidity: { usd: 123.45 },
      }),
    ).toEqual({
      found: true,
      pairUrl: "https://dexscreener.com/rh/pair-address",
      embedUrl:
        "https://dexscreener.com/rh/pair-address?embed=1&theme=dark&trades=0&info=0",
      chainId: "rh",
      dexId: "noxa",
      liquidityUsd: 123.45,
    });

    expect(
      buildDexscreenerPairResult({
        chainId: "rh",
        pairAddress: "pair-address",
        url: "https://dexscreener.com/custom/pair",
      }),
    ).toMatchObject({
      found: true,
      pairUrl: "https://dexscreener.com/custom/pair",
      dexId: "DEX",
      liquidityUsd: 0,
    });
  });
});

describe("GET /api/dexscreener-pair", () => {
  it("rejects missing and invalid addresses without calling Dexscreener", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const value of [undefined, "short", `${"A".repeat(24)}-`]) {
      const response = await GET(makeRequest(value));
      expect(response.status).toBe(400);
      expect(await responseJson(response)).toEqual({
        error: "Enter a valid contract or mint address.",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the most liquid pair and embed URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          pairs: [
            {
              chainId: "rh",
              dexId: "dex-a",
              pairAddress: "pair-a",
              url: "https://dexscreener.com/rh/pair-a",
              liquidity: { usd: 100 },
              volume: { h24: 1000 },
            },
            {
              chainId: "rh",
              dexId: "dex-b",
              pairAddress: "pair-b",
              url: "https://dexscreener.com/rh/pair-b",
              liquidity: { usd: 200 },
              volume: { h24: 10 },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(makeRequest(`  ${ADDRESS}  `));
    const body = await responseJson<{
      found: boolean;
      pairUrl: string;
      embedUrl: string;
      liquidityUsd: number;
    }>(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({
      found: true,
      pairUrl: "https://dexscreener.com/rh/pair-b",
      liquidityUsd: 200,
    });
    expect(body.embedUrl).toContain("embed=1");
    expect(String(fetchMock.mock.calls[0][0])).toContain(encodeURIComponent(ADDRESS));
  });

  it("returns found false for empty, null or unusable pair results", async () => {
    for (const payload of [
      {},
      { pairs: null },
      { pairs: [] },
      { pairs: [{ pairAddress: "missing-chain" }, { chainId: "missing-pair" }] },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
      const response = await GET(makeRequest(ADDRESS));
      expect(response.status).toBe(200);
      expect(await responseJson(response)).toEqual({ found: false });
      vi.unstubAllGlobals();
    }
  });

  it("returns 502 when Dexscreener returns a non-success status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));

    const response = await GET(makeRequest(ADDRESS));
    expect(response.status).toBe(502);
    expect(await responseJson(response)).toEqual({
      error: "Dexscreener could not be reached right now.",
    });
  });

  it("returns the timeout error for AbortError failures", async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));

    const response = await GET(makeRequest(ADDRESS));
    expect(response.status).toBe(502);
    expect(await responseJson(response)).toEqual({
      error: "Dexscreener lookup timed out.",
    });
  });

  it("returns a generic lookup error for other network and JSON failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const networkFailure = await GET(makeRequest(ADDRESS));
    expect(networkFailure.status).toBe(502);
    expect(await responseJson(networkFailure)).toEqual({
      error: "Dexscreener pair lookup failed.",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    const jsonFailure = await GET(makeRequest(ADDRESS));
    expect(jsonFailure.status).toBe(502);
    expect(await responseJson(jsonFailure)).toEqual({
      error: "Dexscreener pair lookup failed.",
    });
  });
});
