import { formatEther, formatUnits } from "viem";
import type { TokenTrade } from "./token-trade-types";

// Pure OHLCV candle bucketing for the token page's live chart (issue #430,
// extended by issue #445), dependency-free so it's unit-testable without a
// network call or a chart library, matching lib/token-page-format.ts's own
// no-dependency style.

/** A fixed, directly-bucketable candle width. "all" is a UI-only selection (see resolveChartInterval) — never passed to bucketTradesIntoCandles itself. */
export type CandleInterval = "5m" | "15m" | "1h" | "6h" | "1d";

export type ChartTimeframe = CandleInterval | "all";

export const CANDLE_INTERVALS: readonly CandleInterval[] = ["5m", "15m", "1h", "6h", "1d"];

export const CHART_TIMEFRAMES: readonly ChartTimeframe[] = [...CANDLE_INTERVALS, "all"];

export const CANDLE_INTERVAL_SECONDS: Record<CandleInterval, number> = {
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
  "1d": 86400,
};

/** ALL picks the coarsest-necessary interval keeping the full history at or under this bar count (issue #445 item 2). */
const ALL_TIMEFRAME_MAX_BARS = 200;

export type Candle = {
  /** Bucket start, unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Total native-currency (ETH) volume traded in this bucket, post-fee amounts summed. */
  volume: number;
};

/**
 * The curve's actual post-trade spot price: its own virtual ETH reserve
 * divided by its own virtual token reserve, immediately after this trade
 * (issue #458). Both `TokensPurchased` and `TokensSold` already carry these
 * reserves, so this is what the curve is actually quoting the *next* trade
 * at — unlike this trade's own nativeAmount÷tokenAmount ratio (its AVERAGE
 * execution price), which is not the same number on a bonding curve and was
 * the root cause of the header/chart/last-price-tag disagreeing with each
 * other. This is the one price definition used everywhere a price is shown
 * or bucketed. `formatUnits`/`formatEther` do the wei-to-decimal conversion
 * via string math (no bigint-to-Number precision loss for the raw amount),
 * so only the final human-scale price ever passes through `Number()`. A
 * trade missing either reserve field (an old/test fixture predating this
 * field) prices as 0 — dropped the same way a zero/invalid amount always was.
 */
export function tradeSpotPriceNativePerToken(trade: TokenTrade, decimals: number): number {
  if (!trade.virtualTokenReserveRaw || !trade.virtualEthReserveRaw) return 0;
  const tokenReserve = Number(formatUnits(BigInt(trade.virtualTokenReserveRaw), decimals));
  if (!Number.isFinite(tokenReserve) || tokenReserve <= 0) return 0;
  const ethReserve = Number(formatEther(BigInt(trade.virtualEthReserveRaw)));
  if (!Number.isFinite(ethReserve) || ethReserve < 0) return 0;
  return ethReserve / tokenReserve;
}

/**
 * Buckets trades into OHLCV candles for a given fixed interval. Trades are
 * sorted chronologically first (by block timestamp, then log index within a
 * block) regardless of input order, so open/close always reflect real trade
 * sequence. A trade with a zero/invalid spot price (e.g. a fixture missing
 * reserve fields) is dropped rather than distorting a candle with a bogus 0
 * price or phantom volume.
 *
 * Open is the previous candle's close carried forward — never this bucket's
 * own first trade — because a bonding curve's price only ever moves via a
 * trade; nothing "resets" it at a bucket boundary. `startingPriceNativePerToken`
 * seeds that carry-forward for the very first candle (the curve's own
 * starting price, before any trade). Callers with no such value on hand
 * (the homepage grid's mini candles have no curve-status read of their own)
 * may omit it, in which case the first candle's open falls back to its own
 * first trade's spot price — the same effective behaviour bucketing had
 * before this function tracked open across buckets at all. High/low are the
 * max/min spot price *after each trade in the bucket* — deliberately not
 * widened by the carried-forward open — matching the curve's own quote
 * sequence for that bucket.
 */
