import { describe, expect, it } from "vitest";
import {
  buildGridCandleChart,
  GRID_CANDLE_CHART_HEIGHT,
  GRID_CANDLE_CHART_WIDTH,
  GRID_CANDLE_DOWN_COLOR,
  GRID_CANDLE_UP_COLOR,
  MAX_GRID_CANDLES,
} from "@/lib/token-grid-candle-chart";
import type { TokenTrade } from "@/lib/token-trade-types";

// Reuses tokenAmountRaw/nativeAmountRaw as the post-trade virtual reserves
// too (issue #458): buildGridCandleChart buckets via the shared
// bucketTradesIntoCandles, which prices off tradeSpotPriceNativePerToken
// (virtualEthReserveRaw ÷ virtualTokenReserveRaw).
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

/**
 * Owner direction, 7 Sep 2026: "I want candle stick just like [the flagship
 * chart] … thin slim … smaller as it's gonna go in each panel like pump
 * fun … make sure glow … 5m candles" — replacing the single performance
 * line issue #440/#489 drew instead.
 */
describe("buildGridCandleChart", () => {
  it("returns no bars and hasData: false for zero trades, so the caller renders nothing over the art", () => {
    const result = buildGridCandleChart([]);
    expect(result.hasData).toBe(false);
    expect(result.bars).toHaveLength(0);
    expect(result.lastPrice).toBeNull();
    expect(result.changePercent).toBeNull();
  });

  it("renders a single flat (doji) candle for one trade, rather than treating it as no data", () => {
    const result = buildGridCandleChart([trade({ blockTimestamp: 100 })]);
    expect(result.hasData).toBe(true);
    expect(result.bars).toHaveLength(1);
    expect(result.lastPrice).toBeGreaterThan(0);
    expectFiniteBar(result.bars[0]);
    expect(result.bars[0].bodyHeight).toBeGreaterThan(0);
    // A single candle has no first-to-last change of its own kind (open equals close).
    expect(result.changePercent).toBe(0);
  });

  it("always buckets in fixed 5-minute candles (owner instruction), never an auto-picked coarser interval", () => {
    // Two trades 4 minutes apart land in the same 5-minute bucket; one candle, not two.
    const result = buildGridCandleChart([
      trade({ blockTimestamp: 0, logIndex: 0, nativeAmountRaw: "10000000000000000" }),
      trade({ blockTimestamp: 240, logIndex: 1, nativeAmountRaw: "12000000000000000" }),
    ]);
    expect(result.bars).toHaveLength(1);
    // Two trades 5 minutes apart land in different buckets; two candles.
    const spanning = buildGridCandleChart([
      trade({ blockTimestamp: 0, logIndex: 0, nativeAmountRaw: "10000000000000000" }),
      trade({ blockTimestamp: 300, logIndex: 1, nativeAmountRaw: "12000000000000000" }),
    ]);
    expect(spanning.bars).toHaveLength(2);
  });

  it("caps the shown candles at MAX_GRID_CANDLES, keeping only the most recent ones, with finite in-range geometry", () => {
    const trades: TokenTrade[] = [];
    for (let i = 0; i < 60; i += 1) {
      trades.push(
        trade({
          blockTimestamp: i * 300,
          logIndex: i,
          nativeAmountRaw: String(BigInt(10_000_000_000_000_000n + BigInt(i) * 1_000_000_000_000_000n)),
        }),
      );
    }
    const result = buildGridCandleChart(trades);
    expect(result.hasData).toBe(true);
    expect(result.bars).toHaveLength(MAX_GRID_CANDLES);
    for (const bar of result.bars) {
      expectFiniteBar(bar);
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.wickTop).toBeGreaterThanOrEqual(0);
      expect(bar.wickBottom).toBeLessThanOrEqual(GRID_CANDLE_CHART_HEIGHT);
      expect(["up", "down"]).toContain(bar.tone);
    }
    // Rising trades throughout: the kept window is still trending up.
    expect(result.changePercent).toBeGreaterThan(0);
    // Latest trade (highest native amount) sets the last candle's close.
    expect(result.lastPrice).toBeGreaterThan(0);
  });

  it("colours a candle lime when it closes up and the design's grey when it closes down — never red", () => {
    const up = buildGridCandleChart([
      trade({ blockTimestamp: 0, logIndex: 0, nativeAmountRaw: "10000000000000000" }),
      trade({ blockTimestamp: 60, logIndex: 1, nativeAmountRaw: "20000000000000000" }),
      trade({ blockTimestamp: 400, logIndex: 2, nativeAmountRaw: "5000000000000000" }),
    ]);
    // A close below the first candle's open makes the second candle a down close.
    const [first, second] = up.bars;
    expect(first.tone).toBe("up");
    expect(first.color).toBe(GRID_CANDLE_UP_COLOR);
    expect(second.tone).toBe("down");
    expect(second.color).toBe(GRID_CANDLE_DOWN_COLOR);
    expect(GRID_CANDLE_UP_COLOR).toBe("#c6f53e");
    expect(GRID_CANDLE_DOWN_COLOR).toBe("#8d918c");
  });

  it("keeps every candle body thin/slim relative to its slot — most of the slot stays gap, the way pump.fun's own bars read", () => {
    const trades: TokenTrade[] = [];
    for (let i = 0; i < 6; i += 1) {
      trades.push(trade({ blockTimestamp: i * 300, logIndex: i }));
    }
    const result = buildGridCandleChart(trades);
    const slotWidth = GRID_CANDLE_CHART_WIDTH / result.bars.length;
    for (const bar of result.bars) {
      expect(bar.bodyWidth).toBeLessThan(slotWidth * 0.6);
      expect(bar.bodyWidth).toBeGreaterThan(0);
    }
  });

  /**
   * Owner bug report, 7 Sep 2026 (real production cards, not the uniform
   * mocks first checked): "candel stick are different sizes still to big
   * plus covering half images" — a quiet token with only a couple of
   * 5-minute buckets rendered a couple of huge bars because body width was
   * `width / candles.length`, a denominator that varied per token. It must
   * now be a fixed absolute size on every card, however many candles that
   * specific token happens to have.
   */
  it("keeps candle body width identical across cards with wildly different trade counts (the reported bug)", () => {
    const single: TokenTrade[] = [trade({ blockTimestamp: 0 })];
    const few: TokenTrade[] = [];
    for (let i = 0; i < 3; i += 1) few.push(trade({ blockTimestamp: i * 300, logIndex: i }));
    const many: TokenTrade[] = [];
    for (let i = 0; i < 60; i += 1) many.push(trade({ blockTimestamp: i * 300, logIndex: i }));

    const oneCandle = buildGridCandleChart(single);
    const threeCandles = buildGridCandleChart(few);
    const maxCandles = buildGridCandleChart(many);

    expect(oneCandle.bars).toHaveLength(1);
    expect(threeCandles.bars).toHaveLength(3);
    expect(maxCandles.bars).toHaveLength(MAX_GRID_CANDLES);

    const oneWidth = oneCandle.bars[0].bodyWidth;
    for (const bar of threeCandles.bars) expect(bar.bodyWidth).toBeCloseTo(oneWidth, 10);
    for (const bar of maxCandles.bars) expect(bar.bodyWidth).toBeCloseTo(oneWidth, 10);
  });

  it("right-aligns a token with fewer than MAX_GRID_CANDLES buckets, flush to the right edge, instead of stretching to fill the width", () => {
    const trades: TokenTrade[] = [];
    for (let i = 0; i < 4; i += 1) trades.push(trade({ blockTimestamp: i * 300, logIndex: i }));
    const result = buildGridCandleChart(trades);
    expect(result.bars).toHaveLength(4);

    const slotWidth = GRID_CANDLE_CHART_WIDTH / MAX_GRID_CANDLES;
    const lastBar = result.bars[result.bars.length - 1];
    // The newest candle sits in the rightmost slot.
    expect(lastBar.wickX).toBeCloseTo(GRID_CANDLE_CHART_WIDTH - slotWidth / 2, 10);
    // Consecutive candles are exactly one fixed slot apart.
    for (let i = 1; i < result.bars.length; i += 1) {
      expect(result.bars[i].wickX - result.bars[i - 1].wickX).toBeCloseTo(slotWidth, 10);
    }
    // A card with a full MAX_GRID_CANDLES window has no leading gap: its
    // first candle sits in the leftmost slot.
    const fullTrades: TokenTrade[] = [];
    for (let i = 0; i < MAX_GRID_CANDLES; i += 1) fullTrades.push(trade({ blockTimestamp: i * 300, logIndex: i }));
    const full = buildGridCandleChart(fullTrades);
    expect(full.bars[0].wickX).toBeCloseTo(slotWidth / 2, 10);
  });

  it("degrades an all-equal price range to a midline of flat candles rather than dividing by zero", () => {
    const result = buildGridCandleChart([
      trade({ blockTimestamp: 0, logIndex: 0 }),
      trade({ blockTimestamp: 400, logIndex: 1 }),
    ]);
    for (const bar of result.bars) {
      expectFiniteBar(bar);
      expect(bar.bodyHeight).toBeGreaterThan(0);
    }
  });
});
