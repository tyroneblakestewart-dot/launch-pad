import { describe, expect, it } from "vitest";
import {
  buildChartSeriesPoints,
  bucketTradesIntoCandles,
  computeMovingAverage,
  diffCandles,
  diffChartSeriesPoints,
  diffTimeSeries,
  isCandlePoint,
  resolveAllTimeframeInterval,
  resolveChartInterval,
  tradeSpotPriceNativePerToken,
  type Candle,
  type ChartSeriesPoint,
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
    virtualTokenReserveRaw: "1000000000000000000",
    virtualEthReserveRaw: "10000000000000000",
    ...overrides,
  };
}

/** A trade priced at exactly `price` ETH per whole token (18-decimal reserves), for readable fixtures. */
function tradeAtPrice(price: number, overrides: Partial<TokenTrade> = {}): TokenTrade {
  const tokenReserve = 1_000_000;
  const ethReserve = tokenReserve * price;
  return trade({
    virtualTokenReserveRaw: String(BigInt(Math.round(tokenReserve * 1e18))),
    virtualEthReserveRaw: String(BigInt(Math.round(ethReserve * 1e18))),
    ...overrides,
  });
}

describe("tradeSpotPriceNativePerToken (issue #458)", () => {
  it("divides the curve's own post-trade virtual ETH reserve by its virtual token reserve — never the trade's own average price", () => {
    const price = tradeSpotPriceNativePerToken(
      trade({ virtualTokenReserveRaw: "2000000000000000000", virtualEthReserveRaw: "1000000000000000000" }),
      18,
    );
    expect(price).toBeCloseTo(0.5);
  });

  it("ignores the trade's own nativeAmount/tokenAmount fields entirely", () => {
    const price = tradeSpotPriceNativePerToken(
      trade({
        tokenAmountRaw: "999999999999999999",
        nativeAmountRaw: "1",
        virtualTokenReserveRaw: "2000000000000000000",
        virtualEthReserveRaw: "1000000000000000000",
      }),
      18,
    );
    expect(price).toBeCloseTo(0.5);
  });

  it("returns 0 for a zero virtual token reserve instead of dividing by zero", () => {
    expect(tradeSpotPriceNativePerToken(trade({ virtualTokenReserveRaw: "0" }), 18)).toBe(0);
  });

  it("returns 0 when either reserve field is missing (an old/test fixture predating this field)", () => {
    const missingTokenReserve = trade();
    delete (missingTokenReserve as { virtualTokenReserveRaw?: string }).virtualTokenReserveRaw;
    expect(tradeSpotPriceNativePerToken(missingTokenReserve, 18)).toBe(0);

    const missingEthReserve = trade();
    delete (missingEthReserve as { virtualEthReserveRaw?: string }).virtualEthReserveRaw;
    expect(tradeSpotPriceNativePerToken(missingEthReserve, 18)).toBe(0);
  });

  it("respects a non-18 token decimals value", () => {
    const price = tradeSpotPriceNativePerToken(
      trade({ virtualTokenReserveRaw: "1000000", virtualEthReserveRaw: "1000000000000000000" }),
      6,
    );
    expect(price).toBeCloseTo(1);
  });

  it("prefers an explicit spotPriceNativePerTokenRaw (a pool trade, issue #466) over the reserve-based derivation", () => {
    const price = tradeSpotPriceNativePerToken(
      trade({
        virtualTokenReserveRaw: "2000000000000000000",
        virtualEthReserveRaw: "1000000000000000000",
        spotPriceNativePerTokenRaw: "4000000000000000000",
      }),
      18,
    );
    expect(price).toBeCloseTo(4);
  });

  it("uses the explicit spot even with no reserve fields at all — a pool trade carries no curve reserves", () => {
    const pool = trade({ spotPriceNativePerTokenRaw: "4000000000000000000" });
    delete (pool as { virtualTokenReserveRaw?: string }).virtualTokenReserveRaw;
    delete (pool as { virtualEthReserveRaw?: string }).virtualEthReserveRaw;
    expect(tradeSpotPriceNativePerToken(pool, 18)).toBeCloseTo(4);
  });
});

