import { describe, expect, it } from "vitest";
import {
  buildCandleGeometry,
  CANDLE_CHART_HEIGHT,
  CANDLE_CHART_WIDTH,
} from "@/lib/token-candle-geometry";
import { SPARKLINE_DOWN_COLOR, SPARKLINE_UP_COLOR } from "@/lib/token-sparkline";
import type { TokenTrade } from "@/lib/token-trade-types";

// Reuses tokenAmountRaw/nativeAmountRaw as the post-trade virtual reserves
// too (issue #458): buildCandleGeometry buckets via the shared
// bucketTradesIntoCandles, which now prices off tradeSpotPriceNativePerToken
// (virtualEthReserveRaw ÷ virtualTokenReserveRaw) — this keeps every
// existing nativeAmountRaw ÷ tokenAmountRaw price assumption below valid.
function trade(overrides: Partial<TokenTrade> = {}): TokenTrade {
  const tokenAmountRaw = overrides.tokenAmountRaw ?? "1000000000000000000";
  const nativeAmountRaw = overrides.nativeAmountRaw ?? "10000000000000000";
  return {
    direction: "buy",
    wallet: "0x1111111111111111111111111111111111111111",
    tokenAmountRaw,
    nativeAmountRaw,
    blockNumber: "1",
    blockTimestamp: 0,
    txHash: "0xaaaa000000000000000000000000000000000000000000000000000000aa",
    logIndex: 0,
    virtualTokenReserveRaw: tokenAmountRaw,
    virtualEthReserveRaw: nativeAmountRaw,
    ...overrides,
  };
}

function expectFiniteBar(bar: { x: number; bodyWidth: number; wickX: number; wickTop: number; wickBottom: number; bodyTop: number; bodyHeight: number }) {
  for (const value of [bar.x, bar.bodyWidth, bar.wickX, bar.wickTop, bar.wickBottom, bar.bodyTop, bar.bodyHeight]) {
    expect(Number.isFinite(value)).toBe(true);
  }
}

