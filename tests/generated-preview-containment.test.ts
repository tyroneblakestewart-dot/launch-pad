import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_WINDOWED_DESIGN_WIDTH,
  getGeneratedPreviewFrameHeight,
  getWindowedDesignWidth,
  getWindowedScale,
} from "@/components/full-website-generator";

const ROOT = process.cwd();

async function generatorSource() {
  return readFile(path.join(ROOT, "components", "full-website-generator.tsx"), "utf8");
}

// Issue #320 replaced the fixed 70svh mobile windowed height with the
// scaled-iframe technique: the reported content height is now just clamped
// to a sane design-canvas range, and the phone/desktop "how big does it look
// on screen" question is answered separately by getWindowedDesignWidth /
// getWindowedScale.
describe("generated website preview containment", () => {
  it("clamps the reported content height between 700px and 16000px, on any viewport", () => {
    expect(getGeneratedPreviewFrameHeight(480)).toBe("700px");
    expect(getGeneratedPreviewFrameHeight(1800)).toBe("1800px");
    expect(getGeneratedPreviewFrameHeight(48_000)).toBe("16000px");
  });

  it("lays the windowed iframe out at a fixed 1280px design width on desktop", () => {
    expect(getWindowedDesignWidth(1180, false)).toBe(DESKTOP_WINDOWED_DESIGN_WIDTH);
    expect(getWindowedDesignWidth(320, false)).toBe(DESKTOP_WINDOWED_DESIGN_WIDTH);
  });

  it("lays the windowed iframe out proportionally wider than the phone viewport, so scaling it down reveals more of the page", () => {
    expect(getWindowedDesignWidth(390, true)).toBeGreaterThan(390);
    expect(getWindowedDesignWidth(320, true)).toBeGreaterThanOrEqual(320);
  });

  it("scales the design canvas down to exactly fit the available width, and never scales up", () => {
    expect(getWindowedScale(1180, 1280)).toBeCloseTo(1180 / 1280);
    expect(getWindowedScale(2000, 1280)).toBe(1);
    expect(getWindowedScale(0, 1280)).toBe(1);
    expect(getWindowedScale(500, 0)).toBe(1);
  });

  it("clears srcdoc and removes preview control listeners before teardown", async () => {
    const source = await generatorSource();

    expect(source).toContain('frame.srcdoc = "";');
    expect(source.indexOf('frame.srcdoc = "";')).toBeLessThan(source.indexOf("frame.remove();"));
    expect(source).toContain('closeButton.removeEventListener("click", preview.onClose);');
    expect(source).toContain(
      'fullScreenButton.removeEventListener("click", preview.onToggleFullScreen);',
    );
    expect(source).toContain('window.removeEventListener("resize", onViewportResize);');
    expect(source).toContain('site.classList.remove("full-generated-page");');
  });

  it("toggles full screen on the existing container without creating another iframe", async () => {
    const source = await generatorSource();
    const iframeCreations = source.match(/document\.createElement\("iframe"\)/g) || [];
    const toggleStart = source.indexOf("const onToggleFullScreen = () => {");
    const toggleEnd = source.indexOf("};", toggleStart) + 2;
    const toggleBody = source.slice(toggleStart, toggleEnd);

    expect(iframeCreations).toHaveLength(1);
    expect(toggleBody).toContain(
      'container.classList.toggle("full-generated-page-fullscreen")',
    );
    expect(toggleBody).not.toContain('document.createElement("iframe")');
    expect(source).toContain('frame.setAttribute("scrolling", "yes");');
  });
});