describe("bucketTradesIntoCandles (issue #458: post-trade spot price, carried-forward open)", () => {
  it("returns no candles for no trades", () => {
    expect(bucketTradesIntoCandles([], "5m", 18)).toEqual([]);
  });

  it("prices a single-trade candle from the curve's post-trade spot, with open falling back to that same spot price when no starting price is supplied", () => {
    const candles = bucketTradesIntoCandles([tradeAtPrice(0.02)], "5m", 18);
    expect(candles).toHaveLength(1);
    expect(candles[0].open).toBeCloseTo(0.02);
    expect(candles[0].close).toBeCloseTo(0.02);
    expect(candles[0].high).toBeCloseTo(0.02);
    expect(candles[0].low).toBeCloseTo(0.02);
  });

  it("seeds the first candle's open from the supplied curve starting price instead of the first trade's own price", () => {
    const candles = bucketTradesIntoCandles([tradeAtPrice(0.02, { blockTimestamp: 0 })], "5m", 18, 0.01);
    expect(candles[0].open).toBeCloseTo(0.01);
    expect(candles[0].close).toBeCloseTo(0.02);
  });

  it("buckets multiple trades within the same interval into one OHLC candle using each trade's post-trade spot price", () => {
    const candles = bucketTradesIntoCandles(
      [
        tradeAtPrice(0.01, { blockTimestamp: 0, logIndex: 0 }),
        tradeAtPrice(0.02, { blockTimestamp: 60, logIndex: 1 }),
        tradeAtPrice(0.005, { blockTimestamp: 120, logIndex: 2 }),
        tradeAtPrice(0.015, { blockTimestamp: 200, logIndex: 3 }),
      ],
      "5m",
      18,
    );

    expect(candles).toHaveLength(1);
    expect(candles[0].high).toBeCloseTo(0.02);
    expect(candles[0].low).toBeCloseTo(0.005);
    expect(candles[0].close).toBeCloseTo(0.015);
  });

  it("carries each candle's open forward from the previous candle's close, never resetting to this bucket's own first trade", () => {
    const candles = bucketTradesIntoCandles(
      [
        tradeAtPrice(0.01, { blockTimestamp: 0, logIndex: 0 }),
        tradeAtPrice(0.02, { blockTimestamp: 60, logIndex: 1 }),
        // Next bucket (5m later): a single trade whose own spot price (0.05)
        // is not the open — the open must be 0.02, the prior candle's close.
        tradeAtPrice(0.05, { blockTimestamp: 400, logIndex: 2 }),
      ],
      "5m",
      18,
    );

    expect(candles).toHaveLength(2);
    expect(candles[0].close).toBeCloseTo(0.02);
    expect(candles[1].open).toBeCloseTo(0.02);
    expect(candles[1].close).toBeCloseTo(0.05);
  });

  it("splits trades across separate buckets once the interval boundary is crossed", () => {
    const candles = bucketTradesIntoCandles(
      [tradeAtPrice(0.01, { blockTimestamp: 0 }), tradeAtPrice(0.02, { blockTimestamp: 301 })],
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
        tradeAtPrice(0.02, { blockTimestamp: 50, logIndex: 1 }),
        tradeAtPrice(0.01, { blockTimestamp: 0, logIndex: 0 }),
      ],
      "5m",
      18,
    );

    expect(candles).toHaveLength(1);
    expect(candles[0].close).toBeCloseTo(0.02);
  });

  it("drops a trade whose spot price computes to zero instead of corrupting the candle", () => {
    const candles = bucketTradesIntoCandles([trade({ virtualTokenReserveRaw: "0" })], "5m", 18);
    expect(candles).toEqual([]);
  });

  it("returns candles sorted by bucket time ascending", () => {
    const candles = bucketTradesIntoCandles(
      [tradeAtPrice(0.01, { blockTimestamp: 700 }), tradeAtPrice(0.02, { blockTimestamp: 0 })],
      "5m",
      18,
    );
    expect(candles.map((c) => c.time)).toEqual([0, 600]);
  });

  it("uses the correct bucket width per interval", () => {
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 3599 }), tradeAtPrice(0.01, { blockTimestamp: 3600 })];
    const hourly = bucketTradesIntoCandles(trades, "1h", 18);
    expect(hourly).toHaveLength(2);
    expect(hourly[0].time).toBe(0);
    expect(hourly[1].time).toBe(3600);

    const fiveMinute = bucketTradesIntoCandles(trades, "5m", 18);
    expect(fiveMinute.length).toBeGreaterThanOrEqual(2);

    const daily = bucketTradesIntoCandles(trades, "1d", 18);
    expect(daily).toHaveLength(1);
  });

  it("sums post-fee native volume per bucket, in ETH, from each trade's nativeAmountRaw", () => {
    const candles = bucketTradesIntoCandles(
      [
        tradeAtPrice(0.01, { blockTimestamp: 0, logIndex: 0, nativeAmountRaw: "10000000000000000" }), // 0.01 ETH
        tradeAtPrice(0.02, { blockTimestamp: 60, logIndex: 1, nativeAmountRaw: "20000000000000000" }), // 0.02 ETH
      ],
      "5m",
      18,
    );
    expect(candles).toHaveLength(1);
    expect(candles[0].volume).toBeCloseTo(0.03);
  });

  it("never counts volume for a dropped zero-price trade", () => {
    const candles = bucketTradesIntoCandles(
      [trade({ virtualTokenReserveRaw: "0", nativeAmountRaw: "5000000000000000" })],
      "5m",
      18,
    );
    expect(candles).toEqual([]);
  });
});

