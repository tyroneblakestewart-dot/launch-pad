import { describe, expect, it } from "vitest";
import { bucketTradesIntoCandles, tradePriceNativePerToken } from "@/lib/candle-bucketing";
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

    const oneMinute = bucketTradesIntoCandles(trades, "1m", 18);
    expect(oneMinute.length).toBeGreaterThanOrEqual(2);
  });
});
