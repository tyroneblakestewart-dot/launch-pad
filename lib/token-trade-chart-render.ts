import {
  bucketTradesIntoCandles,
  buildChartSeriesPoints,
  computeMovingAverage,
  diffCandles,
  diffChartSeriesPoints,
  diffTimeSeries,
  isCandlePoint,
  type Candle,
  type CandleInterval,
  type ChartSeriesPoint,
  type ChartTimeframe,
  type MovingAveragePoint,
} from "@/lib/candle-bucketing";
import type { TokenTrade } from "@/lib/token-trade-types";

// Pure live-update engine behind components/token-page/token-trade-chart.tsx
// (issue #458 item 3), extracted out of that "use client" component's effect
// so the incremental-vs-full-resync decision (issue #445/#451/#453) is
// directly unit-testable against a fake series object — this repo's Vitest
// suite runs in a plain Node environment with no jsdom/DOM renderer, so a
// pure function taking a duck-typed series bundle is the only way to exercise
// this logic with a real regression fixture instead of a source-string
// assertion. The component itself only wires real lightweight-charts series
// into `TokenTradeChartSeriesBundle` and calls `applyTokenTradeChartUpdate`;
// every actual decision (setData vs. update, the out-of-order pre-check, the
// try/catch fallback, restoring the visible range after a forced resync)
// lives here, unchanged in behaviour from before the extraction.

type ChartBar = { time: number; open: number; high: number; low: number; close: number };
type ChartSeriesDatum = ChartBar | { time: number };
type VolumeDatum = { time: number; value: number; color: string };
type LinePoint = { time: number; value: number };

export function candleToBar(candle: Candle): ChartBar {
  return { time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close };
}

/** Converts a whitespace-inclusive timeline point to what the candlestick series expects: an OHLC bar, or a bare-time WhitespaceData point. */
export function pointToSeriesDatum(point: ChartSeriesPoint): ChartSeriesDatum {
  return isCandlePoint(point) ? candleToBar(point) : { time: point.time };
}

export function volumeBarColor(candle: Candle): string {
  return candle.close >= candle.open ? "rgba(198, 245, 62, 0.35)" : "rgba(141, 145, 140, 0.35)";
}

/** Minimal duck-typed subset of lightweight-charts' `ISeriesApi` this engine drives. */
export type ChartSeriesLike<TDatum> = {
  setData(data: TDatum[]): void;
  update(datum: TDatum): void;
};

export type ChartTimeScaleLike = {
  scrollToRealTime(): void;
  getVisibleLogicalRange(): { from: number; to: number } | null;
  setVisibleLogicalRange(range: { from: number; to: number }): void;
};

export type TokenTradeChartSeriesBundle = {
  candleSeries: ChartSeriesLike<ChartSeriesDatum>;
  ma20Series: ChartSeriesLike<LinePoint>;
  ma50Series: ChartSeriesLike<LinePoint>;
  volumeSeries: ChartSeriesLike<VolumeDatum>;
  timeScale: ChartTimeScaleLike;
};

export type TokenTradeChartRenderState = {
  points: ChartSeriesPoint[];
  candles: Candle[];
  ma20: MovingAveragePoint[];
  ma50: MovingAveragePoint[];
  timeframe: ChartTimeframe | null;
  resolvedInterval: CandleInterval | null;
  hasRenderedOnce: boolean;
};

export function createInitialTokenTradeChartRenderState(): TokenTradeChartRenderState {
  return { points: [], candles: [], ma20: [], ma50: [], timeframe: null, resolvedInterval: null, hasRenderedOnce: false };
}

const MA20_PERIOD = 20;
const MA50_PERIOD = 50;

export type ApplyTokenTradeChartUpdateInput = {
  trades: TokenTrade[];
  decimals: number;
  interval: CandleInterval;
  timeframe: ChartTimeframe;
  nowUnixSeconds: number;
  startingPriceNativePerToken: number | null;
  launchedAtUnixSeconds: number | null;
};

