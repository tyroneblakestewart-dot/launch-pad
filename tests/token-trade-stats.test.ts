import { describe, expect, it } from "vitest";
import { computeTotalFeesNative, computeTradeWindowStats, nowUnixSeconds } from "@/lib/token-trade-stats";
import type { TokenTrade } from "@/lib/token-trade-types";

const NOW = 1_700_000_000;
const DECIMALS = 18;

function buyTrade(overrides: Partial<TokenTrade> = {}): TokenTrade {
  return {
    direction: "buy",
    wallet: "0x1111111111111111111111111111111111111111",
    tokenAmountRaw: "1000000000000000000", // 1 whole token
    nativeAmountRaw: "10000000000000000", // 0.01 ETH net-in
    grossNativeAmountRaw: "10100000000000000",
    feeChargedRaw: "100000000000000",
    blockNumber: "1",
    blockTimestamp: NOW,
    txHash: "0xaaaa000000000000000000000000000000000000000000000000000000aa",
    logIndex: 0,
    ...overrides,
  };
}

function sellTrade(overrides: Partial<TokenTrade> = {}): TokenTrade {
  return {
    direction: "sell",
    wallet: "0x2222222222222222222222222222222222222222",
    tokenAmountRaw: "1000000000000000000",
    nativeAmountRaw: "9900000000000000", // net-out (not used for sell volume)
    grossNativeAmountRaw: "10000000000000000", // gross-out — this is what sell volume sums
    feeChargedRaw: "100000000000000",
    blockNumber: "2",
    blockTimestamp: NOW,
    txHash: "0xbbbb000000000000000000000000000000000000000000000000000000bb",
    logIndex: 1,
    ...overrides,
  };
}

describe("computeTradeWindowStats", () => {
  it("returns all-zero stats for an empty trade list", () => {
    const stats = computeTradeWindowStats([], 3600, DECIMALS, NOW);
    expect(stats).toEqual({
      priceChangePercent: 0,
      volumeNative: 0,
      buys: 0,
      sells: 0,
      buyVolumeNative: 0,
      sellVolumeNative: 0,
      buyers: 0,
      sellers: 0,
    });
  });

  it("reports 0% price change for a single trade — there is no first/last spread yet", () => {
    const stats = computeTradeWindowStats([buyTrade()], 3600, DECIMALS, NOW);
    expect(stats.priceChangePercent).toBe(0);
    expect(stats.buys).toBe(1);
    expect(stats.buyVolumeNative).toBeCloseTo(0.01);
  });

  it("excludes trades outside the trailing window", () => {
    const inWindow = buyTrade({ blockTimestamp: NOW - 100 });
    const outsideWindow = buyTrade({ blockTimestamp: NOW - 10_000, txHash: "0xcccc000000000000000000000000000000000000000000000000000000cc" });
    const stats = computeTradeWindowStats([inWindow, outsideWindow], 3600, DECIMALS, NOW);
    expect(stats.buys).toBe(1);
  });

  it("splits buy vs sell counts, using net-in for buy volume and gross-out for sell volume", () => {
    const stats = computeTradeWindowStats([buyTrade(), sellTrade()], 3600, DECIMALS, NOW);
    expect(stats.buys).toBe(1);
    expect(stats.sells).toBe(1);
    expect(stats.buyVolumeNative).toBeCloseTo(0.01);
    expect(stats.sellVolumeNative).toBeCloseTo(0.01);
    expect(stats.volumeNative).toBeCloseTo(0.02);
  });

  it("counts distinct addresses per side, not raw trade counts", () => {
    const stats = computeTradeWindowStats(
      [
        buyTrade({ txHash: "0x0000000000000000000000000000000000000000000000000000000000a1", logIndex: 0 }),
        buyTrade({ txHash: "0x0000000000000000000000000000000000000000000000000000000000a2", logIndex: 1 }),
      ],
      3600,
      DECIMALS,
      NOW,
    );
    expect(stats.buys).toBe(2);
    expect(stats.buyers).toBe(1);
  });

  it("computes signed price change between the first and last trade in the window", () => {
    const first = buyTrade({ blockTimestamp: NOW - 100, nativeAmountRaw: "10000000000000000", logIndex: 0 });
    const last = buyTrade({
      blockTimestamp: NOW,
      nativeAmountRaw: "20000000000000000",
      logIndex: 1,
      txHash: "0x0000000000000000000000000000000000000000000000000000000000b1",
    });
    const stats = computeTradeWindowStats([last, first], 3600, DECIMALS, NOW);
    expect(stats.priceChangePercent).toBeCloseTo(100);
  });
});

describe("computeTotalFeesNative", () => {
  it("sums feeChargedRaw across every loaded trade, ignoring the window entirely", () => {
    const total = computeTotalFeesNative([buyTrade(), sellTrade()]);
    expect(total).toBeCloseTo(0.0002);
  });

  it("returns 0 for an empty list", () => {
    expect(computeTotalFeesNative([])).toBe(0);
  });

  it("treats a missing feeChargedRaw (older/test fixtures) as zero rather than throwing", () => {
    const trade = buyTrade();
    delete (trade as { feeChargedRaw?: string }).feeChargedRaw;
    expect(computeTotalFeesNative([trade])).toBe(0);
  });
});

describe("nowUnixSeconds", () => {
  it("returns the current time in whole seconds", () => {
    const before = Math.floor(Date.now() / 1000);
    const value = nowUnixSeconds();
    const after = Math.floor(Date.now() / 1000);
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });
});
