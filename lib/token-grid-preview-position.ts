// Pure viewport-clamping geometry for the homepage grid card's floating
// hover/focus preview (issue #440). Kept dependency-free and DOM-free (plain
// numbers in, plain numbers out) like lib/token-sparkline.ts and
// lib/candle-bucketing.ts so the left/right/top/bottom edge cases — a card in
// the grid's first or last column, or its last row — are unit-testable
// without a real browser layout. The caller measures the anchor `<a
// class="card">` and the viewport via getBoundingClientRect/window and passes
// plain numbers in; this never touches `window` or `document` itself.

export const PREVIEW_WIDTH = 300;
export const PREVIEW_HEIGHT = 220;
export const PREVIEW_VIEWPORT_MARGIN = 12;
const PREVIEW_ANCHOR_GAP = 8;

export type PreviewPositionInput = {
  anchorLeft: number;
  anchorTop: number;
  anchorWidth: number;
  anchorHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  previewWidth?: number;
  previewHeight?: number;
  margin?: number;
};

export type PreviewPosition = {
  left: number;
  top: number;
  /** True when there wasn't room below the card, so the panel opens upward instead. */
  openAbove: boolean;
};

/**
 * Centers the preview panel horizontally over the anchor card, clamped so it
 * never crosses the viewport's left/right edge — the case for every card in
 * the grid's first or last column. Vertically it prefers opening below the
 * card (matching a floating panel "anchored to" it), but flips above when
 * there isn't room below and there's more room above — the case for a card
 * in the grid's last row — clamping again so it never crosses the top edge
 * either.
 */
export function computePreviewPosition(input: PreviewPositionInput): PreviewPosition {
  const margin = input.margin ?? PREVIEW_VIEWPORT_MARGIN;
  const previewWidth = input.previewWidth ?? PREVIEW_WIDTH;
  const previewHeight = input.previewHeight ?? PREVIEW_HEIGHT;
  const anchorBottom = input.anchorTop + input.anchorHeight;

  const idealLeft = input.anchorLeft + input.anchorWidth / 2 - previewWidth / 2;
  const maxLeft = Math.max(margin, input.viewportWidth - previewWidth - margin);
  const left = Math.min(Math.max(idealLeft, margin), maxLeft);

  const spaceBelow = input.viewportHeight - anchorBottom;
  const spaceAbove = input.anchorTop;
  const openAbove = spaceBelow < previewHeight + margin && spaceAbove > spaceBelow;

  const maxTop = Math.max(margin, input.viewportHeight - previewHeight - margin);
  const idealTop = openAbove ? input.anchorTop - previewHeight - PREVIEW_ANCHOR_GAP : anchorBottom + PREVIEW_ANCHOR_GAP;
  const top = Math.min(Math.max(idealTop, margin), maxTop);

  return { left, top, openAbove };
}
