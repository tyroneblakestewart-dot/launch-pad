import { formatEther, formatUnits } from "viem";
import type { TokenTrade } from "./token-trade-types";

// Pure OHLCV candle bucketing for the token page's live chart (issue #430,
// extended by issue #445, #458, #467 and #470), dependency-free so it's
// unit-testable without a network call or a chart library, matching
// lib/token-page-format.ts's own no-dependency style.

/** A fixed, directly-bucketable candle width. "all" is a UI-only selection (see resolveChartInterval) — never passed to bucketTradesIntoCandles itself. */
export type CandleInterval = "1s" | "15s" | "1m" | "5m" | "15m" | "1h" | "6h" | "1d";

export type ChartTimeframe = CandleInterval | "all";

export const CANDLE_INTERVALS: readonly CandleInterval[] = ["1s", "15s", "1m", "5m", "15m", "1h", "6h", "1d"];

export const CHART_TIMEFRAMES: readonly ChartTimeframe[] = [...CANDLE_INTERVALS, "all"];

export const CANDLE_INTERVAL_SECONDS: Record<CandleInterval, number> = {
  "1s": 1,
  "15s": 15,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
  "1d": 86400,
};

/** Fixed pixel width per bar — matches the chart's own timeScale `barSpacing` option (components/token-page/token-trade-chart.tsx), the single source of truth shared by lib/token-trade-chart-render.ts's positioning math and this file's sub-minute timeline cap below. */
export const CHART_BAR_SPACING_PX = 6;

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
  /**
   * True for a gap bucket that had no trade, flat-filled at the previous
   * candle's close with zero volume (issue #470 addendum) instead of the old
   * whitespace gap-filler. Absent (falsy) for a real trade candle from
   * `bucketTradesIntoCandles`.
   */
  isFlat?: boolean;
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
 *
 * A pool trade (issue #466, `venue: "pool"`) carries no curve reserves at
 * all — its `spotPriceNativePerTokenRaw` (derived server-side from the
 * Uniswap V3 Swap event's sqrtPriceX96) is preferred whenever present, so
 * every downstream consumer (candles, header figure, dashed line, Stats,
 * market cap) keeps reading the exact same "native per token" quantity
 * across graduation with no other change.
 */
export function tradeSpotPriceNativePerToken(trade: TokenTrade, decimals: number): number {
  if (trade.spotPriceNativePerTokenRaw !== undefined) {
    const price = Number(formatEther(BigInt(trade.spotPriceNativePerTokenRaw)));
    return Number.isFinite(price) && price >= 0 ? price : 0;
  }
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
 *
 * Only ever produces a candle for a bucket that actually had a trade — gap
 * buckets (no trade at all) are the concern of `buildChartSeriesPoints`
 * below, which flat-fills them.
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
 * never hundreds of hairline bars. With 1S/15S/1M available (issue #470
 * item 1), a very short-lived trading history can resolve all the way down
 * to a sub-minute interval — this loop is generic over CANDLE_INTERVALS and
 * needed no change for that to work.
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
 * candle/moving-average array into the minimal set of `series.update()`
 * calls a chart needs, instead of a `setData()` replace that would jump the
 * view (issue #445's core live-update fix).
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

/**
 * diffTimeSeries specialised for OHLCV candles — including the flat-filled
 * gap candles `buildChartSeriesPoints` now emits (issue #470 addendum):
 * `isFlat` is compared alongside OHLCV so a flat candle turning into a real
 * one is always reported as a change even in the (business-rule-impossible,
 * but not type-guaranteed) case its OHLCV happened to already match.
 */
export function diffCandles(previous: readonly Candle[], next: readonly Candle[]): { updated: Candle[]; appended: Candle[] } {
  return diffTimeSeries(
    previous,
    next,
    (a, b) =>
      a.open === b.open &&
      a.high === b.high &&
      a.low === b.low &&
      a.close === b.close &&
      a.volume === b.volume &&
      !!a.isFlat === !!b.isFlat,
  );
}

/** How many flat-filled bars to show before the first real candle when no launch timestamp is known at all (issue #451 item 2 / #470 addendum) — gives the axis real structure on first load even with very few trades. When `launchedAtUnixSeconds` *is* known, the timeline starts exactly at launch instead (see buildChartSeriesPoints below), which needs no such arbitrary buffer. */
const PRE_TRADE_PADDING_BARS = 100;

/**
 * Builds the exact linear timeline the chart's candlestick series should
 * render: every real candle from `bucketTradesIntoCandles` in its own slot,
 * plus a flat candle — open/high/low/close all equal to the previous
 * candle's close, zero volume, `isFlat: true` — for every bucket that has no
 * trade (issue #470 addendum; previously a bare whitespace point with no
 * OHLC at all), from the token's launch (or ~`PRE_TRADE_PADDING_BARS` bars
 * before the first real candle when no launch timestamp is known) through
 * the current bucket, so the still-open current bucket is always present
 * even with zero trades in it and a trade from an hour ago is never placed
 * directly beside a trade from seconds ago. `startingPriceNativePerToken`
 * seeds the very first flat candle (and every gap before the first real
 * trade) at the curve's own starting price; with neither a starting price
 * nor any real candle yet, flat candles fall back to 0. `nowUnixSeconds` is
 * a parameter rather than this pure function reaching for the system clock,
 * so the caller controls when "now" advances.
 *
 * `launchedAtUnixSeconds` anchors the timeline's start at the token's real
 * launch bucket (never later than the earliest real candle — issue #467
 * item 3, a launch recorded after trading had already begun must never
 * exclude an early trade) rather than the old fixed-bar-count padding: since
 * every gap bucket now carries a real (if flat) price, there is no longer
 * any need to fabricate an arbitrary buffer before it — the flat fill from
 * launch to the first trade *is* the token's real history. Omitted (no
 * launch record) falls back to `PRE_TRADE_PADDING_BARS` bars of flat-filled
 * padding before the first real candle, or before "now" when there is no
 * trade at all yet.
 *
 * Sub-minute cap (issue #470 item 2): 1S/15S would otherwise flat-fill one
 * bar per second across a token's *entire* life once it's more than a few
 * minutes old — for `interval` under 60 seconds, the timeline is capped to
 * the most recent `2 × ceil(chartWidthPx / CHART_BAR_SPACING_PX)` bars
 * ending at the current bucket (twice the visible bar count, so scrolling
 * left one screen still has data). This only ever moves the start *later*
 * (dropping earlier bars, real or flat) — a real candle older than the
 * capped window simply falls outside the rendered timeline on that
 * interval; 1M and coarser intervals are entirely unaffected.
 * `chartWidthPx` missing/zero (e.g. before the component's ResizeObserver
 * has fired once) falls back to `FALLBACK_CHART_WIDTH_PX` rather than
 * skipping the cap outright, so an old token's 1S view is never briefly
 * uncapped on first paint.
 */
const FALLBACK_CHART_WIDTH_PX = 600;

export function buildChartSeriesPoints(
  candles: readonly Candle[],
  interval: CandleInterval,
  nowUnixSeconds: number,
  launchedAtUnixSeconds?: number | null,
  startingPriceNativePerToken?: number | null,
  chartWidthPx?: number,
): Candle[] {
  const intervalSeconds = CANDLE_INTERVAL_SECONDS[interval];
  const currentBucketTime = Math.floor(nowUnixSeconds / intervalSeconds) * intervalSeconds;

  const candleByTime = new Map(candles.map((candle) => [candle.time, candle]));
  const earliestCandleTime = candles.length > 0 ? candles[0].time : null;
  const latestCandleTime = candles.length > 0 ? candles[candles.length - 1].time : currentBucketTime;
  const launchBucketTime =
    launchedAtUnixSeconds !== null && launchedAtUnixSeconds !== undefined
      ? Math.floor(launchedAtUnixSeconds / intervalSeconds) * intervalSeconds
      : null;

  let startTime: number;
  if (launchBucketTime !== null) {
    startTime = earliestCandleTime !== null ? Math.min(launchBucketTime, earliestCandleTime) : launchBucketTime;
  } else if (earliestCandleTime !== null) {
    startTime = earliestCandleTime - PRE_TRADE_PADDING_BARS * intervalSeconds;
  } else {
    startTime = currentBucketTime - PRE_TRADE_PADDING_BARS * intervalSeconds;
  }

  const endTime = Math.max(currentBucketTime, latestCandleTime);

  if (intervalSeconds < 60) {
    const width = chartWidthPx && chartWidthPx > 0 ? chartWidthPx : FALLBACK_CHART_WIDTH_PX;
    const maxBars = 2 * Math.ceil(width / CHART_BAR_SPACING_PX);
    const cappedStartTime = endTime - (maxBars - 1) * intervalSeconds;
    startTime = Math.max(startTime, cappedStartTime);
  }

  const points: Candle[] = [];
  let previousClose = startingPriceNativePerToken ?? 0;
  for (let time = startTime; time <= endTime; time += intervalSeconds) {
    const real = candleByTime.get(time);
    if (real) {
      points.push(real);
      previousClose = real.close;
    } else {
      points.push({ time, open: previousClose, high: previousClose, low: previousClose, close: previousClose, volume: 0, isFlat: true });
    }
  }
  return points;
}

export type MovingAveragePoint = { time: number; value: number };

/**
 * Simple moving average of candle closes — run over the flat-filled
 * timeline from `buildChartSeriesPoints`, not just the sparse real-trade
 * candles, so a gap bucket's flat close genuinely participates in the
 * average (issue #470 addendum: "flat candles are real bars"). Fewer than
 * `period` candles yields no points at all — the line begins only once
 * enough data exists, rather than an inaccurate average over a short window.
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
