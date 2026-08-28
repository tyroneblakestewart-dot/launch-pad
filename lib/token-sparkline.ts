import { tradePriceNativePerToken } from "@/lib/candle-bucketing";
import { DEFAULT_TOKEN_DECIMALS } from "@/lib/bonding-curve-deploy-config";
import type { TokenTrade } from "@/lib/token-trade-types";

// Pure sparkline path-generation for the homepage token grid's mini/expanded
// price charts (issue #436), dependency-free like lib/candle-bucketing.ts so
// it's unit-testable without a network call or a DOM/canvas renderer. Trade
// decimals are assumed to be DEFAULT_TOKEN_DECIMALS for every card rather
// than read per-token (which would mean an extra RPC call per card, against
// this issue's "don't hammer the RPC" requirement and its no-server-changes
// boundary): a wrong decimals assumption only rescales every price for a
// given token by the same constant factor, which normalisation below cancels
// out, so the sparkline's shape and trend are unaffected either way.

export type SparklineTrend = "up" | "down" | "flat";

export type SparklineResult = {
  /** SVG path `d` for the line stroke. Always defined, even with no data (a flat baseline). */
  linePath: string;
  /** SVG path `d` for the soft area fill beneath the line. */
  areaPath: string;
  trend: SparklineTrend;
  /** False when there weren't at least two validly-priced trades to draw a real line from. */
  hasData: boolean;
  /** Percent change from the first to the last plotted price, or null with fewer than two points. */
  changePercent: number | null;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
};

export const SPARKLINE_WIDTH = 100;
export const SPARKLINE_HEIGHT = 32;
const DEFAULT_PADDING_Y = 3;

export const SPARKLINE_UP_COLOR = "#91f0b6";
export const SPARKLINE_DOWN_COLOR = "#ff5f56";
export const SPARKLINE_FLAT_COLOR = "#566054";

export function sparklineColor(trend: SparklineTrend): string {
  if (trend === "up") return SPARKLINE_UP_COLOR;
  if (trend === "down") return SPARKLINE_DOWN_COLOR;
  return SPARKLINE_FLAT_COLOR;
}

function flatResult(timestamp: number | null, width: number, height: number): SparklineResult {
  const baselineY = height / 2;
  return {
    linePath: `M0,${baselineY} L${width},${baselineY}`,
    areaPath: `M0,${baselineY} L${width},${baselineY} L${width},${height} L0,${height} Z`,
    trend: "flat",
    hasData: false,
    changePercent: null,
    firstTimestamp: timestamp,
    lastTimestamp: timestamp,
  };
}

/**
 * Builds a sparkline (line + soft area path) from a token's raw trades.
 * Zero trades, or a single trade, both fall back to a flat baseline rather
 * than an error or an empty box (issue #436 requirement 1) — a single price
 * point has no direction to plot. Points are spaced evenly along the x-axis
 * rather than time-proportionally: this is a minimal-ink trend indicator,
 * not a time-accurate axis (no axes/gridlines are drawn at all), so even
 * spacing is a deliberately simpler and equally honest choice.
 */
export function buildSparkline(
  trades: TokenTrade[],
  options: { width?: number; height?: number; paddingY?: number } = {},
): SparklineResult {
  const width = options.width ?? SPARKLINE_WIDTH;
  const height = options.height ?? SPARKLINE_HEIGHT;
  const paddingY = options.paddingY ?? DEFAULT_PADDING_Y;

  const sorted = [...trades].sort((a, b) => a.blockTimestamp - b.blockTimestamp || a.logIndex - b.logIndex);
  const priced = sorted
    .map((trade) => ({
      price: tradePriceNativePerToken(trade, DEFAULT_TOKEN_DECIMALS),
      timestamp: trade.blockTimestamp,
    }))
    .filter((point) => point.price > 0);

  if (priced.length < 2) {
    return flatResult(priced[0]?.timestamp ?? null, width, height);
  }

  const prices = priced.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  const usableHeight = height - paddingY * 2;
  const baselineY = height / 2;
  const stepX = width / (priced.length - 1);

  const points = priced.map((point, index) => ({
    x: index * stepX,
    y: range === 0 ? baselineY : paddingY + (1 - (point.price - min) / range) * usableHeight,
  }));

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  const first = priced[0].price;
  const last = priced[priced.length - 1].price;
  const changePercent = first > 0 ? ((last - first) / first) * 100 : null;
  const trend: SparklineTrend = last > first ? "up" : last < first ? "down" : "flat";

  return {
    linePath,
    areaPath,
    trend,
    hasData: true,
    changePercent,
    firstTimestamp: priced[0].timestamp,
    lastTimestamp: priced[priced.length - 1].timestamp,
  };
}
