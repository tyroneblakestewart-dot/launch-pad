import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getGeneratedPreviewFrameHeight,
  MOBILE_PREVIEW_HEIGHT,
} from "@/components/full-website-generator";

const ROOT = process.cwd();

async function generatorSource() {
  return readFile(path.join(ROOT, "components", "full-website-generator.tsx"), "utf8");
}

describe("generated website preview containment", () => {
  it("clamps the mobile height bridge to 70svh while retaining desktop limits", () => {
    expect(MOBILE_PREVIEW_HEIGHT).toBe("70svh");
    expect(getGeneratedPreviewFrameHeight(16_000, true)).toBe("70svh");
    expect(getGeneratedPreviewFrameHeight(48_000, true)).toBe("70svh");
    expect(getGeneratedPreviewFrameHeight(480, false)).toBe("700px");
    expect(getGeneratedPreviewFrameHeight(48_000, false)).toBe("16000px");
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
    expect(source).toContain("height: 70svh !important;");
    expect(source).toContain("max-height: 70svh;");
  });
});
