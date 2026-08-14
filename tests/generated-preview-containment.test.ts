import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeGeneratedPreviewScale,
  getGeneratedPreviewDesignHeight,
  DESKTOP_PREVIEW_DESIGN_WIDTH,
  MOBILE_PREVIEW_SCALE,
} from "@/components/full-website-generator";

const ROOT = process.cwd();

async function generatorSource() {
  return readFile(path.join(ROOT, "components", "full-website-generator.tsx"), "utf8");
}

// Issue #320 part 3 superseded the old mobile-only 70svh height clamp: the
// windowed preview (desktop and phone alike) now lays the iframe out at a
// design width and scales it down, so it needs a design width/scale pair
// instead of a single fixed height bridge.
describe("generated website preview containment", () => {
  it("clamps the design height the same way regardless of viewport", () => {
    expect(getGeneratedPreviewDesignHeight(480)).toBe(700);
    expect(getGeneratedPreviewDesignHeight(16_000)).toBe(16_000);
    expect(getGeneratedPreviewDesignHeight(48_000)).toBe(16_000);
  });

  it("uses a fixed desktop design width, scaled down to fit what's available", () => {
    expect(DESKTOP_PREVIEW_DESIGN_WIDTH).toBe(1280);
    expect(computeGeneratedPreviewScale(1180, false)).toEqual({
      designWidth: 1280,
      scale: 1180 / 1280,
    });
    // Never scales up past 1:1 even if more room is available than the design width.
    expect(computeGeneratedPreviewScale(2000, false)).toEqual({ designWidth: 1280, scale: 1 });
  });

  it("scales the phone design width from the available viewport width at a fixed factor", () => {
    expect(MOBILE_PREVIEW_SCALE).toBeGreaterThan(0);
    expect(MOBILE_PREVIEW_SCALE).toBeLessThan(1);
    const { designWidth, scale } = computeGeneratedPreviewScale(390, true);
    expect(scale).toBe(MOBILE_PREVIEW_SCALE);
    expect(designWidth).toBeCloseTo(390 / MOBILE_PREVIEW_SCALE);
    // The scaled-down box exactly fills the available width — no gutters.
    expect(designWidth * scale).toBeCloseTo(390);
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
    // Toggling must re-run layout() so the scale/height recompute for the
    // newly-active state's available width, without remounting the iframe.
    expect(toggleBody).toContain("layout();");
    expect(source).toContain('frame.setAttribute("scrolling", "yes");');
    expect(source).toContain(
      '.full-generated-page-fullscreen .full-generated-page-frame {\n        width: 100% !important;\n        height: 100% !important;',
    );
  });
});