describe("resolveAllTimeframeInterval / resolveChartInterval", () => {
  it("picks the finest interval whose full-history bar count stays at or under the cap", () => {
    const trades = Array.from({ length: 5 }, (_, i) => tradeAtPrice(0.01, { blockTimestamp: i * 60, logIndex: i }));
    expect(resolveAllTimeframeInterval(trades, 18)).toBe("5m");
  });

  it("widens to a coarser interval once the finest one would produce too many bars", () => {
    // 400 trades one hour apart span ~16.6 days — 5m/15m/1h all blow past the
    // 200-bar cap, so this should land on 6h (span/21600 ≈ 66 bars).
    const trades = Array.from({ length: 400 }, (_, i) => tradeAtPrice(0.01, { blockTimestamp: i * 3600, logIndex: i }));
    expect(resolveAllTimeframeInterval(trades, 18)).toBe("6h");
  });

  it("falls back to the coarsest available interval when even that exceeds the cap", () => {
    // Trades spanning many years even at 1d resolution still exceed 200 bars.
    const trades = Array.from({ length: 3000 }, (_, i) => tradeAtPrice(0.01, { blockTimestamp: i * 86400, logIndex: i }));
    expect(resolveAllTimeframeInterval(trades, 18)).toBe("1d");
  });

  it("resolveChartInterval passes fixed intervals through untouched and only expands \"all\"", () => {
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 0 })];
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

describe("buildChartSeriesPoints (issue #451 item 2: gaps and time axis)", () => {
  it("fills exactly the whitespace bars between two trades an hour apart at 5m", () => {
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 0 }), tradeAtPrice(0.01, { blockTimestamp: 3600, logIndex: 1 })];
    const candles = bucketTradesIntoCandles(trades, "5m", 18);
    const points = buildChartSeriesPoints(candles, "5m", 3600);
    const between = points.filter((point) => point.time > 0 && point.time < 3600);
    expect(between).toHaveLength(11);
    expect(between.every((point) => !isCandlePoint(point))).toBe(true);
  });

  it("keeps the current bucket present as whitespace once now has moved past the last trade's bucket", () => {
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 0 })];
    const candles = bucketTradesIntoCandles(trades, "5m", 18);
    const points = buildChartSeriesPoints(candles, "5m", 900);
    const last = points[points.length - 1];
    expect(last.time).toBe(900);
    expect(isCandlePoint(last)).toBe(false);
  });

  it("pads roughly 100 whitespace bars before the first trade on first load", () => {
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 0 })];
    const candles = bucketTradesIntoCandles(trades, "5m", 18);
    const points = buildChartSeriesPoints(candles, "5m", 0);
    expect(points.filter((point) => point.time < 0)).toHaveLength(100);
  });

  it("still produces a padded whitespace timeline (never candles) when there are zero trades yet", () => {
    const points = buildChartSeriesPoints([], "5m", 3600);
    expect(points.every((point) => !isCandlePoint(point))).toBe(true);
    expect(points[points.length - 1].time).toBe(3600);
    expect(points).toHaveLength(101);
  });

  it("never synthesizes OHLC for a gap bucket — whitespace points carry only a time field", () => {
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 0 }), tradeAtPrice(0.01, { blockTimestamp: 3600, logIndex: 1 })];
    const candles = bucketTradesIntoCandles(trades, "5m", 18);
    const points = buildChartSeriesPoints(candles, "5m", 3600);
    for (const point of points) {
      if (!isCandlePoint(point)) expect(Object.keys(point)).toEqual(["time"]);
    }
  });

  it("filtering the candle points back out of the timeline exactly reproduces the real candles — MA/stats never see whitespace", () => {
    const trades = [
      tradeAtPrice(0.01, { blockTimestamp: 0 }),
      tradeAtPrice(0.01, { blockTimestamp: 900, logIndex: 1 }),
      tradeAtPrice(0.01, { blockTimestamp: 3600, logIndex: 2 }),
    ];
    const candles = bucketTradesIntoCandles(trades, "5m", 18);
    const points = buildChartSeriesPoints(candles, "5m", 3600);
    const recoveredCandles = points.filter(isCandlePoint);
    expect(recoveredCandles).toEqual(candles);
    expect(computeMovingAverage(recoveredCandles, 2)).toEqual(computeMovingAverage(candles, 2));
  });
});

