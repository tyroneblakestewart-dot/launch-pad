import {
  bucketTradesIntoCandles,
  buildChartSeriesPoints,
  CHART_BAR_SPACING_PX,
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
//
// Positioning is now owned entirely by this file (issue #467 items 1-2),
// replacing the old `scrollToRealTime` call. Both that lightweight-charts
// built-in and the chart's own `shiftVisibleRangeOnNewBar` option act on the
// last bar that carries *series data* and ignore trailing whitespace bars — but
// `buildChartSeriesPoints` deliberately extends the timeline with whitespace
// all the way to the current bucket, so on a token with a long trade-free
// tail those built-ins left the view scrolled to the last real candle while
// every later whitespace bar (and the axis' reach to "now") sat off-screen
// to the right, making the chart look permanently frozen. `computeInitial
// VisibleLogicalRange` positions on the LAST timeline point (a real candle or
// the current-time whitespace bar) instead, and the incremental-update branch
// below tracks whether the viewer is "at the right edge" and, if so, shifts
// the range by exactly the number of newly appended points on every update —
// following the clock — while leaving the range untouched the moment the
// viewer has scrolled left.

type ChartBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  color?: string;
  borderColor?: string;
  wickColor?: string;
};
type ChartSeriesDatum = ChartBar | { time: number };
type VolumeDatum = { time: number; value: number; color: string };
type LinePoint = { time: number; value: number };

/** #8d918c @ 85% opacity — deliberately brighter than the chart's own #6f746e axis/label ink, which is what made a flat candle's zero-height body read as empty space under the lime last-price line (issue #472 item 1). */
export const FLAT_CANDLE_COLOR = "rgba(141, 145, 140, 0.85)";

const FLAT_CANDLE_MIN_BODY_HEIGHT_RATIO = 0.0015;
/** Matches expandDegeneratePriceRange's own ±5% convention (lib/token-chart-tools.ts) for the one case both functions share: every candle in view sits at the exact same price, so there is no real span to take a fraction of. */
const FLAT_CANDLE_DEGENERATE_PRICE_RATIO = 0.05;

/** A flat candle: no trade within the bucket moved the price away from the carried-forward open, so open/high/low/close all collapse to one value — a real candlestick series draws this as a bare 1px line, not a body. */
export function isFlatCandle(candle: Pick<Candle, "open" | "high" | "low" | "close">): boolean {
  return candle.open === candle.high && candle.high === candle.low && candle.low === candle.close;
}

/**
 * The minimum price-space body height a flat candle is stretched to so it
 * renders as a visible body instead of a bare wick line (issue #472 item 1).
 * lightweight-charts has no "minimum pixel body height" option for a
 * candlestick series, so this approximates the requested ~2px minimum in
 * price space instead: a small fraction of the full high/low span across
 * every candle currently rendered, which scales with the chart's own zoom
 * and price magnitude without a real chart instance to measure actual
 * pixels against. Falls back to a percentage of the flat price itself
 * (mirroring expandDegeneratePriceRange) only when every rendered candle
 * shares the exact same price, so that span is itself zero.
 */
export function computeFlatCandleMinBodyHeight(candles: readonly Candle[], flatPrice: number): number {
  const span = candles.length > 0 ? Math.max(...candles.map((candle) => candle.high)) - Math.min(...candles.map((candle) => candle.low)) : 0;
  if (span > 0) return span * FLAT_CANDLE_MIN_BODY_HEIGHT_RATIO;
  return flatPrice > 0 ? flatPrice * FLAT_CANDLE_DEGENERATE_PRICE_RATIO : FLAT_CANDLE_DEGENERATE_PRICE_RATIO;
}

export function candleToBar(candle: Candle, minBodyHeight: number): ChartBar {
  if (!isFlatCandle(candle)) {
    return { time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close };
  }
  const halfHeight = minBodyHeight / 2;
  return {
    time: candle.time,
    open: candle.close - halfHeight,
    high: candle.close + halfHeight,
    low: candle.close - halfHeight,
    close: candle.close + halfHeight,
    color: FLAT_CANDLE_COLOR,
    borderColor: FLAT_CANDLE_COLOR,
    wickColor: FLAT_CANDLE_COLOR,
  };
}

/** Converts a whitespace-inclusive timeline point to what the candlestick series expects: an OHLC bar (flat-stretched per computeFlatCandleMinBodyHeight when needed), or a bare-time WhitespaceData point. */
export function pointToSeriesDatum(point: ChartSeriesPoint, minBodyHeight: number): ChartSeriesDatum {
  return isCandlePoint(point) ? candleToBar(point, minBodyHeight) : { time: point.time };
}

export function volumeBarColor(candle: Candle): string {
  return candle.close >= candle.open ? "rgba(198, 245, 62, 0.35)" : "rgba(141, 145, 140, 0.35)";
}

