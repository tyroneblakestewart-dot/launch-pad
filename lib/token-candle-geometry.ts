import {
  bucketTradesIntoCandles,
  CANDLE_INTERVALS,
  CANDLE_INTERVAL_SECONDS,
  type CandleInterval,
} from "@/lib/candle-bucketing";
import { DEFAULT_TOKEN_DECIMALS } from "@/lib/bonding-curve-deploy-config";
import { SPARKLINE_DOWN_COLOR, SPARKLINE_UP_COLOR } from "@/lib/token-sparkline";
import type { TokenTrade } from "@/lib/token-trade-types";

// Pure mini-candlestick geometry for the homepage grid card redesign (issue
// #440), dependency-free like lib/token-sparkline.ts and
// lib/candle-bucketing.ts so it's unit-testable without a network call, a
// DOM/canvas renderer, or a chart-library instance — the issue is explicit
// that instantiating lightweight-charts per grid card (24 instances on one
// page) is not acceptable. Reuses lib/candle-bucketing.ts's own
// bucketTradesIntoCandles rather than re-deriving OHLC from trades a second
// way, and reuses lib/token-sparkline.ts's up/down colours so the mini
// candles, the floating preview's bigger candles, and the sparkline-era
// up/down labels all agree on the same green/red.

export const CANDLE_CHART_WIDTH = 100;
export const CANDLE_CHART_HEIGHT = 40;
const MAX_CANDLES = 20;
const BODY_GAP_RATIO = 0.3;
const MIN_BODY_HEIGHT = 1;

export type CandleBar = {
  /** Left edge of the candle body rect. */
  x: number;
  bodyWidth: number;
  /** Horizontal centre of the wick line. */
  wickX: number;
  wickTop: number;
  wickBottom: number;
  bodyTop: number;
  bodyHeight: number;
  color: string;
};

export type CandleGeometryResult = {
  bars: CandleBar[];
  /** False for zero trades — the caller renders nothing over the art, not a flat line or empty box. */
  hasData: boolean;
  /** The latest trade's price (native currency per whole token), or null with no priced trades. */
  lastPrice: number | null;
};

/**
 * Picks the coarsest-necessary bucketing interval so a token with a long
 * trading history still renders as a small, legible handful of candles
 * instead of hundreds of hairline bars. Starts from the finest interval and
 * only widens it while doing so would still keep the bucket count under
 * MAX_CANDLES; a token trading in bursts across a huge span simply gets the
 * coarsest available interval rather than an unbounded bar count.
 */
function pickInterval(trades: TokenTrade[]): CandleInterval {
  if (trades.length === 0) return CANDLE_INTERVALS[0];
  const timestamps = trades.map((trade) => trade.blockTimestamp);
  const span = Math.max(...timestamps) - Math.min(...timestamps);

  for (const interval of CANDLE_INTERVALS) {
    const bucketCount = Math.floor(span / CANDLE_INTERVAL_SECONDS[interval]) + 1;
    if (bucketCount <= MAX_CANDLES) return interval;
  }
  return CANDLE_INTERVALS[CANDLE_INTERVALS.length - 1];
}

/**
 * Builds candlestick bar geometry from a token's raw trades, scaled into a
 * `width` x `height` viewBox (default matching CANDLE_CHART_WIDTH/HEIGHT).
 * Zero trades returns `hasData: false` with no bars — the caller must render
 * nothing over the art for that case, never a placeholder box. An all-equal
 * price range degrades to a horizontal midline of flat (minimum-height)
 * candles rather than dividing by zero.
 */
export function buildCandleGeometry(
  trades: TokenTrade[],
  options: { width?: number; height?: number } = {},
): CandleGeometryResult {
  const width = options.width ?? CANDLE_CHART_WIDTH;
  const height = options.height ?? CANDLE_CHART_HEIGHT;

  const interval = pickInterval(trades);
  const candles = bucketTradesIntoCandles(trades, interval, DEFAULT_TOKEN_DECIMALS);

  if (candles.length === 0) {
    return { bars: [], hasData: false, lastPrice: null };
  }

  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const range = max - min;

  const slotWidth = width / candles.length;
  const bodyWidth = Math.max(slotWidth * (1 - BODY_GAP_RATIO), 1);

  function scaleY(price: number): number {
    if (range === 0) return height / 2;
    return height - ((price - min) / range) * height;
  }

  const bars: CandleBar[] = candles.map((candle, index) => {
    const centerX = index * slotWidth + slotWidth / 2;
    const openY = scaleY(candle.open);
    const closeY = scaleY(candle.close);
    const isUp = candle.close >= candle.open;
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(Math.abs(closeY - openY), MIN_BODY_HEIGHT);

    return {
      x: centerX - bodyWidth / 2,
      bodyWidth,
      wickX: centerX,
      wickTop: scaleY(candle.high),
      wickBottom: scaleY(candle.low),
      bodyTop,
      bodyHeight,
      color: isUp ? SPARKLINE_UP_COLOR : SPARKLINE_DOWN_COLOR,
    };
  });

  return { bars, hasData: true, lastPrice: candles[candles.length - 1].close };
}
