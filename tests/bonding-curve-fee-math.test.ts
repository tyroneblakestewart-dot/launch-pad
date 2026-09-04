import { describe, expect, it } from "vitest";
import {
  GRADUATION_FEE_BPS,
  buyNetFromGross,
  graduationFee,
  graduationPoolLiquidity,
  grossNativeInForExactNet,
  tradingFee,
} from "../lib/bonding-curve-fee-math";

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

describe("graduationFee (mirrors the contract's GRADUATION_FEE_BPS, owner decision 4 Sep 2026)", () => {
  it("is exactly 5% — 500 of 10,000 bps", () => {
    expect(GRADUATION_FEE_BPS).toBe(500n);
  });

  it("charges 0.2 ETH on the 4 ETH target and 0.0495 ETH on the 0.99 ETH test target", () => {
    expect(graduationFee(4_000_000_000_000_000_000n)).toBe(200_000_000_000_000_000n);
    expect(graduationFee(990_000_000_000_000_000n)).toBe(49_500_000_000_000_000n);
  });

  it("rounds DOWN, unlike the trading fee, so rounding favours pool liquidity", () => {
    expect(graduationFee(19n)).toBe(0n);
    expect(graduationFee(20n)).toBe(1n);
    expect(graduationFee(39n)).toBe(1n);
    expect(tradingFee(19n)).toBe(1n);
  });

  it("is zero for zero, negative or fee-less (pre-fee curve) inputs", () => {
    expect(graduationFee(0n)).toBe(0n);
    expect(graduationFee(-5n)).toBe(0n);
    expect(graduationFee(4_000_000_000_000_000_000n, 0n)).toBe(0n);
  });
});

describe("graduationPoolLiquidity", () => {
  it("is the target minus the graduation fee — 3.8 ETH of a 4 ETH target reaches the pool", () => {
    expect(graduationPoolLiquidity(4_000_000_000_000_000_000n)).toBe(3_800_000_000_000_000_000n);
  });

  it("is the whole target for a pre-fee curve reporting 0 bps", () => {
    expect(graduationPoolLiquidity(4_000_000_000_000_000_000n, 0n)).toBe(4_000_000_000_000_000_000n);
  });

  it("is zero for a zero target", () => {
    expect(graduationPoolLiquidity(0n)).toBe(0n);
  });
});
