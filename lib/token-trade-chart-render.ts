import {
  bucketTradesIntoCandles,
  buildChartSeriesPoints,
  CHART_BAR_SPACING_PX,
  computeMovingAverage,
  diffCandles,
  diffTimeSeries,
  type Candle,
  type CandleInterval,
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
// last bar that carries *series data* and ignore trailing whitespace bars —
// but `buildChartSeriesPoints` deliberately extends the timeline with a
// candle (flat-filled where there's no trade, issue #470 addendum — formerly
// bare whitespace) all the way to the current bucket, so on a token with a
// long trade-free tail those built-ins left the view scrolled to the last
// real candle while every later bar (and the axis' reach to "now") sat
// off-screen to the right, making the chart look permanently frozen.
// `computeInitialVisibleLogicalRange` positions on the LAST timeline point
// (a real candle or the current-time flat bar) instead, and the
// incremental-update branch below tracks whether the viewer is "at the right
// edge" and, if so, shifts the range by exactly the number of newly appended
// points on every update — following the clock — while leaving the range
// untouched the moment the viewer has scrolled left.

export type ChartBar = { time: number; open: number; high: number; low: number; close: number; color?: string; wickColor?: string };
type VolumeDatum = { time: number; value: number; color: string };
type LinePoint = { time: number; value: number };

/** The design's flat-candle colour (#6f746e) at 60% opacity — a "no trade" bucket reads as neutral, never up or down (issue #470 addendum). */
const FLAT_CANDLE_COLOR = "rgba(111, 116, 110, 0.6)";
/** Fully transparent — the volume pane shows nothing for a flat (zero-volume) bucket (issue #470 addendum). */
const FLAT_VOLUME_COLOR = "rgba(111, 116, 110, 0)";

/** Converts a candle (real or flat-filled) into what the candlestick series expects, applying the flat-candle colour override only when `isFlat` — a real candle carries no per-bar override at all, so it renders via the series' own default up/down colours. */
export function candleToBar(candle: Candle): ChartBar {
  const bar: ChartBar = { time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close };
  if (candle.isFlat) {
    bar.color = FLAT_CANDLE_COLOR;
    bar.wickColor = FLAT_CANDLE_COLOR;
  }
  return bar;
}

export function volumeBarColor(candle: Candle): string {
  if (candle.isFlat) return FLAT_VOLUME_COLOR;
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
  candleSeries: ChartSeriesLike<ChartBar>;
  ma20Series: ChartSeriesLike<LinePoint>;
  ma50Series: ChartSeriesLike<LinePoint>;
  volumeSeries: ChartSeriesLike<VolumeDatum>;
  timeScale: ChartTimeScaleLike;
};

export type TokenTradeChartRenderState = {
  /** The flat-filled, gap-free timeline (issue #470 addendum) — every entry is a real Candle, real or flat-filled; this single array now drives the candlestick series, the volume series and both moving averages, since a flat bucket is a real bar for all three. */
  points: Candle[];
  ma20: MovingAveragePoint[];
  ma50: MovingAveragePoint[];
  timeframe: ChartTimeframe | null;
  resolvedInterval: CandleInterval | null;
  hasRenderedOnce: boolean;
};

export function createInitialTokenTradeChartRenderState(): TokenTradeChartRenderState {
  return { points: [], ma20: [], ma50: [], timeframe: null, resolvedInterval: null, hasRenderedOnce: false };
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
  /** The chart's real container width in pixels (issue #467 item 1) — the same value the component's guarded ResizeObserver tracks. Drives how many bars the initial/positioned range shows; never affects bar width itself. */
  chartWidthPx: number;
};

/**
 * Rebuckets `trades` and applies the minimal set of series calls needed to
 * bring `series` up to date from `previousState`, returning the new state to
 * persist for the next call. `series.setData()` (which resets the visible
 * range) only ever runs on the very first call or a timeframe/resolved-
 * interval change; every other call diffs the freshly-rebucketed, flat-filled
 * timeline (`points` — issue #470 addendum: every bucket is a real candle,
 * flat-filled where there's no trade) against `previousState` and calls
 * `series.update()` for just the mutated last bar and any newly appended
 * ones — including a trade converting a flat bucket into a real one in the
 * same slot/time, exactly like the old whitespace-to-candle transition. A
 * trade landing in a bucket the timeline's own clock has already advanced
 * past would make that bucket's `update()` target no longer the last
 * rendered bar — lightweight-charts throws "Cannot update oldest data" for
 * that — so an out-of-order pre-check, and a try/catch around the
 * incremental path for anything the pre-check doesn't anticipate, both fall
 * back to a full `setData()` that reads and restores the visible logical
 * range so the user's scroll position doesn't jump.
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
  const points = buildChartSeriesPoints(candles, interval, nowUnixSeconds, launchedAtUnixSeconds, startingPriceNativePerToken, chartWidthPx);
  const ma20 = computeMovingAverage(points, MA20_PERIOD);
  const ma50 = computeMovingAverage(points, MA50_PERIOD);

  const isFirstLoadOrTimeframeChange =
    !previousState.hasRenderedOnce || previousState.timeframe !== timeframe || previousState.resolvedInterval !== interval;

  if (isFirstLoadOrTimeframeChange) {
    series.candleSeries.setData(points.map(candleToBar));
    series.ma20Series.setData(ma20.map((point) => ({ time: point.time, value: point.value })));
    series.ma50Series.setData(ma50.map((point) => ({ time: point.time, value: point.value })));
    series.volumeSeries.setData(points.map((point) => ({ time: point.time, value: point.volume, color: volumeBarColor(point) })));
    const lastPointIndex = points.length - 1;
    if (lastPointIndex >= 0) {
      series.timeScale.setVisibleLogicalRange(computeInitialVisibleLogicalRange(lastPointIndex, chartWidthPx));
    }
  } else {
    const pointsDiff = diffCandles(previousState.points, points);
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
        for (const point of [...pointsDiff.updated, ...pointsDiff.appended]) {
          series.candleSeries.update(candleToBar(point));
          series.volumeSeries.update({ time: point.time, value: point.volume, color: volumeBarColor(point) });
        }
        for (const point of [...ma20Diff.updated, ...ma20Diff.appended]) series.ma20Series.update({ time: point.time, value: point.value });
        for (const point of [...ma50Diff.updated, ...ma50Diff.appended]) series.ma50Series.update({ time: point.time, value: point.value });
      } catch {
        needsFullResync = true;
      }
    }

    if (needsFullResync) {
      series.candleSeries.setData(points.map(candleToBar));
      series.ma20Series.setData(ma20.map((point) => ({ time: point.time, value: point.value })));
      series.ma50Series.setData(ma50.map((point) => ({ time: point.time, value: point.value })));
      series.volumeSeries.setData(points.map((point) => ({ time: point.time, value: point.volume, color: volumeBarColor(point) })));
      if (rangeBeforeUpdate) series.timeScale.setVisibleLogicalRange(rangeBeforeUpdate);
    }

    if (wasAtRightEdge && appendedCount > 0 && rangeBeforeUpdate) {
      series.timeScale.setVisibleLogicalRange({
        from: rangeBeforeUpdate.from + appendedCount,
        to: rangeBeforeUpdate.to + appendedCount,
      });
    }
  }

  return { points, ma20, ma50, timeframe, resolvedInterval: interval, hasRenderedOnce: true };
}
