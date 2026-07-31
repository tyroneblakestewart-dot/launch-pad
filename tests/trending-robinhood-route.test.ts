import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/trending-robinhood/route";
import { resetRobinhoodTrendingCacheForTests } from "@/lib/server/robinhood-trending";

beforeEach(() => {
  resetRobinhoodTrendingCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRobinhoodTrendingCacheForTests();
});

describe("GET /api/trending-robinhood", () => {
  it("responds with a no-store error payload when the Dexscreener boosts request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
    expect(response.headers.get("CDN-Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ tokens: [], error: true });
  });

  it("responds with mapped tokens on success", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("token-boosts/top/v1")) {
        return new Response(
          JSON.stringify([{ chainId: "robinhood", tokenAddress: "0xabc" }]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([{ baseToken: { name: "kl", symbol: "KL" } }]), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
    const body = await response.json();
    expect(body.error).toBe(false);
    expect(body.tokens).toHaveLength(1);
  });
});
