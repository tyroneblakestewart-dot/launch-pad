import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/trending-robinhood/route";
import { resetSolanaTrendingCacheForTests } from "@/lib/server/robinhood-trending";

const ORIGINAL_API_KEY = process.env.GMGN_API_KEY;

function makeRequest(feed?: string): NextRequest {
  const url = new URL("http://localhost/api/trending-robinhood");
  if (feed !== undefined) url.searchParams.set("feed", feed);
  return new NextRequest(url);
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetSolanaTrendingCacheForTests();
  if (ORIGINAL_API_KEY === undefined) delete process.env.GMGN_API_KEY;
  else process.env.GMGN_API_KEY = ORIGINAL_API_KEY;
});

describe("GET /api/trending-robinhood", () => {
  it("defaults to the GMGN Robinhood feed and responds with an error payload when GMGN_API_KEY is unset", async () => {
    delete process.env.GMGN_API_KEY;

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
    expect(await response.json()).toEqual({ tokens: [], error: true });
  });

  it("responds with mapped GMGN tokens on success", async () => {
    process.env.GMGN_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { rank: [{ address: "0xabc", symbol: "KL" }] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.error).toBe(false);
    expect(body.tokens).toHaveLength(1);
  });

  it("serves the Solana feed via Dexscreener when feed=solana", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("token-boosts/top/v1")) {
          return new Response(
            JSON.stringify([{ chainId: "solana", tokenAddress: "SoL111" }]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            pairs: [
              { chainId: "solana", pairAddress: "p1", baseToken: { symbol: "SOL1", address: "SoL111" } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const response = await GET(makeRequest("solana"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.error).toBe(false);
    expect(body.tokens).toEqual([
      expect.objectContaining({ ticker: "SOL1", address: "SoL111" }),
    ]);
  });
});
