import { describe, expect, it } from "vitest";
import { buyNetFromGross, grossNativeInForExactNet, tradingFee } from "../lib/bonding-curve-fee-math";

describe("tradingFee", () => {
  it("is zero for zero input", () => {
    expect(tradingFee(0n)).toBe(0n);
  });

  it("rounds up so any nonzero amount pays a strictly positive fee", () => {
    expect(tradingFee(1n)).toBe(1n);
    expect(tradingFee(50n)).toBe(1n);
    expect(tradingFee(99n)).toBe(1n);
  });

  it("matches the contract's ceil-rounded 1% for round amounts", () => {
    expect(tradingFee(100n)).toBe(1n);
    expect(tradingFee(1_000n)).toBe(10n);
    expect(tradingFee(1_000_000_000_000_000_000n)).toBe(10_000_000_000_000_000n);
  });
});

describe("buyNetFromGross", () => {
  it("subtracts the trading fee from the gross amount", () => {
    expect(buyNetFromGross(0n)).toBe(0n);
    expect(buyNetFromGross(100n)).toBe(99n);
    expect(buyNetFromGross(1_000_000_000_000_000_000n)).toBe(990_000_000_000_000_000n);
  });
});

describe("grossNativeInForExactNet", () => {
  it("returns zero for a zero target", () => {
    expect(grossNativeInForExactNet(0n)).toBe(0n);
  });

  it("rejects a negative target", () => {
    expect(() => grossNativeInForExactNet(-1n)).toThrow("targetNet must be non-negative");
  });

  it("finds a gross input whose net matches the target exactly, across many magnitudes", () => {
    const targets = [
      1n,
      2n,
      50n,
      99n,
      100n,
      101n,
      12_345n,
      1_000_000n,
      1_000_000_000_000_000_000n, // 1 ether
      4_000_000_000_000_000_000n, // the drill's 4-native-token graduation target
      123_456_789_012_345_678n,
    ];
    for (const target of targets) {
      const gross = grossNativeInForExactNet(target);
      expect(buyNetFromGross(gross)).toBe(target);
    }
  });

  it("returns the minimal gross satisfying the target", () => {
    const target = 1_000_000_000_000_000_000n;
    const gross = grossNativeInForExactNet(target);
    expect(buyNetFromGross(gross - 1n)).not.toBe(target);
  });
});
