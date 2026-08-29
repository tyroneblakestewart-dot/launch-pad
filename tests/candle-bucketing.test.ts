import { describe, expect, it } from "vitest";
import {
  bucketTradesIntoCandles,
  computeMovingAverage,
  diffCandles,
  diffTimeSeries,
  resolveAllTimeframeInterval,
  resolveChartInterval,
  tradePriceNativePerToken,
  type Candle,
} from "@/lib/candle-bucketing";
import type { TokenTrade } from "@/lib/token-trade-types";

function trade(overrides: Partial<TokenTrade> = {}): TokenTrade {
  return {
    direction: "buy",
    wallet: "0x1111111111111111111111111111111111111111",
    tokenAmountRaw: "1000000000000000000",
    nativeAmountRaw: "10000000000000000",
    blockNumber: "1",
    blockTimestamp: 0,
    txHash: "0xaaaa000000000000000000000000000000000000000000000000000000aa",
    logIndex: 0,
    ...overrides,
  };
}

describe("tradePriceNativePerToken", () => {
  it("divides the post-fee native amount by the whole-token amount", () => {
    const price = tradePriceNativePerToken(
      trade({ tokenAmountRaw: "2000000000000000000", nativeAmountRaw: "1000000000000000000" }),
      18,
    );
    expect(price).toBeCloseTo(0.5);
  });

  it("returns 0 for a zero token amount instead of dividing by zero", () => {
    expect(tradePriceNativePerToken(trade({ tokenAmountRaw: "0" }), 18)).toBe(0);
  });

  it("respects a non-18 token decimals value", () => {
    const price = tradePriceNativePerToken(
      trade({ tokenAmountRaw: "1000000", nativeAmountRaw: "1000000000000000000" }),
      6,
    );
    expect(price).toBeCloseTo(1);
  });
});

describe("bucketTradesIntoCandles", () => {
  it("returns no candles for no trades", () => {
    expect(bucketTradesIntoCandles([], "5m", 18)).toEqual([]);
  });

  it("buckets trades within the same interval into one OHLC candle", () => {
    const candles = bucketTradesIntoCandles(
      [
        trade({ blockTimestamp: 0, nativeAmountRaw: "10000000000000000", logIndex: 0 }), // price 0.01
        trade({ blockTimestamp: 60, nativeAmountRaw: "20000000000000000", logIndex: 1 }), // price 0.02
        trade({ blockTimestamp: 120, nativeAmountRaw: "5000000000000000", logIndex: 2 }), // price 0.005
        trade({ blockTimestamp: 200, nativeAmountRaw: "15000000000000000", logIndex: 3 }), // price 0.015 (close)
      ],
      "5m",
      18,
    );

    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ time: 0, open: 0.01, high: 0.02, low: 0.005, close: 0.015 });
  });

  it("splits trades across separate buckets once the interval boundary is crossed", () => {
    const candles = bucketTradesIntoCandles(
      [
        trade({ blockTimestamp: 0, nativeAmountRaw: "10000000000000000" }),
        trade({ blockTimestamp: 301, nativeAmountRaw: "20000000000000000" }),
      ],
      "5m",
      18,
    );

    expect(candles).toHaveLength(2);
    expect(candles[0].time).toBe(0);
    expect(candles[1].time).toBe(300);
  });

  it("orders trades chronologically before bucketing regardless of input order", () => {
    const candles = bucketTradesIntoCandles(
      [
        trade({ blockTimestamp: 50, nativeAmountRaw: "20000000000000000", logIndex: 1 }),
        trade({ blockTimestamp: 0, nativeAmountRaw: "10000000000000000", logIndex: 0 }),
      ],
      "5m",
      18,
    );

    expect(candles).toHaveLength(1);
    expect(candles[0].open).toBe(0.01);
    expect(candles[0].close).toBe(0.02);
  });

  it("drops a trade whose price computes to zero instead of corrupting the candle", () => {
    const candles = bucketTradesIntoCandles([trade({ tokenAmountRaw: "0" })], "5m", 18);
    expect(candles).toEqual([]);
  });

  it("returns candles sorted by bucket time ascending", () => {
    const candles = bucketTradesIntoCandles(
      [
        trade({ blockTimestamp: 700, nativeAmountRaw: "10000000000000000" }),
        trade({ blockTimestamp: 0, nativeAmountRaw: "20000000000000000" }),
      ],
      "5m",
      18,
    );
    expect(candles.map((c) => c.time)).toEqual([0, 600]);
  });

  it("uses the correct bucket width per interval", () => {
    const trades = [trade({ blockTimestamp: 3599 }), trade({ blockTimestamp: 3600 })];
    const hourly = bucketTradesIntoCandles(trades, "1h", 18);
    expect(hourly).toHaveLength(2);
    expect(hourly[0].time).toBe(0);
    expect(hourly[1].time).toBe(3600);

    const fiveMinute = bucketTradesIntoCandles(trades, "5m", 18);
    expect(fiveMinute.length).toBeGreaterThanOrEqual(2);

    const daily = bucketTradesIntoCandles(trades, "1d", 18);
    expect(daily).toHaveLength(1);
  });

  it("sums post-fee native volume per bucket, in ETH", () => {
    const candles = bucketTradesIntoCandles(
      [
        trade({ blockTimestamp: 0, nativeAmountRaw: "10000000000000000", logIndex: 0 }), // 0.01 ETH
        trade({ blockTimestamp: 60, nativeAmountRaw: "20000000000000000", logIndex: 1 }), // 0.02 ETH
      ],
      "5m",
      18,
    );
    expect(candles).toHaveLength(1);
    expect(candles[0].volume).toBeCloseTo(0.03);
  });

  it("never counts volume for a dropped zero-price trade", () => {
    const candles = bucketTradesIntoCandles([trade({ tokenAmountRaw: "0", nativeAmountRaw: "5000000000000000" })], "5m", 18);
    expect(candles).toEqual([]);
  });
});

