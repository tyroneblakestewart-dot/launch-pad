import type { TokenTradeItem } from "@/lib/token-trade-view";

// Pure candle-bucketing for the token page's live chart (issue #430). Kept
// free of any chart-library or network dependency so it's unit-testable in
// isolation; components/token-page/token-chart.tsx is the only caller.

export type CandleInterval = "1m" | "5m" | "15m" | "1h";

export const CANDLE_INTERVAL_MS: Record<CandleInterval, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
};

export type Candle = {
  /** Bucket start, in whole seconds — lightweight-charts' UTCTimestamp shape. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/**
 * Buckets trades into OHLC candles by `priceNativePerToken`. Trades are
 * sorted ascending by `blockTimestampMs` first (a defensive copy — callers
 * should already pass ascending order, but open/close would silently swap
 * if they didn't), so within each bucket the first trade sets `open` and
 * the last sets `close`. Returns `[]` for no trades — the chart component
 * renders its axes and an empty-state overlay in that case, never a
 * placeholder box.
 */
export function bucketTradesIntoCandles(
  trades: Pick<TokenTradeItem, "priceNativePerToken" | "blockTimestampMs">[],
  interval: CandleInterval,
): Candle[] {
  if (trades.length === 0) return [];

  const intervalMs = CANDLE_INTERVAL_MS[interval];
  const ordered = [...trades].sort((a, b) => a.blockTimestampMs - b.blockTimestampMs);

  const buckets = new Map<number, Candle>();
  for (const trade of ordered) {
    const bucketTimeSec = Math.floor(Math.floor(trade.blockTimestampMs / intervalMs) * intervalMs / 1000);
    const price = trade.priceNativePerToken;
    const existing = buckets.get(bucketTimeSec);
    if (!existing) {
      buckets.set(bucketTimeSec, { time: bucketTimeSec, open: price, high: price, low: price, close: price });
    } else {
      existing.close = price;
      if (price > existing.high) existing.high = price;
      if (price < existing.low) existing.low = price;
    }
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
