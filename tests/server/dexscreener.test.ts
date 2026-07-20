import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/dexscreener-pair/route";
import {
  buildDexPairResult,
  isValidDexscreenerAddress,
  selectBestDexPair,
} from "@/lib/server/dexscreener";

const VALID_ADDRESS = `0x${"a".repeat(40)}`;

function request(address?: string) {
  const url = new URL("http://localhost/api/dexscreener-pair");
  if (address !== undefined) url.searchParams.set("address", address);
  return new NextRequest(url);
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Dexscreener helpers", () => {
  it("validates the documented alphanumeric address bounds", () => {
    expect(isValidDexscreenerAddress("A".repeat(24))).toBe(true);
    expect(isValidDexscreenerAddress("A".repeat(80))).toBe(true);
    expect(isValidDexscreenerAddress("A".repeat(23))).toBe(false);
    expect(isValidDexscreenerAddress("A".repeat(81))).toBe(false);
    expect(isValidDexscreenerAddress("0xabc-def")).toBe(false);
    expect(isValidDexscreenerAddress(VALID_ADDRESS)).toBe(true);
  });

  it("returns null for absent or malformed pair collections", () => {
    expect(selectBestDexPair(null)).toBeNull();
    expect(selectBestDexPair({ pairs: [] })).toBeNull();
    expect(selectBestDexPair([null, {}, { chainId: "ethereum" }])).toBeNull();
  });

  it("chooses highest liquidity and uses 24-hour volume as the tie-breaker", () => {
    const best = selectBestDexPair([
      {
        chainId: "robinhood",
        pairAddress: "low",
        liquidity: { usd: 50 },
        volume: { h24: 5000 },
      },
      {
        chainId: "robinhood",
        pairAddress: "tie-low-volume",
        liquidity: { usd: 100 },
        volume: { h24: 20 },
      },
      {
        chainId: "robinhood",
        pairAddress: "winner",
        liquidity: { usd: 100 },
        volume: { h24: 30 },
      },
      {
        chainId: "",
        pairAddress: "ignored",
        liquidity: { usd: 999999 },
      },
    ]);
    expect(best?.pairAddress).toBe("winner");
  });

  it("treats missing and non-finite metrics as zero", () => {
    const best = selectBestDexPair([
      {
        chainId: "base",
        pairAddress: "nan",
        liquidity: { usd: Number.NaN },
        volume: { h24: Number.POSITIVE_INFINITY },
      },
      {
        chainId: "base",
        pairAddress: "real",
        liquidity: { usd: 1 },
      },
    ]);
    expect(best?.pairAddress).toBe("real");
  });

  it("builds custom and fallback pair URLs", () => {
    expect(buildDexPairResult(null)).toEqual({ found: false });
    expect(
      buildDexPairResult({
        chainId: "base",
        pairAddress: "pair-one",
        dexId: "uni",
        url: "https://dexscreener.com/base/custom",
        liquidity: { usd: 123.45 },
      }),
    ).toEqual({
      found: true,
      pairUrl: "https://dexscreener.com/base/custom",
      embedUrl: "https://dexscreener.com/base/custom?embed=1&theme=dark&trades=0&info=0",
      chainId: "base",
      dexId: "uni",
      liquidityUsd: 123.45,
    });
    expect(
      buildDexPairResult({ chainId: "base", pairAddress: "pair-two" }),
    ).toEqual({
      found: true,
      pairUrl: "https://dexscreener.com/base/pair-two",
      embedUrl: "https://dexscreener.com/base/pair-two?embed=1&theme=dark&trades=0&info=0",
      chainId: "base",
      dexId: "DEX",
      liquidityUsd: 0,
    });
  });
});

describe("GET /api/dexscreener-pair", () => {
  it("rejects missing and malformed addresses without calling Dexscreener", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const missing = await GET(request());
    expect(missing.status).toBe(400);
    expect(await json(missing)).toEqual({ error: "Enter a valid contract or mint address." });

    const malformed = await GET(request("bad-address"));
    expect(malformed.status).toBe(400);
    expect(await json(malformed)).toEqual({ error: "Enter a valid contract or mint address." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the most liquid valid pair using only mocked upstream data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          pairs: [
            {
              chainId: "robinhood",
              dexId: "small-dex",
              pairAddress: "pair-small",
              liquidity: { usd: 10 },
              volume: { h24: 100 },
            },
            {
              chainId: "robinhood",
              dexId: "best-dex",
              pairAddress: "pair-best",
              url: "https://dexscreener.com/robinhood/pair-best",
              liquidity: { usd: 500 },
              volume: { h24: 50 },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request(`  ${VALID_ADDRESS}  `));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      found: true,
      pairUrl: "https://dexscreener.com/robinhood/pair-best",
      embedUrl: "https://dexscreener.com/robinhood/pair-best?embed=1&theme=dark&trades=0&info=0",
      chainId: "robinhood",
      dexId: "best-dex",
      liquidityUsd: 500,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.dexscreener.com/latest/dex/tokens/${VALID_ADDRESS}`);
    expect(init.headers).toEqual({ Accept: "application/json" });
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns found false for empty, missing or malformed pair arrays", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ pairs: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(null), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    for (let index = 0; index < 3; index += 1) {
      const response = await GET(request(VALID_ADDRESS));
      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ found: false });
    }
  });

  it("maps upstream HTTP failures to status 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const response = await GET(request(VALID_ADDRESS));
    expect(response.status).toBe(502);
    expect(await json(response)).toEqual({ error: "Dexscreener could not be reached right now." });
  });

  it("maps malformed upstream JSON to status 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    const response = await GET(request(VALID_ADDRESS));
    expect(response.status).toBe(502);
    expect(await json(response)).toEqual({ error: "Dexscreener returned an invalid response." });
  });

  it("distinguishes timeout and generic network failures", async () => {
    const timeoutError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeoutError)
      .mockRejectedValueOnce(new Error("socket closed"));
    vi.stubGlobal("fetch", fetchMock);

    const timedOut = await GET(request(VALID_ADDRESS));
    expect(timedOut.status).toBe(502);
    expect(await json(timedOut)).toEqual({ error: "Dexscreener lookup timed out." });

    const failed = await GET(request(VALID_ADDRESS));
    expect(failed.status).toBe(502);
    expect(await json(failed)).toEqual({ error: "Dexscreener pair lookup failed." });
  });
});
