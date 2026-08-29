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
