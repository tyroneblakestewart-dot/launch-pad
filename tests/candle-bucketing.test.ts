import { describe, expect, it } from "vitest";
import {
  buildChartSeriesPoints,
  bucketTradesIntoCandles,
  CANDLE_INTERVALS,
  CANDLE_INTERVAL_SECONDS,
  CHART_BAR_SPACING_PX,
  CHART_TIMEFRAMES,
  computeMovingAverage,
  diffCandles,
  diffTimeSeries,
  resolveAllTimeframeInterval,
  resolveChartInterval,
  tradeSpotPriceNativePerToken,
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

  it("issue #466: prefers an explicit spotPriceNativePerTokenRaw (a pool trade) over the reserve-based derivation", () => {
    const price = tradeSpotPriceNativePerToken(
      trade({
        venue: "pool",
        spotPriceNativePerTokenRaw: "2500000000000000000",
        // Reserve fields are absent on a real pool trade, but even if present
        // (e.g. a stale fixture) the explicit spot must win.
        virtualTokenReserveRaw: "2000000000000000000",
        virtualEthReserveRaw: "1000000000000000000",
      }),
      18,
    );
    expect(price).toBeCloseTo(2.5);
  });

  it("issue #466: falls back to the reserve-based derivation when spotPriceNativePerTokenRaw is absent (a curve trade)", () => {
    const price = tradeSpotPriceNativePerToken(
      trade({ virtualTokenReserveRaw: "2000000000000000000", virtualEthReserveRaw: "1000000000000000000" }),
      18,
    );
    expect(price).toBeCloseTo(0.5);
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

describe("CandleInterval table (issue #470 item 1)", () => {
  it("extends the interval list with 1S/15S/1M ahead of the existing 5M/15M/1H/6H/1D set, in rail order", () => {
    expect(CANDLE_INTERVALS).toEqual(["1s", "15s", "1m", "5m", "15m", "1h", "6h", "1d"]);
  });

  it("gives every interval its correct second count", () => {
    expect(CANDLE_INTERVAL_SECONDS).toEqual({
      "1s": 1,
      "15s": 15,
      "1m": 60,
      "5m": 300,
      "15m": 900,
      "1h": 3600,
      "6h": 21600,
      "1d": 86400,
    });
  });

  it("the chart timeframe rail is the eight intervals plus ALL — nine chips total", () => {
    expect(CHART_TIMEFRAMES).toHaveLength(9);
    expect(CHART_TIMEFRAMES[CHART_TIMEFRAMES.length - 1]).toBe("all");
  });
});

describe("resolveAllTimeframeInterval / resolveChartInterval", () => {
  it("picks the very finest interval (1S) when even that keeps the full-history bar count under the cap (issue #470 item 1)", () => {
    const trades = Array.from({ length: 5 }, (_, i) => tradeAtPrice(0.01, { blockTimestamp: i * 60, logIndex: i }));
    expect(resolveAllTimeframeInterval(trades, 18)).toBe("1s");
  });

  it("widens to a coarser sub-minute interval (15S) once 1S alone would produce too many buckets (issue #470 item 1)", () => {
    // 250 trades one second apart: at 1S every trade gets its own bucket
    // (250 > 200, too many), but 15S groups them into ~17 buckets.
    const trades = Array.from({ length: 250 }, (_, i) => tradeAtPrice(0.01, { blockTimestamp: i, logIndex: i }));
    expect(resolveAllTimeframeInterval(trades, 18)).toBe("15s");
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

  it("counts a flat-filled candle's close the same as a real one — flat bars are real bars for MA purposes (issue #470 addendum)", () => {
    const withFlatBar: Candle[] = [
      { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 300, open: 1, high: 1, low: 1, close: 1, volume: 0, isFlat: true },
      { time: 600, open: 3, high: 3, low: 3, close: 3, volume: 1 },
    ];
    expect(computeMovingAverage(withFlatBar, 3)).toEqual([{ time: 600, value: (1 + 1 + 3) / 3 }]);
  });
});

describe("buildChartSeriesPoints (issue #451 item 2: gap buckets and time axis, flat-filled per issue #470's addendum)", () => {
  it("flat-fills exactly the gap buckets between two trades an hour apart at 5m, each carrying the previous close", () => {
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 0 }), tradeAtPrice(0.02, { blockTimestamp: 3600, logIndex: 1 })];
    const candles = bucketTradesIntoCandles(trades, "5m", 18);
    const points = buildChartSeriesPoints(candles, "5m", 3600, null, 0.01);
    const between = points.filter((point) => point.time > 0 && point.time < 3600);
    expect(between).toHaveLength(11);
    for (const point of between) {
      expect(point.isFlat).toBe(true);
      expect(point).toMatchObject({ open: 0.01, high: 0.01, low: 0.01, close: 0.01, volume: 0 });
    }
  });

  it("keeps the current bucket present, flat-filled, once now has moved past the last trade's bucket", () => {
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 0 })];
    const candles = bucketTradesIntoCandles(trades, "5m", 18);
    const points = buildChartSeriesPoints(candles, "5m", 900, null, 0.01);
    const last = points[points.length - 1];
    expect(last.time).toBe(900);
    expect(last.isFlat).toBe(true);
    expect(last.close).toBeCloseTo(0.01);
  });

  it("pads roughly 100 flat-filled bars before the first trade on first load when no launch timestamp is known", () => {
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 0 })];
    const candles = bucketTradesIntoCandles(trades, "5m", 18);
    const points = buildChartSeriesPoints(candles, "5m", 0);
    const padding = points.filter((point) => point.time < 0);
    expect(padding).toHaveLength(100);
    for (const point of padding) expect(point.isFlat).toBe(true);
  });

  it("still produces a flat-filled timeline (never a bare whitespace point) when there are zero trades yet", () => {
    const points = buildChartSeriesPoints([], "5m", 3600, null, 0.02);
    for (const point of points) {
      expect(typeof point.open).toBe("number");
      expect(typeof point.close).toBe("number");
      expect(point.isFlat).toBe(true);
      expect(point.close).toBeCloseTo(0.02);
    }
    expect(points[points.length - 1].time).toBe(3600);
    expect(points).toHaveLength(101);
  });

  it("every gap bucket carries full OHLCV — never a bare time-only point (issue #470 addendum)", () => {
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 0 }), tradeAtPrice(0.01, { blockTimestamp: 3600, logIndex: 1 })];
    const candles = bucketTradesIntoCandles(trades, "5m", 18);
    const points = buildChartSeriesPoints(candles, "5m", 3600, null, 0.01);
    for (const point of points) {
      const keys = Object.keys(point).sort();
      const expectedKeys = point.isFlat
        ? ["close", "high", "isFlat", "low", "open", "time", "volume"]
        : ["close", "high", "low", "open", "time", "volume"];
      expect(keys).toEqual(expectedKeys);
    }
  });

  it("filtering the flat-filled bars back out of the timeline exactly reproduces the real candles", () => {
    const trades = [
      tradeAtPrice(0.01, { blockTimestamp: 0 }),
      tradeAtPrice(0.01, { blockTimestamp: 900, logIndex: 1 }),
      tradeAtPrice(0.01, { blockTimestamp: 3600, logIndex: 2 }),
    ];
    const candles = bucketTradesIntoCandles(trades, "5m", 18);
    const points = buildChartSeriesPoints(candles, "5m", 3600, null, 0.01);
    const recoveredCandles = points.filter((point) => !point.isFlat);
    expect(recoveredCandles).toEqual(candles);
  });
});

