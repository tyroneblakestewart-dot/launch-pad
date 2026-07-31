import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRobinhoodTrending,
  formatCompactUsd,
  formatPercentChange,
} from "@/lib/robinhood-trending-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatCompactUsd", () => {
  it("formats large market caps compactly", () => {
    expect(formatCompactUsd(2_100_000)).toBe("$2.1M");
    expect(formatCompactUsd(890_000)).toBe("$890K");
  });

  it("returns $0 for zero or falsy values", () => {
    expect(formatCompactUsd(0)).toBe("$0");
  });
});

describe("formatPercentChange", () => {
  it("prefixes positive changes with a plus sign", () => {
    expect(formatPercentChange(184)).toBe("+184%");
  });

  it("leaves negative changes as-is and rounds", () => {
    expect(formatPercentChange(-12.6)).toBe("-13%");
  });

  it("shows no sign for zero", () => {
    expect(formatPercentChange(0)).toBe("0%");
  });
});

describe("fetchRobinhoodTrending", () => {
  it("returns the parsed token list on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ tokens: [{ rank: 1 }], error: false }), { status: 200 }),
      ),
    );
    expect(await fetchRobinhoodTrending()).toEqual({ tokens: [{ rank: 1 }], error: false });
  });

  it("returns an unavailable result on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 500 })));
    expect(await fetchRobinhoodTrending()).toEqual({ tokens: [], error: true });
  });

  it("returns an unavailable result on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await fetchRobinhoodTrending()).toEqual({ tokens: [], error: true });
  });

  it("rethrows an AbortError so callers can ignore cancelled polls", async () => {
    const error = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(fetchRobinhoodTrending()).rejects.toThrow("aborted");
  });
});
