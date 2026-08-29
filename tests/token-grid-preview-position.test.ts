import { describe, expect, it } from "vitest";
import {
  computePreviewPosition,
  PREVIEW_HEIGHT,
  PREVIEW_VIEWPORT_MARGIN,
  PREVIEW_WIDTH,
} from "@/lib/token-grid-preview-position";

const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 900;

describe("computePreviewPosition", () => {
  it("centers the panel horizontally over a card in the middle of the grid", () => {
    const anchorWidth = 260;
    const anchorLeft = 470;
    const position = computePreviewPosition({
      anchorLeft,
      anchorTop: 200,
      anchorWidth,
      anchorHeight: 260,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
    });
    expect(position.left).toBeCloseTo(anchorLeft + anchorWidth / 2 - PREVIEW_WIDTH / 2);
  });

  it("clamps left instead of crossing the viewport's left edge for a first-column card", () => {
    const position = computePreviewPosition({
      anchorLeft: 0,
      anchorTop: 200,
      anchorWidth: 200,
      anchorHeight: 260,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
    });
    expect(position.left).toBe(PREVIEW_VIEWPORT_MARGIN);
  });

  it("clamps left instead of crossing the viewport's right edge for a last-column card", () => {
    const position = computePreviewPosition({
      anchorLeft: VIEWPORT_WIDTH - 200,
      anchorTop: 200,
      anchorWidth: 200,
      anchorHeight: 260,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
    });
    expect(position.left + PREVIEW_WIDTH).toBeLessThanOrEqual(VIEWPORT_WIDTH - PREVIEW_VIEWPORT_MARGIN + 0.001);
  });

  it("opens below the card when there's room", () => {
    const anchorTop = 100;
    const anchorHeight = 260;
    const position = computePreviewPosition({
      anchorLeft: 400,
      anchorTop,
      anchorWidth: 260,
      anchorHeight,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
    });
    expect(position.openAbove).toBe(false);
    expect(position.top).toBeGreaterThan(anchorTop + anchorHeight);
  });

  it("flips to open above the card when it's in the grid's last row with no room below", () => {
    const anchorTop = VIEWPORT_HEIGHT - 260;
    const anchorHeight = 240;
    const position = computePreviewPosition({
      anchorLeft: 400,
      anchorTop,
      anchorWidth: 260,
      anchorHeight,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
    });
    expect(position.openAbove).toBe(true);
    expect(position.top + PREVIEW_HEIGHT).toBeLessThanOrEqual(anchorTop + 0.001);
  });

  it("never places the panel above the viewport's top edge even when flipped above on a very short viewport", () => {
    const position = computePreviewPosition({
      anchorLeft: 400,
      anchorTop: 50,
      anchorWidth: 260,
      anchorHeight: 240,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: 320,
    });
    expect(position.top).toBeGreaterThanOrEqual(PREVIEW_VIEWPORT_MARGIN);
  });

  it("respects custom preview dimensions and margin", () => {
    const position = computePreviewPosition({
      anchorLeft: 0,
      anchorTop: 0,
      anchorWidth: 100,
      anchorHeight: 100,
      viewportWidth: 400,
      viewportHeight: 400,
      previewWidth: 200,
      previewHeight: 150,
      margin: 4,
    });
    expect(position.left).toBeGreaterThanOrEqual(4);
    expect(position.left + 200).toBeLessThanOrEqual(400 - 4 + 0.001);
  });
});