describe("buildChartSeriesPoints launch-age padding cap (issue #458 item 5)", () => {
  it("caps the timeline's start at launchedAt minus 5 bars when that's tighter than the ~100-bar default padding", () => {
    const launchedAtUnixSeconds = 10_000;
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 10_100 })];
    const candles = bucketTradesIntoCandles(trades, "1d", 18);
    const points = buildChartSeriesPoints(candles, "1d", 10_100, launchedAtUnixSeconds);

    const intervalSeconds = 86_400;
    const expectedStart = Math.floor(launchedAtUnixSeconds / intervalSeconds) * intervalSeconds - 5 * intervalSeconds;
    expect(points[0].time).toBe(expectedStart);
    // Uncapped, 1D padding would reach 100 days back — the cap must leave far fewer bars.
    expect(points.length).toBeLessThan(20);
  });

  it("never widens the timeline earlier than the uncapped default padding when the launch floor is already looser", () => {
    // A token launched long before its first trade: launchedAt - 5 bars sits
    // earlier than the uncapped 100-bar-before-first-trade point, so the cap
    // (a max(), never a min()) must leave the uncapped start untouched.
    const launchedAtUnixSeconds = 0;
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 30_000 })]; // 100 bars (at 5m) after launch
    const candles = bucketTradesIntoCandles(trades, "5m", 18);
    const uncapped = buildChartSeriesPoints(candles, "5m", 30_000);
    const capped = buildChartSeriesPoints(candles, "5m", 30_000, launchedAtUnixSeconds);
    expect(capped[0].time).toBe(uncapped[0].time);
  });

  it("leaves the uncapped ~100-bar padding untouched when no launch timestamp is known", () => {
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 0 })];
    const candles = bucketTradesIntoCandles(trades, "1d", 18);
    const withoutLaunch = buildChartSeriesPoints(candles, "1d", 0);
    const withNullLaunch = buildChartSeriesPoints(candles, "1d", 0, null);
    expect(withNullLaunch).toEqual(withoutLaunch);
    expect(withoutLaunch.filter((point) => point.time < 0)).toHaveLength(100);
  });
});

describe("diffChartSeriesPoints (issue #451 item 2: whitespace-inclusive live updates)", () => {
  it("reports nothing changed for two identical whitespace-inclusive timelines", () => {
    const previous: ChartSeriesPoint[] = [{ time: 0 }, { time: 300 }];
    const next: ChartSeriesPoint[] = [{ time: 0 }, { time: 300 }];
    expect(diffChartSeriesPoints(previous, next)).toEqual({ updated: [], appended: [] });
  });

  it("converts a whitespace slot into a candle when a trade lands in a previously-empty bucket", () => {
    const candle: Candle = { time: 300, open: 1, high: 1, low: 1, close: 1, volume: 1 };
    const previous: ChartSeriesPoint[] = [{ time: 0 }, { time: 300 }];
    const next: ChartSeriesPoint[] = [{ time: 0 }, candle];
    expect(diffChartSeriesPoints(previous, next)).toEqual({ updated: [candle], appended: [] });
  });

  it("detects a newly appended whitespace bar at the tail as the clock advances with no new trade", () => {
    const previous: ChartSeriesPoint[] = [{ time: 0 }];
    const appended: ChartSeriesPoint = { time: 300 };
    const next: ChartSeriesPoint[] = [...previous, appended];
    expect(diffChartSeriesPoints(previous, next)).toEqual({ updated: [], appended: [appended] });
  });

  it("treats two whitespace points at the same time as equal, never reporting a spurious update", () => {
    const previous: ChartSeriesPoint[] = [{ time: 0 }];
    const next: ChartSeriesPoint[] = [{ time: 0 }];
    expect(diffChartSeriesPoints(previous, next)).toEqual({ updated: [], appended: [] });
  });
});

describe("isCandlePoint", () => {
  it("distinguishes a real candle from a whitespace point", () => {
    const candle: Candle = { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 };
    expect(isCandlePoint(candle)).toBe(true);
    expect(isCandlePoint({ time: 0 })).toBe(false);
  });
});