/** Minimal duck-typed subset of lightweight-charts' `ISeriesApi` this engine drives. */
export type ChartSeriesLike<TDatum> = {
  setData(data: TDatum[]): void;
  update(datum: TDatum): void;
};

export type VisibleLogicalRange = { from: number; to: number };

export type ChartTimeScaleLike = {
  getVisibleLogicalRange(): VisibleLogicalRange | null;
  setVisibleLogicalRange(range: VisibleLogicalRange): void;
};

/** Matches the chart's own timeScale `rightOffset` option — empty bars reserved past the last timeline point. */
const CHART_RIGHT_OFFSET_BARS = 4;

/**
 * The visible logical range that puts `lastPointIndex` (the last entry of
 * the whitespace-inclusive timeline — a real candle or the still-open
 * current-time bar) at the right edge, sized from the chart's real container
 * width so it never stretches candles (issue #467 item 1).
 */
export function computeInitialVisibleLogicalRange(lastPointIndex: number, chartWidthPx: number): VisibleLogicalRange {
  const to = lastPointIndex + CHART_RIGHT_OFFSET_BARS;
  const visibleBars = Math.max(1, Math.floor(chartWidthPx / CHART_BAR_SPACING_PX));
  return { from: to - visibleBars, to };
}

/**
 * Whether the viewer is currently positioned at (or within one bar of) the
 * timeline's right edge — the only state in which "follow the clock" (issue
 * #467 item 2) applies. No range yet (a chart that hasn't been given one)
 * counts as at the edge, matching the initial-load state.
 */
export function isAtChartRightEdge(visibleRange: VisibleLogicalRange | null, lastPointIndex: number): boolean {
  if (!visibleRange) return true;
  return visibleRange.to >= lastPointIndex - 1;
}

/**
 * Re-derives the visible range from a new container width — called from the
 * component's own guarded ResizeObserver (issue #467 item 1), independent of
 * any data poll. Only takes effect while the viewer is at the right edge;
 * left alone the moment they've scrolled left, matching the follow rule
 * `applyTokenTradeChartUpdate` applies on every data update.
 */
export function applyChartResize(
  series: { timeScale: ChartTimeScaleLike },
  lastPointIndex: number,
  chartWidthPx: number,
): void {
  if (lastPointIndex < 0) return;
  const currentRange = series.timeScale.getVisibleLogicalRange();
  if (!isAtChartRightEdge(currentRange, lastPointIndex)) return;
  series.timeScale.setVisibleLogicalRange(computeInitialVisibleLogicalRange(lastPointIndex, chartWidthPx));
}

export type TokenTradeChartSeriesBundle = {
  candleSeries: ChartSeriesLike<ChartSeriesDatum>;
  ma20Series: ChartSeriesLike<LinePoint>;
  ma50Series: ChartSeriesLike<LinePoint>;
  volumeSeries: ChartSeriesLike<VolumeDatum>;
  timeScale: ChartTimeScaleLike;
};

/** Which branch the most recent applyTokenTradeChartUpdate call took (issue #472 item 2's debug readout) — "initial" is the very first render, "full-resync" covers both a timeframe/interval change and the out-of-order/crash fallback, "incremental" is the normal update()-only path. */
export type TokenTradeChartUpdateMode = "initial" | "incremental" | "full-resync";

export type TokenTradeChartRenderState = {
  points: ChartSeriesPoint[];
  candles: Candle[];
  ma20: MovingAveragePoint[];
  ma50: MovingAveragePoint[];
  timeframe: ChartTimeframe | null;
  resolvedInterval: CandleInterval | null;
  hasRenderedOnce: boolean;
  lastUpdateMode: TokenTradeChartUpdateMode | null;
};

