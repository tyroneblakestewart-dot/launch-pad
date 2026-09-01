import { describe, expect, it } from "vitest";
import {
  addHorizontalLine,
  computeChartMinMove,
  computeChartPriceDecimals,
  expandDegeneratePriceRange,
  removeHorizontalLine,
} from "@/lib/token-chart-tools";
import { formatNativePriceAtDecimals } from "@/lib/token-page-format";

describe("addHorizontalLine", () => {
  it("appends a new line without mutating the input array", () => {
    const lines = [{ id: "a", price: 1 }];
    const next = addHorizontalLine(lines, 2, "b");
    expect(lines).toHaveLength(1);
    expect(next).toEqual([
      { id: "a", price: 1 },
      { id: "b", price: 2 },
    ]);
  });
});

describe("removeHorizontalLine", () => {
  it("removes only the line with the matching id", () => {
    const lines = [
      { id: "a", price: 1 },
      { id: "b", price: 2 },
    ];
    expect(removeHorizontalLine(lines, "a")).toEqual([{ id: "b", price: 2 }]);
  });

  it("is a no-op when the id isn't present", () => {
    const lines = [{ id: "a", price: 1 }];
    expect(removeHorizontalLine(lines, "missing")).toEqual(lines);
  });
});

describe("expandDegeneratePriceRange (issue #447 item 4: single-candle tick suppression)", () => {
  it("pads a flat non-zero price range so the axis has room for more than the last-price tag", () => {
    const range = expandDegeneratePriceRange(0.0001, 0.0001);
    expect(range.minValue).toBeLessThan(0.0001);
    expect(range.maxValue).toBeGreaterThan(0.0001);
  });

  it("pads a flat zero price range with a small absolute epsilon instead of a percentage of zero", () => {
    const range = expandDegeneratePriceRange(0, 0);
    expect(range.minValue).toBeLessThan(0);
    expect(range.maxValue).toBeGreaterThan(0);
  });

  it("returns a genuine (non-flat) range untouched, once there are two or more distinct prices", () => {
    expect(expandDegeneratePriceRange(1, 2)).toEqual({ minValue: 1, maxValue: 2 });
  });
});

describe("computeChartMinMove (issue #451 item 1: no axis tick labels below minMove)", () => {
  it("computes a minMove at or below 1e-15 for prices around 3e-9", () => {
    expect(computeChartMinMove(3e-9)).toBeLessThanOrEqual(1e-15);
  });

  it("computes exactly 1e-7 for prices around 0.5", () => {
    expect(computeChartMinMove(0.5)).toBeCloseTo(1e-7, 15);
  });

  it("computes exactly six significant figures below the largest price for a round value", () => {
    expect(computeChartMinMove(1)).toBeCloseTo(1e-6, 12);
  });

  it("floors at 1e-18 instead of returning zero/subnormal for a vanishingly small price", () => {
    expect(computeChartMinMove(1e-30)).toBe(1e-18);
  });

  it("floors at 1e-18 for a non-finite or non-positive price instead of throwing", () => {
    expect(computeChartMinMove(0)).toBe(1e-18);
    expect(computeChartMinMove(-1)).toBe(1e-18);
    expect(computeChartMinMove(NaN)).toBe(1e-18);
  });
});

describe("computeChartPriceDecimals (issue #464 item 2: axis/crosshair/tooltip precision clamp)", () => {
  it("derives the decimal count as -log10(minMove) for a round power-of-ten minMove", () => {
    expect(computeChartPriceDecimals(1e-6)).toBe(6);
    expect(computeChartPriceDecimals(1e-14)).toBe(14);
  });

  it("re-derives a different decimal count when the chart's price magnitude changes", () => {
    const highMagnitudeDecimals = computeChartPriceDecimals(computeChartMinMove(1));
    const lowMagnitudeDecimals = computeChartPriceDecimals(computeChartMinMove(6e-8));
    expect(highMagnitudeDecimals).toBe(6);
    expect(lowMagnitudeDecimals).toBe(14);
    expect(lowMagnitudeDecimals).not.toBe(highMagnitudeDecimals);
  });

  it("falls back to 6 decimals for a non-finite or non-positive minMove instead of throwing", () => {
    expect(computeChartPriceDecimals(0)).toBe(6);
    expect(computeChartPriceDecimals(-1)).toBe(6);
    expect(computeChartPriceDecimals(NaN)).toBe(6);
  });

  it("formats a value far below one minMove as all zeros at the clamped precision, instead of two dozen digits (maxPrice 6e-8, value 3.3e-26)", () => {
    const decimals = computeChartPriceDecimals(computeChartMinMove(6e-8));
    expect(formatNativePriceAtDecimals(3.3e-26, decimals)).toBe("0.00000000000000");
  });

  it("formats real tick values at that magnitude without trailing floating-point garbage", () => {
    const decimals = computeChartPriceDecimals(computeChartMinMove(6e-8));
    expect(formatNativePriceAtDecimals(2.5e-9, decimals)).toBe("0.00000000250000");
    expect(formatNativePriceAtDecimals(6e-8, decimals)).toBe("0.00000006000000");
  });
});
