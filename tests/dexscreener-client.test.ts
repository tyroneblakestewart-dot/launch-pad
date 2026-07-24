import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDexscreenerPair, formatDexscreenerLiquidity } from "@/lib/dexscreener-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDexscreenerPair", () => {
  it("returns the pair payload with the address attached on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ found: true, embedUrl: "https://dexscreener.com/embed/pair" }),
      })),
    );

    const result = await fetchDexscreenerPair("0xabc");
    expect(result).toEqual({
      found: true,
      embedUrl: "https://dexscreener.com/embed/pair",
      address: "0xabc",
    });
  });

  it("returns a not-found error result when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "Enter a valid contract or mint address." }),
      })),
    );

    const result = await fetchDexscreenerPair("bad-address");
    expect(result).toEqual({
      address: "bad-address",
      found: false,
      error: "Enter a valid contract or mint address.",
    });
  });

  it("falls back to a generic error message when the failure body has none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );

    const result = await fetchDexscreenerPair("0xabc");
    expect(result.error).toBe("Pair lookup failed.");
  });
});

describe("formatDexscreenerLiquidity", () => {
  it("formats a numeric liquidity value as compact USD", () => {
    const formatted = formatDexscreenerLiquidity(1_250_000);
    expect(formatted.toLowerCase()).toContain("1.3m");
    expect(formatted).toContain("liquidity");
  });

  it("falls back to a generic label for missing or zero liquidity", () => {
    expect(formatDexscreenerLiquidity(undefined)).toBe("Liquidity detected");
    expect(formatDexscreenerLiquidity(0)).toBe("Liquidity detected");
  });
});