export function bucketTradesIntoCandles(
  trades: TokenTrade[],
  interval: CandleInterval,
  decimals: number,
  startingPriceNativePerToken?: number,
): Candle[] {
  if (trades.length === 0) return [];

  const intervalSeconds = CANDLE_INTERVAL_SECONDS[interval];
  const sorted = [...trades].sort(
    (a, b) => a.blockTimestamp - b.blockTimestamp || a.logIndex - b.logIndex,
  );

  const bucketTrades = new Map<number, TokenTrade[]>();
  for (const trade of sorted) {
    const price = tradeSpotPriceNativePerToken(trade, decimals);
    if (price <= 0) continue;

    const bucketTime = Math.floor(trade.blockTimestamp / intervalSeconds) * intervalSeconds;
    const existing = bucketTrades.get(bucketTime);
    if (existing) existing.push(trade);
    else bucketTrades.set(bucketTime, [trade]);
  }

  const times = [...bucketTrades.keys()].sort((a, b) => a - b);
  const candles: Candle[] = [];
  let previousClose = startingPriceNativePerToken ?? null;

  for (const time of times) {
    const tradesInBucket = bucketTrades.get(time)!;
    const prices = tradesInBucket.map((trade) => tradeSpotPriceNativePerToken(trade, decimals));
    const rawVolumes = tradesInBucket.map((trade) => Number(formatEther(BigInt(trade.nativeAmountRaw))));
    const volume = rawVolumes.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);

    const open = previousClose ?? prices[0];
    const close = prices[prices.length - 1];
    candles.push({ time, open, high: Math.max(...prices), low: Math.min(...prices), close, volume });
    previousClose = close;
  }

  return candles;
}

/**
 * Picks the finest fixed interval whose full-history candle count is at
 * most ALL_TIMEFRAME_MAX_BARS, falling back to the coarsest available
 * interval when even that still exceeds the cap (a token with a very long,
 * very active trading history) — "ALL" should read as one legible chart,
 * never hundreds of hairline bars.
 */
export function resolveAllTimeframeInterval(trades: TokenTrade[], decimals: number): CandleInterval {
  for (const interval of CANDLE_INTERVALS) {
    if (bucketTradesIntoCandles(trades, interval, decimals).length <= ALL_TIMEFRAME_MAX_BARS) return interval;
  }
  return CANDLE_INTERVALS[CANDLE_INTERVALS.length - 1];
}

/** Resolves a chart timeframe selection to the fixed interval to actually bucket with, expanding "all" via resolveAllTimeframeInterval. */
export function resolveChartInterval(timeframe: ChartTimeframe, trades: TokenTrade[], decimals: number): CandleInterval {
  return timeframe === "all" ? resolveAllTimeframeInterval(trades, decimals) : timeframe;
}

/**
 * Generic ascending-time-series diff: since a bucketed series can only ever
 * mutate at its tail (once a bucket's time window has fully passed, nothing
 * can retroactively add a trade to it), comparing index-for-index over the
 * overlapping prefix and treating anything past `previous.length` as new
 * covers every real case cheaply. Used to turn a freshly-rebucketed
 * candle/moving-average/volume array into the minimal set of
 * `series.update()` calls a chart needs, instead of a `setData()` replace
 * that would jump the view (issue #445's core live-update fix).
 */
export function diffTimeSeries<T extends { time: number }>(
  previous: readonly T[],
  next: readonly T[],
  isEqual: (a: T, b: T) => boolean,
): { updated: T[]; appended: T[] } {
  const updated: T[] = [];
  const overlap = Math.min(previous.length, next.length);
  for (let i = 0; i < overlap; i++) {
    if (!isEqual(previous[i], next[i])) updated.push(next[i]);
  }
  const appended = next.length > previous.length ? next.slice(previous.length) : [];
  return { updated, appended };
}

/** diffTimeSeries specialised for OHLCV candles. */
export function diffCandles(previous: readonly Candle[], next: readonly Candle[]): { updated: Candle[]; appended: Candle[] } {
  return diffTimeSeries(
    previous,
    next,
    (a, b) => a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume,
  );
}

/** A gap bucket with no trade — lightweight-charts' WhitespaceData shape (time only, no OHLC). */
export type ChartWhitespacePoint = { time: number };

/** What the chart's candlestick series actually renders: a real candle, or a whitespace gap-filler. */
export type ChartSeriesPoint = Candle | ChartWhitespacePoint;

export function isCandlePoint(point: ChartSeriesPoint): point is Candle {
  return "open" in point;
}

/** How many whitespace bars to pad in before the first real candle, so the axis has real structure on first load even with very few trades (issue #451 item 2). */
const PRE_TRADE_PADDING_BARS = 100;

/** How many bars of padding survive the launch-age cap (issue #458 item 5) — enough that the first real candle still reads as "recent activity", not a lone bar glued to the left edge. */
const LAUNCH_CAPPED_PADDING_BARS = 5;