/**
 * Rebuckets `trades` and applies the minimal set of series calls needed to
 * bring `series` up to date from `previousState`, returning the new state to
 * persist for the next call. `series.setData()` (which resets the visible
 * range) only ever runs on the very first call or a timeframe/resolved-
 * interval change; every other call diffs the freshly-rebucketed candles/
 * MAs/whitespace-inclusive timeline against `previousState` and calls
 * `series.update()` for just the mutated last bar and any newly appended
 * ones. A trade landing in a bucket the whitespace timeline's own clock has
 * already advanced past would make that bucket's `update()` target no
 * longer the last rendered bar — lightweight-charts throws "Cannot update
 * oldest data" for that — so an out-of-order pre-check, and a try/catch
 * around the incremental path for anything the pre-check doesn't anticipate,
 * both fall back to a full `setData()` that reads and restores the visible
 * logical range so the user's scroll position doesn't jump.
 */
export function applyTokenTradeChartUpdate(
  series: TokenTradeChartSeriesBundle,
  previousState: TokenTradeChartRenderState,
  input: ApplyTokenTradeChartUpdateInput,
): TokenTradeChartRenderState {
  const { trades, decimals, interval, timeframe, nowUnixSeconds, startingPriceNativePerToken, launchedAtUnixSeconds } = input;

  const candles = bucketTradesIntoCandles(trades, interval, decimals, startingPriceNativePerToken ?? undefined);
  const ma20 = computeMovingAverage(candles, MA20_PERIOD);
  const ma50 = computeMovingAverage(candles, MA50_PERIOD);
  const points = buildChartSeriesPoints(candles, interval, nowUnixSeconds, launchedAtUnixSeconds);

  const isFirstLoadOrTimeframeChange =
    !previousState.hasRenderedOnce || previousState.timeframe !== timeframe || previousState.resolvedInterval !== interval;

  if (isFirstLoadOrTimeframeChange) {
    series.candleSeries.setData(points.map(pointToSeriesDatum));
    series.ma20Series.setData(ma20.map((point) => ({ time: point.time, value: point.value })));
    series.ma50Series.setData(ma50.map((point) => ({ time: point.time, value: point.value })));
    series.volumeSeries.setData(candles.map((candle) => ({ time: candle.time, value: candle.volume, color: volumeBarColor(candle) })));
    series.timeScale.scrollToRealTime();
  } else {
    const pointsDiff = diffChartSeriesPoints(previousState.points, points);
    const candleDiff = diffCandles(previousState.candles, candles);
    const ma20Diff = diffTimeSeries(previousState.ma20, ma20, (a, b) => a.value === b.value);
    const ma50Diff = diffTimeSeries(previousState.ma50, ma50, (a, b) => a.value === b.value);

    const lastRenderedTime = previousState.points.length > 0 ? previousState.points[previousState.points.length - 1].time : null;
    const hasOutOfOrderUpdate = lastRenderedTime !== null && pointsDiff.updated.some((point) => point.time < lastRenderedTime);

    let needsFullResync = hasOutOfOrderUpdate;
    if (!needsFullResync) {
      try {
        for (const point of [...pointsDiff.updated, ...pointsDiff.appended]) series.candleSeries.update(pointToSeriesDatum(point));
        for (const candle of [...candleDiff.updated, ...candleDiff.appended]) {
          series.volumeSeries.update({ time: candle.time, value: candle.volume, color: volumeBarColor(candle) });
        }
        for (const point of [...ma20Diff.updated, ...ma20Diff.appended]) series.ma20Series.update({ time: point.time, value: point.value });
        for (const point of [...ma50Diff.updated, ...ma50Diff.appended]) series.ma50Series.update({ time: point.time, value: point.value });
      } catch {
        needsFullResync = true;
      }
    }

    if (needsFullResync) {
      const visibleLogicalRange = series.timeScale.getVisibleLogicalRange();
      series.candleSeries.setData(points.map(pointToSeriesDatum));
      series.ma20Series.setData(ma20.map((point) => ({ time: point.time, value: point.value })));
      series.ma50Series.setData(ma50.map((point) => ({ time: point.time, value: point.value })));
      series.volumeSeries.setData(candles.map((candle) => ({ time: candle.time, value: candle.volume, color: volumeBarColor(candle) })));
      if (visibleLogicalRange) series.timeScale.setVisibleLogicalRange(visibleLogicalRange);
    }
  }

  return { points, candles, ma20, ma50, timeframe, resolvedInterval: interval, hasRenderedOnce: true };
}