describe("buildChartSeriesPoints flat-fills every interval from launch to the current bucket (issue #470 addendum)", () => {
  it("yields 24 candles ending at the current bucket for a 5M timeline spanning ~2 hours from launch, with two real trades", () => {
    const launchedAtUnixSeconds = 0;
    const firstTrade = tradeAtPrice(0.01, { blockTimestamp: 1_500 });
    const secondTrade = tradeAtPrice(0.012, { blockTimestamp: 4_800, logIndex: 1 });
    const candles = bucketTradesIntoCandles([firstTrade, secondTrade], "5m", 18, 0.005);
    const nowUnixSeconds = 6_900; // 23 buckets after launch -> 24 candles inclusive

    const points = buildChartSeriesPoints(candles, "5m", nowUnixSeconds, launchedAtUnixSeconds, 0.005);

    expect(points).toHaveLength(24);
    expect(points[0].time).toBe(0);
    expect(points[points.length - 1].time).toBe(nowUnixSeconds);
    for (const point of points) {
      expect(typeof point.open).toBe("number");
      expect(typeof point.close).toBe("number");
    }
  });

  it("the first candle before any real trade is flat at the curve's starting price", () => {
    const points = buildChartSeriesPoints([], "5m", 900, 0, 0.03);
    expect(points[0].isFlat).toBe(true);
    expect(points[0].close).toBeCloseTo(0.03);
    expect(points[0].open).toBeCloseTo(0.03);
  });

  it("a flat gap bucket carries the previous real candle's close, not the starting price, once trading has begun", () => {
    const trade1 = tradeAtPrice(0.02, { blockTimestamp: 0 });
    const candles = bucketTradesIntoCandles([trade1], "5m", 18, 0.01);
    const points = buildChartSeriesPoints(candles, "5m", 900, 0, 0.01);
    const flatBucket = points.find((point) => point.time === 300);
    expect(flatBucket).toBeDefined();
    expect(flatBucket!.isFlat).toBe(true);
    expect(flatBucket).toMatchObject({ open: 0.02, high: 0.02, low: 0.02, close: 0.02, volume: 0 });
  });

  it("starts exactly at the launch bucket — no extra arbitrary padding buffer before it — when launchedAtUnixSeconds is known and trading hasn't started yet", () => {
    const launchedAtUnixSeconds = 10_000;
    const points = buildChartSeriesPoints([], "1d", 10_100, launchedAtUnixSeconds, 0.01);
    const intervalSeconds = 86_400;
    const expectedStart = Math.floor(launchedAtUnixSeconds / intervalSeconds) * intervalSeconds;
    expect(points[0].time).toBe(expectedStart);
  });

  it("falls back to the ~100-bar flat-filled padding before the first trade when no launch timestamp is known at all", () => {
    const trades = [tradeAtPrice(0.01, { blockTimestamp: 0 })];
    const candles = bucketTradesIntoCandles(trades, "1d", 18);
    const points = buildChartSeriesPoints(candles, "1d", 0, null, 0.01);
    expect(points.filter((point) => point.time < 0)).toHaveLength(100);
  });
});

