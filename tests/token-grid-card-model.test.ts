import { describe, expect, it } from "vitest";
import {
  GRADUATING_PANEL_COUNT,
  GRID_COLUMNS,
  GRID_PAGE_SIZE,
  buildGridChangePill,
  computeGridMarketCapNative,
  formatGridAge,
  formatGridMarketCap,
  formatGridMarketCapUsd,
} from "@/lib/token-grid-card-model";

describe("homepage layout constants (owner direction, 4 Sep 2026, round 2: six across)", () => {
  it("shows two rows of six domestic cards and one row of six graduating tokens", () => {
    expect(GRID_COLUMNS).toBe(6);
    expect(GRID_PAGE_SIZE).toBe(12);
    expect(GRADUATING_PANEL_COUNT).toBe(6);
  });
});

describe("computeGridMarketCapNative", () => {
  it("is the newest spot price times the recorded whole-token supply", () => {
    expect(computeGridMarketCapNative(0.0000000000032, "1000000000")).toBeCloseTo(0.0032, 10);
  });

  it("is null before any trade exists, and for a zero/invalid price or supply — never a fabricated zero", () => {
    expect(computeGridMarketCapNative(null, "1000000000")).toBeNull();
    expect(computeGridMarketCapNative(0, "1000000000")).toBeNull();
    expect(computeGridMarketCapNative(Number.NaN, "1000000000")).toBeNull();
    expect(computeGridMarketCapNative(0.001, "not-a-number")).toBeNull();
    expect(computeGridMarketCapNative(0.001, "0")).toBeNull();
  });
});

describe("formatGridMarketCap", () => {
  it("renders a native figure with the ETH unit, trimmed to six significant figures", () => {
    expect(formatGridMarketCap(0.0032)).toBe("0.0032 ETH");
    expect(formatGridMarketCap(4.2)).toBe("4.2 ETH");
  });

  it("renders an em dash for null", () => {
    expect(formatGridMarketCap(null)).toBe("—");
  });
});

describe("formatGridMarketCapUsd", () => {
  it("compacts a third-party USD market cap and dashes zero", () => {
    expect(formatGridMarketCapUsd(117_900)).toBe("$117.9K");
    expect(formatGridMarketCapUsd(75_300_000)).toBe("$75.3M");
    expect(formatGridMarketCapUsd(0)).toBe("—");
  });
});

describe("buildGridChangePill", () => {
  it("is lime for up, the design's grey for down, and neutral when the rounded change is exactly zero", () => {
    expect(buildGridChangePill(12.34)).toEqual({ label: "+12.3%", direction: "up" });
    expect(buildGridChangePill(-4.2)).toEqual({ label: "-4.2%", direction: "down" });
    expect(buildGridChangePill(0)).toEqual({ label: "+0.0%", direction: "flat" });
    expect(buildGridChangePill(0.04)).toEqual({ label: "+0.0%", direction: "flat" });
  });

  it("rounds third-party 24h changes to whole percents when asked", () => {
    expect(buildGridChangePill(152.4, 0)).toEqual({ label: "+152%", direction: "up" });
    expect(buildGridChangePill(-97.2, 0)).toEqual({ label: "-97%", direction: "down" });
  });

  it("renders no pill at all while there is nothing to compare", () => {
    expect(buildGridChangePill(null)).toBeNull();
    expect(buildGridChangePill(Number.NaN)).toBeNull();
  });
});

describe("formatGridAge", () => {
  it("lower-cases the header band's launch age and dashes invalid input", () => {
    expect(formatGridAge(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe("3h ago");
    expect(formatGridAge(new Date().toISOString())).toBe("just now");
    expect(formatGridAge(null)).toBe("—");
    expect(formatGridAge("nonsense")).toBe("—");
  });
});
