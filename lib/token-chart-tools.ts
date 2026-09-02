import { CANDLE_INTERVAL_SECONDS, type CandleInterval } from "@/lib/candle-bucketing";

// Pure client-side state for the token chart's drawing-tool rail (issue
// #445): crosshair (default) and a removable horizontal price line. Kept
// dependency-free of lightweight-charts and the chart component itself, per
// the data inventory's own note that these two tools are client-side state
// only with no backend data, so the add/remove logic is unit-testable
// without a chart instance.

export type ChartTool = "crosshair" | "horizontal-line";

export type HorizontalLine = { id: string; price: number };

export function addHorizontalLine(lines: HorizontalLine[], price: number, id: string): HorizontalLine[] {
  return [...lines, { id, price }];
}

export function removeHorizontalLine(lines: HorizontalLine[], id: string): HorizontalLine[] {
  return lines.filter((line) => line.id !== id);
}

/**
 * Expands a degenerate (zero-height) price range so the right price scale
 * always has room to draw more than the single last-price tag (issue #447
 * item 4). Percentage-based `scaleMargins` alone can't fix this: a margin is
 * a percentage of the price range, and a percentage of zero is still zero —
 * exactly the case for a single candle, or any window whose visible bars
 * all share one price. Once there are two or more distinct prices the range
 * is already non-zero and is returned untouched, so this only ever affects
 * the genuinely-flat case, never the normal multi-price chart.
 */
export function expandDegeneratePriceRange(minValue: number, maxValue: number): { minValue: number; maxValue: number } {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue !== maxValue) {
    return { minValue, maxValue };
  }
  const padding = minValue === 0 ? 0.000001 : Math.abs(minValue) * 0.05;
  return { minValue: minValue - padding, maxValue: maxValue + padding };
}

/** Floor for computeChartMinMove — never zero/subnormal regardless of how small maxPrice is. */
const MIN_MOVE_FLOOR = 1e-18;

/**
 * Derives the candlestick series' `priceFormat.minMove` from the data itself
 * (issue #451 item 1). lightweight-charts can only place axis tick labels at
 * multiples of `minMove`, so a fixed value far below the actual price
 * magnitude (this chart previously hardcoded 1e-8 against real testnet
 * prices around 1e-9) leaves no tick multiple inside the visible price
 * range and the axis draws no labels at all — only the last-price tag. Six
 * significant figures below the largest visible price keeps ticks legible
 * at any magnitude: `10^(floor(log10(maxPrice)) - 6)`, floored at
 * `MIN_MOVE_FLOOR` so it's never zero/subnormal.
 */
export function computeChartMinMove(maxPrice: number): number {
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) return MIN_MOVE_FLOOR;
  const exponent = Math.floor(Math.log10(maxPrice));
  return Math.max(MIN_MOVE_FLOOR, 10 ** (exponent - 6));
}

/**
 * Derives the fixed decimal count every chart price display should render
 * at — axis labels, the crosshair label, the OHLC tooltip and the
 * last-price tag (issue #464 item 2) — from the exact same `minMove`
 * `computeChartMinMove` derives: `decimals = -log10(minMove)`. Formatting
 * relative to the chart's own price magnitude, rather than each individual
 * value's own significant figures, is what keeps a near-zero crosshair
 * position (e.g. `3.3e-26` on a chart whose prices sit around `6e-8`) from
 * rendering two dozen digits — a value below one `minMove` simply rounds to
 * zero at this precision instead. `minMove` is always an exact power of ten
 * (or `MIN_MOVE_FLOOR` itself), so `Math.round` only ever cleans up
 * floating-point log noise, never masks a genuine fractional decimal count.
 */
export function computeChartPriceDecimals(minMove: number): number {
  if (!Number.isFinite(minMove) || minMove <= 0) return 6;
  return Math.max(0, Math.round(-Math.log10(minMove)));
}

/** The current-bucket clock's own tick cap — coarser intervals never need to redraw the still-open bar faster than this (issue #470 item 3). */
const MAX_CHART_TICK_SECONDS = 30;

/**
 * The current-bucket clock's tick interval in milliseconds: `min(interval
 * seconds, 30)` — 1s on 1S, 15s on 15S, 30s from 1M up (issue #470 item 3),
 * so a sub-minute timeframe's still-open bar advances roughly once per real
 * bucket instead of lagging up to 30s behind it. `null` (interval not yet
 * resolved, e.g. trades still loading) keeps the previous fixed 30s cadence.
 */
export function chartTickIntervalMs(interval: CandleInterval | null): number {
  const seconds = interval ? CANDLE_INTERVAL_SECONDS[interval] : MAX_CHART_TICK_SECONDS;
  return Math.min(seconds, MAX_CHART_TICK_SECONDS) * 1000;
}

/** Whether the chart's time axis, crosshair and tooltip should render seconds for this interval — 1S/15S only (issue #470 item 4); everywhere else stays HH:MM. */
export function chartIntervalShowsSeconds(interval: CandleInterval | null): boolean {
  return interval === "1s" || interval === "15s";
}