describe("resolveAllTimeframeInterval / resolveChartInterval", () => {
  it("picks the finest interval whose full-history bar count stays at or under the cap", () => {
    const trades = Array.from({ length: 5 }, (_, i) => trade({ blockTimestamp: i * 60, logIndex: i }));
    expect(resolveAllTimeframeInterval(trades, 18)).toBe("5m");
  });

  it("widens to a coarser interval once the finest one would produce too many bars", () => {
    // 400 trades one hour apart span ~16.6 days — 5m/15m/1h all blow past the
    // 200-bar cap, so this should land on 6h (span/21600 ≈ 66 bars).
    const trades = Array.from({ length: 400 }, (_, i) => trade({ blockTimestamp: i * 3600, logIndex: i }));
    expect(resolveAllTimeframeInterval(trades, 18)).toBe("6h");
  });

  it("falls back to the coarsest available interval when even that exceeds the cap", () => {
    // Trades spanning many years even at 1d resolution still exceed 200 bars.
    const trades = Array.from({ length: 3000 }, (_, i) => trade({ blockTimestamp: i * 86400, logIndex: i }));
    expect(resolveAllTimeframeInterval(trades, 18)).toBe("1d");
  });

  it("resolveChartInterval passes fixed intervals through untouched and only expands \"all\"", () => {
    const trades = [trade({ blockTimestamp: 0 })];
    expect(resolveChartInterval("15m", trades, 18)).toBe("15m");
    expect(resolveChartInterval("all", trades, 18)).toBe(resolveAllTimeframeInterval(trades, 18));
  });
});

describe("diffTimeSeries / diffCandles", () => {
  function candle(overrides: Partial<Candle> = {}): Candle {
    return { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1, ...overrides };
  }

  it("reports nothing changed for two identical series", () => {
    const previous = [candle({ time: 0 }), candle({ time: 300 })];
    const next = [candle({ time: 0 }), candle({ time: 300 })];
    expect(diffCandles(previous, next)).toEqual({ updated: [], appended: [] });
  });

  it("detects a mutated last candle without treating it as appended", () => {
    const previous = [candle({ time: 0 }), candle({ time: 300, close: 1 })];
    const mutatedLast = candle({ time: 300, close: 1.5 });
    const next = [previous[0], mutatedLast];
    expect(diffCandles(previous, next)).toEqual({ updated: [mutatedLast], appended: [] });
  });

  it("detects a newly appended candle, leaving the unchanged prefix alone", () => {
    const previous = [candle({ time: 0 }), candle({ time: 300 })];
    const appended = candle({ time: 600 });
    const next = [...previous, appended];
    expect(diffCandles(previous, next)).toEqual({ updated: [], appended: [appended] });
  });

  it("detects both a mutated tail candle and a newly appended one in the same diff", () => {
    const previous = [candle({ time: 0 }), candle({ time: 300, close: 1 })];
    const mutated = candle({ time: 300, close: 2 });
    const appended = candle({ time: 600 });
    const next = [previous[0], mutated, appended];
    expect(diffCandles(previous, next)).toEqual({ updated: [mutated], appended: [appended] });
  });

  it("diffTimeSeries works generically over any {time} shape with a caller-supplied equality check", () => {
    const previous = [{ time: 0, value: 1 }];
    const next = [{ time: 0, value: 1 }, { time: 1, value: 2 }];
    expect(diffTimeSeries(previous, next, (a, b) => a.value === b.value)).toEqual({
      updated: [],
      appended: [{ time: 1, value: 2 }],
    });
  });
});

describe("computeMovingAverage", () => {
  function candlesWithCloses(closes: number[]): Candle[] {
    return closes.map((close, i) => ({ time: i * 300, open: close, high: close, low: close, close, volume: 0 }));
  }

  it("yields no points when there are fewer candles than the period", () => {
    expect(computeMovingAverage(candlesWithCloses([1, 2, 3]), 20)).toEqual([]);
  });

  it("computes a simple moving average once enough candles exist", () => {
    const points = computeMovingAverage(candlesWithCloses([1, 2, 3, 4, 5]), 3);
    expect(points).toEqual([
      { time: 600, value: 2 },
      { time: 900, value: 3 },
      { time: 1200, value: 4 },
    ]);
  });

  it("only depends on already-fixed prior closes, so earlier points never change as more candles arrive", () => {
    const first = computeMovingAverage(candlesWithCloses([1, 2, 3, 4]), 2);
    const second = computeMovingAverage(candlesWithCloses([1, 2, 3, 4, 5]), 2);
    expect(second.slice(0, first.length)).toEqual(first);
  });
});
