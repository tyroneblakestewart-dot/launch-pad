import { describe, expect, it } from "vitest";
import { bucketTradesIntoCandles, CANDLE_INTERVAL_MS } from "@/lib/candle-bucketing";

function trade(priceNativePerToken: number, blockTimestampMs: number) {
  return { priceNativePerToken, blockTimestampMs };
}

describe("bucketTradesIntoCandles", () => {
  it("returns an empty array for no trades", () => {
    expect(bucketTradesIntoCandles([], "5m")).toEqual([]);
  });

  it("buckets a single trade into a single candle with open == high == low == close", () => {
    const candles = bucketTradesIntoCandles([trade(1.5, 60_000)], "1m");
    expect(candles).toEqual([{ time: 60, open: 1.5, high: 1.5, low: 1.5, close: 1.5 }]);
  });

  it("sets open to the first trade and close to the last trade within a bucket", () => {
    const intervalMs = CANDLE_INTERVAL_MS["5m"];
    const bucketStartMs = 10 * intervalMs;
    const candles = bucketTradesIntoCandles(
      [trade(1, bucketStartMs), trade(2, bucketStartMs + 1_000), trade(1.5, bucketStartMs + 2_000)],
      "5m",
    );
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ open: 1, close: 1.5, high: 2, low: 1 });
  });

  it("tracks high/low across every trade in the bucket regardless of order", () => {
    const candles = bucketTradesIntoCandles([trade(5, 0), trade(1, 1_000), trade(3, 2_000)], "1m");
    expect(candles[0]).toMatchObject({ open: 5, close: 3, high: 5, low: 1 });
  });

  it("splits trades into separate candles once they cross a bucket boundary", () => {
    const intervalMs = CANDLE_INTERVAL_MS["1m"];
    const candles = bucketTradesIntoCandles([trade(1, 0), trade(2, intervalMs)], "1m");
    expect(candles).toHaveLength(2);
    expect(candles[0].time).toBe(0);
    expect(candles[1].time).toBe(intervalMs / 1000);
  });

  it("is defensive against unsorted input — bucketing still reflects true chronological open/close", () => {
    const intervalMs = CANDLE_INTERVAL_MS["1m"];
    const candles = bucketTradesIntoCandles(
      [trade(9, 2_000), trade(1, 0), trade(5, 1_000)],
      "1m",
    );
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ open: 1, close: 9, high: 9, low: 1 });
    void intervalMs;
  });

  it("returns candles sorted ascending by time", () => {
    const intervalMs = CANDLE_INTERVAL_MS["1m"];
    const candles = bucketTradesIntoCandles(
      [trade(3, 3 * intervalMs), trade(1, 0), trade(2, intervalMs)],
      "1m",
    );
    expect(candles.map((c) => c.time)).toEqual([0, intervalMs / 1000, 3 * intervalMs / 1000]);
  });

  it("uses a wider bucket for a larger interval", () => {
    const candles = bucketTradesIntoCandles([trade(1, 0), trade(2, 59 * 60_000)], "1h");
    expect(candles).toHaveLength(1);
  });
});
