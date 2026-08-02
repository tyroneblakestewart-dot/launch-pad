import { describe, expect, it } from "vitest";
import { applySlippageFloor } from "@/lib/bonding-curve-slippage";

describe("applySlippageFloor", () => {
  it("returns zero for a zero or negative quoted output", () => {
    expect(applySlippageFloor(0n, 100)).toBe(0n);
  });

  it("applies 1% slippage (100 bps) as a floor 1% below the quote", () => {
    expect(applySlippageFloor(1_000_000n, 100)).toBe(990_000n);
  });

  it("applies 0.5% slippage (50 bps)", () => {
    expect(applySlippageFloor(1_000_000n, 50)).toBe(995_000n);
  });

  it("returns the exact quote for zero slippage tolerance", () => {
    expect(applySlippageFloor(1_000_000n, 0)).toBe(1_000_000n);
  });

  it("returns zero for 100% slippage tolerance (10000 bps)", () => {
    expect(applySlippageFloor(1_000_000n, 10_000)).toBe(0n);
  });

  it("rejects an out-of-range or non-integer slippage value", () => {
    expect(() => applySlippageFloor(1_000n, -1)).toThrow("slippageBps must be an integer between 0 and 10000");
    expect(() => applySlippageFloor(1_000n, 10_001)).toThrow("slippageBps must be an integer between 0 and 10000");
    expect(() => applySlippageFloor(1_000n, 1.5)).toThrow("slippageBps must be an integer between 0 and 10000");
  });
});
