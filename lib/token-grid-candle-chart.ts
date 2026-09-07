import { bucketTradesIntoCandles } from "@/lib/candle-bucketing";
import { DEFAULT_TOKEN_DECIMALS } from "@/lib/bonding-curve-deploy-config";
import type { TokenTrade } from "@/lib/token-trade-types";

/**
 * Pure mini-candlestick geometry for the homepage grid card (owner
 * direction, 7 Sep 2026: "I want candle stick just like [the flagship
 * chart], thin slim, smaller, going in each panel like pump fun … make sure
 * glow so it can be seen on top of all content" — replacing the single
 * performance line issue #440/#489 drew instead). Fixed 5-minute buckets
 * (owner instruction, not an auto-picked interval) via the same
 * `bucketTradesIntoCandles` the full token-page chart uses, so a mini card
 * and the real chart can never disagree about where a candle's open/close
 * sits. Dependency-free like `lib/candle-bucketing.ts` itself — still no
 * chart-library instance per card (a dozen-plus on one page stays
 * unacceptable), only plain SVG geometry the component draws by hand.
 */

export const GRID_CANDLE_CHART_WIDTH = 100;
export const GRID_CANDLE_CHART_HEIGHT = 40;
/** How many of the most recent 5-minute candles a card shows — enough to read a trend, never a wall of hairlines. */
export const MAX_GRID_CANDLES = 20;
/** Thin/slim (owner's own word): each candle's body is well under half its slot, leaving most of the slot as gap. */
const BODY_WIDTH_RATIO = 0.42;
const MIN_BODY_HEIGHT = 1;

// Same literal values as the shared premium theme's --accent-lime /
// --accent-down (app/hoodlums-premium-theme.css) — the settled up/down
// ruling (lime up, the design's grey down, never red) applies here exactly
// as it does on the token page's own real chart.
export const GRID_CANDLE_UP_COLOR = "#c6f53e";
export const GRID_CANDLE_DOWN_COLOR = "#8d918c";

export type GridCandleTone = "up" | "down";

export type GridCandleBar = {
  /** Left edge of the candle body rect. */
  x: number;
  bodyWidth: number;
  /** Horizontal centre of the wick line. */
  wickX: number;
  wickTop: number;
  wickBottom: number;
  bodyTop: number;
  bodyHeight: number;
  tone: GridCandleTone;
  color: string;
};

export type GridCandleChartResult = {
  bars: GridCandleBar[];
  /** False for zero trades — the caller renders nothing over the art, not a flat line or empty box. */
  hasData: boolean;
  /** The latest candle's close (native currency per whole token), or null with no priced trades. */
  lastPrice: number | null;
  /** Percent change from the first shown candle's open to the last one's close, or null with fewer than one real candle. */
  changePercent: number | null;
};

/**
 * Builds candlestick bar geometry from a token's raw trades, fixed to
 * 5-minute buckets and scaled into a `width` x `height` viewBox (default
 * GRID_CANDLE_CHART_WIDTH/HEIGHT). Only the most recent `MAX_GRID_CANDLES`
 * buckets are kept, so a token that has traded for days still renders as a
 * small, legible handful of candles. Zero trades returns `hasData: false`
 * with no bars; an all-equal price range degrades to a midline of flat
 * (minimum-height) candles rather than dividing by zero.
 *
 * Owner bug report, 7 Sep 2026 (real production cards, not the uniform mocks
 * this was first checked against): candles came out "different sizes …
 * covering half images". Root cause — each card had previously divided the
 * fixed viewBox width by ITS OWN `candles.length`, so a quiet token with two
 * or three 5-minute buckets got a couple of enormous bars while an active one
 * got many thin ones. Every slot is now a FIXED width
 * (`GRID_CANDLE_CHART_WIDTH / MAX_GRID_CANDLES`), so a candle body is the
 * same absolute size on every card regardless of how many buckets that
 * specific token happens to have; a token with fewer than the max is
 * right-aligned (most recent candle flush to the right edge, same convention
 * as every real trading chart) rather than stretched to fill the width, with
 * blank space to the left standing in for the history it doesn't have yet.
 */
export function buildGridCandleChart(
  trades: TokenTrade[],
  options: { width?: number; height?: number } = {},
): GridCandleChartResult {
  const width = options.width ?? GRID_CANDLE_CHART_WIDTH;
  const height = options.height ?? GRID_CANDLE_CHART_HEIGHT;
  const slotWidth = width / MAX_GRID_CANDLES;

  const allCandles = bucketTradesIntoCandles(trades, "5m", DEFAULT_TOKEN_DECIMALS);
  const candles = allCandles.slice(-MAX_GRID_CANDLES);

  if (candles.length === 0) {
    return { bars: [], hasData: false, lastPrice: null, changePercent: null };
  }

  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const range = max - min;

  const bodyWidth = Math.max(slotWidth * BODY_WIDTH_RATIO, 1);
  // Right-align: the newest candle always sits in the rightmost slot, so a
  // token with fewer than MAX_GRID_CANDLES leaves blank slots on the left
  // instead of stretching its handful of candles across the full width.
  const leadingEmptySlots = MAX_GRID_CANDLES - candles.length;

  function scaleY(price: number): number {
    if (range === 0) return height / 2;
    return height - ((price - min) / range) * height;
  }

  const bars: GridCandleBar[] = candles.map((candle, index) => {
    const slotIndex = leadingEmptySlots + index;
    const centerX = slotIndex * slotWidth + slotWidth / 2;
    const openY = scaleY(candle.open);
    const closeY = scaleY(candle.close);
    const tone: GridCandleTone = candle.close >= candle.open ? "up" : "down";
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
      tone,
      color: tone === "up" ? GRID_CANDLE_UP_COLOR : GRID_CANDLE_DOWN_COLOR,
    };
  });

  const firstOpen = candles[0].open;
  const lastClose = candles[candles.length - 1].close;
  const changePercent = firstOpen > 0 ? ((lastClose - firstOpen) / firstOpen) * 100 : null;

  return { bars, hasData: true, lastPrice: lastClose, changePercent };
}