/**
 * Builds the exact linear timeline the chart's candlestick series should
 * render (issue #451 item 2): every real candle from `bucketTradesIntoCandles`
 * in its own slot, plus a whitespace point for every bucket that has no
 * trade — from ~`PRE_TRADE_PADDING_BARS` bars before the first real candle
 * (or before "now" when there is no trade yet) through the current bucket,
 * so a trade from an hour ago is never placed directly beside a trade from
 * seconds ago (which previously collapsed the time axis to a single label),
 * and the still-open current bucket is always present even with zero trades
 * in it. Never synthesizes a price — a gap bucket is whitespace, not a
 * flat/interpolated candle. `nowUnixSeconds` is a parameter rather than this
 * pure function reaching for the system clock, so the caller controls when
 * "now" advances.
 *
 * `launchedAtUnixSeconds` (issue #458 item 5) caps how far left that padding
 * can reach: on a coarse timeframe (1D) a token launched days ago would
 * otherwise pad ~100 bars *of that width* — literally months — behind its
 * own first trade. The timeline is never allowed to start earlier than
 * `launchedAtUnixSeconds` minus `LAUNCH_CAPPED_PADDING_BARS` bars; since bar
 * width stays fixed regardless of window size, a young token simply shows
 * blank space to the left of its capped start rather than a stretched or
 * fabricated history. Omitted (no launch record) leaves the uncapped
 * ~100-bar padding exactly as before.
 *
 * The cap is a floor on the *padding*, never on a real candle (issue #467
 * item 3): a launch recorded after trading had already begun (e.g. the #425
 * recovery path) previously computed `startTime` as `max(uncappedStartTime,
 * launchFloorTime)`, which — when the launch floor happened to land *after*
 * the earliest real candle — silently excluded that candle from the
 * timeline entirely, since the render loop below never iterates before
 * `startTime`. Taking `min(earliestCandleTime, ...)` guarantees the
 * timeline always reaches back at least as far as the first real trade.
 */
export function buildChartSeriesPoints(
  candles: readonly Candle[],
  interval: CandleInterval,
  nowUnixSeconds: number,
  launchedAtUnixSeconds?: number | null,
): ChartSeriesPoint[] {
  const intervalSeconds = CANDLE_INTERVAL_SECONDS[interval];
  const currentBucketTime = Math.floor(nowUnixSeconds / intervalSeconds) * intervalSeconds;

  const candleByTime = new Map(candles.map((candle) => [candle.time, candle]));
  const earliestTime = candles.length > 0 ? candles[0].time : currentBucketTime;
  const latestCandleTime = candles.length > 0 ? candles[candles.length - 1].time : currentBucketTime;
  const uncappedStartTime = earliestTime - PRE_TRADE_PADDING_BARS * intervalSeconds;
  const launchFloorTime =
    launchedAtUnixSeconds !== null && launchedAtUnixSeconds !== undefined
      ? Math.floor(launchedAtUnixSeconds / intervalSeconds) * intervalSeconds - LAUNCH_CAPPED_PADDING_BARS * intervalSeconds
      : null;
  const startTime =
    launchFloorTime !== null ? Math.min(earliestTime, Math.max(uncappedStartTime, launchFloorTime)) : uncappedStartTime;
  const endTime = Math.max(currentBucketTime, latestCandleTime);

  const points: ChartSeriesPoint[] = [];
  for (let time = startTime; time <= endTime; time += intervalSeconds) {
    points.push(candleByTime.get(time) ?? { time });
  }
  return points;
}

/**
 * diffTimeSeries specialised for the whitespace-inclusive chart timeline
 * (issue #451 item 2). A whitespace-to-candle transition (a trade lands in a
 * bucket that was previously empty) always counts as a change — it's
 * reported as `updated` when the slot already existed in `previous`, so the
 * chart's live-update path calls `series.update()` on that slot the same
 * way it would for a mutated real candle.
 */
export function diffChartSeriesPoints(
  previous: readonly ChartSeriesPoint[],
  next: readonly ChartSeriesPoint[],
): { updated: ChartSeriesPoint[]; appended: ChartSeriesPoint[] } {
  return diffTimeSeries(previous, next, chartSeriesPointsEqual);
}

function chartSeriesPointsEqual(a: ChartSeriesPoint, b: ChartSeriesPoint): boolean {
  const aIsCandle = isCandlePoint(a);
  const bIsCandle = isCandlePoint(b);
  if (aIsCandle !== bIsCandle) return false;
  if (!aIsCandle || !bIsCandle) return true;
  return a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume;
}

export type MovingAveragePoint = { time: number; value: number };

/**
 * Simple moving average of candle closes. Fewer than `period` candles yields
 * no points at all — the line begins only once enough data exists, rather
 * than an inaccurate average over a short window.
 */
export function computeMovingAverage(candles: readonly Candle[], period: number): MovingAveragePoint[] {
  if (period <= 0 || candles.length < period) return [];

  const points: MovingAveragePoint[] = [];
  let windowSum = 0;
  for (let i = 0; i < candles.length; i++) {
    windowSum += candles[i].close;
    if (i >= period) windowSum -= candles[i - period].close;
    if (i >= period - 1) points.push({ time: candles[i].time, value: windowSum / period });
  }
  return points;
}
