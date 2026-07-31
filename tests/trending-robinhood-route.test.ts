import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/trending-robinhood/route";

const ORIGINAL_API_KEY = process.env.GMGN_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_API_KEY === undefined) delete process.env.GMGN_API_KEY;
  else process.env.GMGN_API_KEY = ORIGINAL_API_KEY;
});

describe("GET /api/trending-robinhood", () => {
  it("responds with an error payload and no-store when GMGN_API_KEY is unset", async () => {
    delete process.env.GMGN_API_KEY;

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ tokens: [], error: true });
  });

  it("responds with mapped tokens and a cacheable header on success", async () => {
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

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    const body = await response.json();
    expect(body.error).toBe(false);
    expect(body.tokens).toHaveLength(1);
  });
});