describe("buildChartSeriesPoints never drops a real candle earlier than the launch floor (issue #467 item 3, preserved)", () => {
  it("retains a candle from ~2 hours before launchedAt on 5M, even though launch alone would sit after it", () => {
    // A launch recorded after trading had already begun (e.g. the #425
    // recovery path): the timeline must still start at (or before) the
    // early trade's own bucket, never at the later launch bucket alone.
    const launchedAtUnixSeconds = 10_000;
    const earlyTrade = tradeAtPrice(0.01, { blockTimestamp: 2_800 }); // ~2h before launch
    const laterTrade = tradeAtPrice(0.012, { blockTimestamp: 10_050, logIndex: 1 });
    const candles = bucketTradesIntoCandles([earlyTrade, laterTrade], "5m", 18);
    const points = buildChartSeriesPoints(candles, "5m", 10_200, launchedAtUnixSeconds, 0.01);

    expect(candles[0].time).toBeLessThan(launchedAtUnixSeconds); // sanity: this is exactly the case the old clamp mishandled

    const earlyCandlePoint = points.find((point) => point.time === candles[0].time);
    expect(earlyCandlePoint).toBeDefined();
    expect(earlyCandlePoint!.isFlat).toBeFalsy();
    expect(points[0].time).toBe(candles[0].time);
  });
});

describe("buildChartSeriesPoints caps the sub-minute timeline instead of flat-filling one bar per second across a token's whole life (issue #470 item 2)", () => {
  it("caps a 1S timeline over a 4-day-old token to ~2x the chart's visible bar count, still ending at the current second, retaining a candle inside the window", () => {
    const FOUR_DAYS = 4 * 24 * 3600;
    const nowUnixSeconds = FOUR_DAYS;
    const launchedAtUnixSeconds = 0;
    const oldTrade = tradeAtPrice(0.01, { blockTimestamp: 10 });
    const recentTrade = tradeAtPrice(0.02, { blockTimestamp: nowUnixSeconds - 5, logIndex: 1 });
    const candles = bucketTradesIntoCandles([oldTrade, recentTrade], "1s", 18, 0.005);

    const points = buildChartSeriesPoints(candles, "1s", nowUnixSeconds, launchedAtUnixSeconds, 0.005, 1400);

    const expectedMaxBars = 2 * Math.ceil(1400 / CHART_BAR_SPACING_PX);
    expect(points.length).toBeLessThanOrEqual(expectedMaxBars);
    expect(points[points.length - 1].time).toBe(nowUnixSeconds);

    const recentPoint = points.find((point) => point.time === recentTrade.blockTimestamp);
    expect(recentPoint).toBeDefined();
    expect(recentPoint!.isFlat).toBeFalsy();

    // The 4-day-old trade falls outside the capped window and is simply absent.
    expect(points.find((point) => point.time === oldTrade.blockTimestamp)).toBeUndefined();
  });

  it("leaves 5M (and coarser) timelines uncapped — the sub-minute cap only applies under 60 seconds", () => {
    const FOUR_DAYS = 4 * 24 * 3600;
    const candles = bucketTradesIntoCandles([tradeAtPrice(0.01, { blockTimestamp: 0 })], "5m", 18);
    // A tiny width that would produce a very small cap if (wrongly) applied at 5M.
    const points = buildChartSeriesPoints(candles, "5m", FOUR_DAYS, 0, 0.01, 100);
    expect(points.length).toBe(Math.floor(FOUR_DAYS / 300) + 1);
  });
});