describe("buildCandleGeometry", () => {
  it("returns no bars and hasData: false for zero trades, so the caller renders nothing over the art", () => {
    const result = buildCandleGeometry([]);
    expect(result.hasData).toBe(false);
    expect(result.bars).toHaveLength(0);
    expect(result.lastPrice).toBeNull();
  });

  it("renders a single flat (doji) candle for one trade, rather than treating it as no data", () => {
    const result = buildCandleGeometry([trade({ blockTimestamp: 100 })]);
    expect(result.hasData).toBe(true);
    expect(result.bars).toHaveLength(1);
    expect(result.lastPrice).toBeGreaterThan(0);
    expectFiniteBar(result.bars[0]);
    expect(result.bars[0].bodyHeight).toBeGreaterThan(0);
  });

  it("buckets many trades into multiple candle bars, all with finite in-range geometry", () => {
    const trades: TokenTrade[] = [];
    for (let i = 0; i < 40; i += 1) {
      trades.push(
        trade({
          blockTimestamp: i * 300,
          logIndex: i,
          nativeAmountRaw: String(BigInt(10_000_000_000_000_000n + BigInt(i) * 1_000_000_000_000_000n)),
        }),
      );
    }
    const result = buildCandleGeometry(trades);
    expect(result.hasData).toBe(true);
    expect(result.bars.length).toBeGreaterThan(1);
    expect(result.bars.length).toBeLessThanOrEqual(20);
    for (const bar of result.bars) {
      expectFiniteBar(bar);
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.wickTop).toBeGreaterThanOrEqual(0);
      expect(bar.wickBottom).toBeLessThanOrEqual(CANDLE_CHART_HEIGHT);
    }
    // Latest trade (highest native amount) sets the last candle's close.
    expect(result.lastPrice).toBeGreaterThan(0);
  });

  it("degrades to a flat midline of minimum-height candles when every price is equal, without dividing by zero", () => {
    const result = buildCandleGeometry([
      trade({ blockTimestamp: 0, nativeAmountRaw: "10000000000000000", logIndex: 0 }),
      trade({ blockTimestamp: 60, nativeAmountRaw: "10000000000000000", logIndex: 1 }),
      trade({ blockTimestamp: 120, nativeAmountRaw: "10000000000000000", logIndex: 2 }),
    ]);
    expect(result.hasData).toBe(true);
    for (const bar of result.bars) {
      expectFiniteBar(bar);
      expect(bar.wickTop).toBeCloseTo(CANDLE_CHART_HEIGHT / 2);
      expect(bar.wickBottom).toBeCloseTo(CANDLE_CHART_HEIGHT / 2);
    }
  });

  it("keeps geometry finite and in range for an extreme high/low ratio", () => {
    const result = buildCandleGeometry([
      trade({ blockTimestamp: 0, nativeAmountRaw: "1000000000000", logIndex: 0 }),
      trade({ blockTimestamp: 60, nativeAmountRaw: "10000000000000000000000", logIndex: 1 }),
      trade({ blockTimestamp: 120, nativeAmountRaw: "5000000000000000000", logIndex: 2 }),
    ]);
    expect(result.hasData).toBe(true);
    for (const bar of result.bars) {
      expectFiniteBar(bar);
      expect(bar.wickTop).toBeGreaterThanOrEqual(-0.001);
      expect(bar.wickBottom).toBeLessThanOrEqual(CANDLE_CHART_HEIGHT + 0.001);
    }
  });

  it("colours a bar green when its candle closed at or above its open, red otherwise", () => {
    // Both trades share the exact same blockTimestamp, so they land in the
    // same bucket regardless of which interval pickInterval selects (issue
    // #470 item 1 added 1S/15S/1M ahead of 5M, so a zero-span pair now
    // resolves to the finest interval, "1s", rather than always "5m") —
    // the candle's open/close differ within that one bar, rather than
    // producing two single-trade (open === close) doji candles.
    const up = buildCandleGeometry([
      trade({ blockTimestamp: 0, nativeAmountRaw: "10000000000000000", logIndex: 0 }),
      trade({ blockTimestamp: 0, nativeAmountRaw: "20000000000000000", logIndex: 1 }),
    ]);
    const down = buildCandleGeometry([
      trade({ blockTimestamp: 0, nativeAmountRaw: "20000000000000000", logIndex: 0 }),
      trade({ blockTimestamp: 0, nativeAmountRaw: "10000000000000000", logIndex: 1 }),
    ]);
    expect(up.bars.some((bar) => bar.color === SPARKLINE_UP_COLOR)).toBe(true);
    expect(down.bars.some((bar) => bar.color === SPARKLINE_DOWN_COLOR)).toBe(true);
  });

  it("picks a sub-minute interval for a short burst of trades instead of always collapsing them into one 5M candle (issue #470 item 1: the sparkline/mini-chart's finest-interval-under-cap rule now reaches 1S/15S/1M too)", () => {
    const trades: TokenTrade[] = [];
    for (let i = 0; i < 10; i += 1) {
      trades.push(
        trade({
          blockTimestamp: i * 2,
          logIndex: i,
          nativeAmountRaw: String(BigInt(10_000_000_000_000_000n + BigInt(i) * 1_000_000_000_000_000n)),
        }),
      );
    }
    const result = buildCandleGeometry(trades);
    expect(result.hasData).toBe(true);
    // 10 trades 2s apart (18s span) now resolve to 1S buckets — one candle
    // per trade — rather than the pre-#470 single 5M candle.
    expect(result.bars.length).toBeGreaterThan(1);
    expect(result.bars.length).toBeLessThanOrEqual(20);
    for (const bar of result.bars) {
      expectFiniteBar(bar);
    }
  });

  it("scales geometry to a custom width/height when provided", () => {
    const result = buildCandleGeometry(
      [
        trade({ blockTimestamp: 0, nativeAmountRaw: "10000000000000000", logIndex: 0 }),
        trade({ blockTimestamp: 60, nativeAmountRaw: "20000000000000000", logIndex: 1 }),
      ],
      { width: 50, height: 10 },
    );
    for (const bar of result.bars) {
      expect(bar.x).toBeLessThanOrEqual(50);
      expect(bar.wickTop).toBeLessThanOrEqual(10);
      expect(bar.wickBottom).toBeLessThanOrEqual(10);
    }
  });

  it("exposes the shared default chart viewBox dimensions", () => {
    expect(CANDLE_CHART_WIDTH).toBeGreaterThan(0);
    expect(CANDLE_CHART_HEIGHT).toBeGreaterThan(0);
  });
});
