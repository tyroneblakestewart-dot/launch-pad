import { describe, expect, it } from "vitest";
import { addHorizontalLine, expandDegeneratePriceRange, removeHorizontalLine } from "@/lib/token-chart-tools";

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