export function createInitialTokenTradeChartRenderState(): TokenTradeChartRenderState {
  return {
    points: [],
    candles: [],
    ma20: [],
    ma50: [],
    timeframe: null,
    resolvedInterval: null,
    hasRenderedOnce: false,
    lastUpdateMode: null,
  };
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
  /** The chart's real container width in pixels (issue #467 item 1) — the same value the component's guarded ResizeObserver tracks. Drives how many bars the initial/positioned range shows (never bar width itself), and — on a sub-minute interval only (issue #470 item 2) — how far back buildChartSeriesPoints's timeline reaches. */
  chartWidthPx: number;
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
 *
 * Positioning (issue #467 items 1-2): the first-load/timeframe-change branch
 * sets an explicit width-derived range via `computeInitialVisibleLogicalRange`
 * instead of calling the old `scrollToRealTime` built-in (see the file's top doc comment for
 * why). The incremental branch reads the visible range once, up front, and
 * derives `wasAtRightEdge` from it — capturing "was the viewer following the
 * clock before this update" — then, after applying the update (whether via
 * the fast update() path or a full resync fallback that first restores that
 * same pre-update range, exactly as before), shifts the range by the number
 * of newly appended timeline points only if `wasAtRightEdge` was true. A
 * viewer who has scrolled left never has their range touched.
 */
export function applyTokenTradeChartUpdate(
  series: TokenTradeChartSeriesBundle,
  previousState: TokenTradeChartRenderState,
  input: ApplyTokenTradeChartUpdateInput,
): TokenTradeChartRenderState {
  const { trades, decimals, interval, timeframe, nowUnixSeconds, startingPriceNativePerToken, launchedAtUnixSeconds, chartWidthPx } =
    input;

  const candles = bucketTradesIntoCandles(trades, interval, decimals, startingPriceNativePerToken ?? undefined);
  const ma20 = computeMovingAverage(candles, MA20_PERIOD);
  const ma50 = computeMovingAverage(candles, MA50_PERIOD);
  const points = buildChartSeriesPoints(candles, interval, nowUnixSeconds, launchedAtUnixSeconds, chartWidthPx);
  const flatCandleMinBodyHeight = computeFlatCandleMinBodyHeight(
    candles,
    candles.length > 0 ? candles[candles.length - 1].close : startingPriceNativePerToken ?? 0,
  );
  const toSeriesDatum = (point: ChartSeriesPoint) => pointToSeriesDatum(point, flatCandleMinBodyHeight);

  const isFirstLoadOrTimeframeChange =
    !previousState.hasRenderedOnce || previousState.timeframe !== timeframe || previousState.resolvedInterval !== interval;
  let lastUpdateMode: TokenTradeChartUpdateMode = !previousState.hasRenderedOnce ? "initial" : "incremental";

  if (isFirstLoadOrTimeframeChange) {
    if (previousState.hasRenderedOnce) lastUpdateMode = "full-resync";
    series.candleSeries.setData(points.map(toSeriesDatum));
    series.ma20Series.setData(ma20.map((point) => ({ time: point.time, value: point.value })));
    series.ma50Series.setData(ma50.map((point) => ({ time: point.time, value: point.value })));
    series.volumeSeries.setData(candles.map((candle) => ({ time: candle.time, value: candle.volume, color: volumeBarColor(candle) })));
    const lastPointIndex = points.length - 1;
    if (lastPointIndex >= 0) {
      series.timeScale.setVisibleLogicalRange(computeInitialVisibleLogicalRange(lastPointIndex, chartWidthPx));
    }
  } else {
    const pointsDiff = diffChartSeriesPoints(previousState.points, points);
    const candleDiff = diffCandles(previousState.candles, candles);
    const ma20Diff = diffTimeSeries(previousState.ma20, ma20, (a, b) => a.value === b.value);
    const ma50Diff = diffTimeSeries(previousState.ma50, ma50, (a, b) => a.value === b.value);

    const previousLastIndex = previousState.points.length - 1;
    const rangeBeforeUpdate = series.timeScale.getVisibleLogicalRange();
    const wasAtRightEdge = isAtChartRightEdge(rangeBeforeUpdate, previousLastIndex);
    const appendedCount = pointsDiff.appended.length;

    const lastRenderedTime = previousState.points.length > 0 ? previousState.points[previousState.points.length - 1].time : null;
    const hasOutOfOrderUpdate = lastRenderedTime !== null && pointsDiff.updated.some((point) => point.time < lastRenderedTime);

    let needsFullResync = hasOutOfOrderUpdate;
    if (!needsFullResync) {
      try {
        for (const point of [...pointsDiff.updated, ...pointsDiff.appended]) series.candleSeries.update(toSeriesDatum(point));
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
      lastUpdateMode = "full-resync";
      series.candleSeries.setData(points.map(toSeriesDatum));
      series.ma20Series.setData(ma20.map((point) => ({ time: point.time, value: point.value })));
      series.ma50Series.setData(ma50.map((point) => ({ time: point.time, value: point.value })));
      series.volumeSeries.setData(candles.map((candle) => ({ time: candle.time, value: candle.volume, color: volumeBarColor(candle) })));
      if (rangeBeforeUpdate) series.timeScale.setVisibleLogicalRange(rangeBeforeUpdate);
    }

    if (wasAtRightEdge && appendedCount > 0 && rangeBeforeUpdate) {
      series.timeScale.setVisibleLogicalRange({
        from: rangeBeforeUpdate.from + appendedCount,
        to: rangeBeforeUpdate.to + appendedCount,
      });
    }
  }

  return { points, candles, ma20, ma50, timeframe, resolvedInterval: interval, hasRenderedOnce: true, lastUpdateMode };
}
