import { formatEther, formatUnits } from "viem";
import type { TokenTrade } from "./token-trade-types";

// Pure OHLC candle bucketing for the token page's live chart (issue #430),
// dependency-free so it's unit-testable without a network call or a chart
// library, matching lib/token-page-format.ts's own no-dependency style.

export type CandleInterval = "1m" | "5m" | "15m" | "1h";

export const CANDLE_INTERVALS: readonly CandleInterval[] = ["1m", "5m", "15m", "1h"];

export const CANDLE_INTERVAL_SECONDS: Record<CandleInterval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
};

export type Candle = {
  /** Bucket start, unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/**
 * Native currency paid/received per whole token, from the trade's post-fee
 * amounts — the same ratio the curve itself just quoted the trade at.
 * `formatUnits`/`formatEther` do the wei-to-decimal conversion via string
 * math (no bigint-to-Number precision loss for the raw amount), so only the
 * final human-scale price ever passes through `Number()`.
 */
export function tradePriceNativePerToken(trade: TokenTrade, decimals: number): number {
  const tokenAmount = Number(formatUnits(BigInt(trade.tokenAmountRaw), decimals));
  if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) return 0;
  const nativeAmount = Number(formatEther(BigInt(trade.nativeAmountRaw)));
  if (!Number.isFinite(nativeAmount) || nativeAmount < 0) return 0;
  return nativeAmount / tokenAmount;
}

/**
 * Buckets trades into OHLC candles for a given interval. Trades are sorted
 * chronologically first (by block timestamp, then log index within a block)
 * regardless of input order, so open/close always reflect real trade
 * sequence. A trade with a zero/invalid price (e.g. dust amounts) is
 * dropped rather than distorting a candle with a bogus 0 price.
 */
export function bucketTradesIntoCandles(trades: TokenTrade[], interval: CandleInterval, decimals: number): Candle[] {
  if (trades.length === 0) return [];

  const intervalSeconds = CANDLE_INTERVAL_SECONDS[interval];
  const sorted = [...trades].sort(
    (a, b) => a.blockTimestamp - b.blockTimestamp || a.logIndex - b.logIndex,
  );

  const buckets = new Map<number, Candle>();
  for (const trade of sorted) {
    const price = tradePriceNativePerToken(trade, decimals);
    if (price <= 0) continue;

    const bucketTime = Math.floor(trade.blockTimestamp / intervalSeconds) * intervalSeconds;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, { time: bucketTime, open: price, high: price, low: price, close: price });
    } else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
    }
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
