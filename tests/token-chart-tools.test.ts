import { describe, expect, it } from "vitest";
import {
  addHorizontalLine,
  computeChartMinMove,
  MIN_MOVE_FLOOR,
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

  it("floors at MIN_MOVE_FLOOR (1e-15) instead of returning zero/subnormal for a vanishingly small price", () => {
    expect(MIN_MOVE_FLOOR).toBe(1e-15);
    expect(computeChartMinMove(1e-30)).toBe(1e-15);
  });

  it("floors at MIN_MOVE_FLOOR for a non-finite or non-positive price instead of throwing", () => {
    expect(computeChartMinMove(0)).toBe(MIN_MOVE_FLOOR);
    expect(computeChartMinMove(-1)).toBe(MIN_MOVE_FLOOR);
    expect(computeChartMinMove(NaN)).toBe(MIN_MOVE_FLOOR);
  });

  // lightweight-charts@4.1.3 derives `base = Math.round(1 / minMove)` for the
  // price scale's tick-span calculator and requires it to be an exact power
  // of ten (`isBaseDecimal`) or at least factorable into 2s and 5s, else it
  // throws "unexpected base" during axis layout and takes the page down with
  // it. These two helpers replicate that check verbatim from the library's
  // own source so the floor can never regress below what the library accepts.
  function libraryIsBaseDecimal(value: number): boolean {
    if (value < 0) return false;
    for (let current = value; current > 1; current /= 10) {
      if (current % 10 !== 0) return false;
    }
    return true;
  }
  function libraryAcceptsBase(base: number): boolean {
    if (libraryIsBaseDecimal(base)) return true;
    let dividers = 0;
    for (let rest = base; rest !== 1; ) {
      if (rest % 2 === 0) rest /= 2;
      else if (rest % 5 === 0) rest /= 5;
      else return false;
      dividers += 1;
      if (dividers > 100) return false;
    }
    return true;
  }

  it("documents the defect: a 1e-18 minMove yields a base lightweight-charts rejects, 1e-15 does not", () => {
    expect(Math.round(1 / 1e-18)).toBe(999999999999999900);
    expect(libraryAcceptsBase(Math.round(1 / 1e-18))).toBe(false);
    expect(libraryAcceptsBase(Math.round(1 / 1e-15))).toBe(true);
    expect(Number.isSafeInteger(Math.round(1 / MIN_MOVE_FLOOR))).toBe(true);
  });

  it("yields a library-safe base for every price magnitude from 1e-30 to 1e6, including the first pump.fun-shaped curve's starting price", () => {
    const prices = [0.0035 / 1_073_000_000, 3e-12, 2.5e-9, 6e-8, 1.3e-9, 0.5, 1, 1_000_000];
    for (let exponent = -30; exponent <= 6; exponent += 1) prices.push(3.3 * 10 ** exponent);
    for (const price of prices) {
      const base = Math.round(1 / computeChartMinMove(price));
      expect(Number.isSafeInteger(base)).toBe(true);
      expect(libraryAcceptsBase(base)).toBe(true);
    }
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
