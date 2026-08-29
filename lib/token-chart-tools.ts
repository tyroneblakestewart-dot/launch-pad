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
