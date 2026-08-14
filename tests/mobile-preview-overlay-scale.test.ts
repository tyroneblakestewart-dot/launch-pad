import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function generatorSource() {
  return readFile(path.join(ROOT, "components", "full-website-generator.tsx"), "utf8");
}

function mobileMediaBlock(source: string): string {
  const start = source.indexOf("@media (max-width: 767px) {");
  expect(start).toBeGreaterThan(-1);
  // The template literal is not nested any deeper than this one @media
  // block, so the matching close brace is the last one before the closing
  // backtick of the style template.
  const end = source.indexOf("`}</style>", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

// Issue #320 part 1: on phones (<=767px) the overlay no longer floats a
// centred box mid-screen — the tab bar pins to the very top of the screen
// (safe-area aware) and the site fills every remaining pixel below it.
describe("phone windowed layout pins the tab bar to the top and fills the rest (issue #320 part 1)", () => {
  it("stretches the windowed container to the full screen instead of a centred floating box on phones", async () => {
    const mobile = mobileMediaBlock(await generatorSource());
    const ruleStart = mobile.indexOf(
      ".full-generated-page-container:not(.full-generated-page-fullscreen) {",
    );
    expect(ruleStart).toBeGreaterThan(-1);
    const rule = mobile.slice(ruleStart, mobile.indexOf("}", ruleStart));

    expect(rule).toContain("top: 0;");
    expect(rule).toContain("width: 100vw;");
    expect(rule).toContain("height: 100svh;");
    expect(rule).toContain("transform: none;");
  });

  it("keeps the desktop centred floating window geometry unchanged outside the phone media query", async () => {
    const source = await generatorSource();
    const containerRuleStart = source.indexOf(".full-generated-page-container {");
    const containerRule = source.slice(containerRuleStart, source.indexOf("}", containerRuleStart));

    expect(containerRule).toContain("position: fixed;");
    expect(containerRule).toContain("top: 50%;");
    expect(containerRule).toContain("left: 50%;");
    expect(containerRule).toContain("transform: translate(-50%, -50%);");
  });

  it("pins the control bar's padding to the safe-area top inset so it is never hidden under a phone notch/status bar", async () => {
    const mobile = mobileMediaBlock(await generatorSource());
    expect(mobile).toContain("padding-top: calc(8px + env(safe-area-inset-top));");
  });

  it("lets the viewport row fill the remaining grid space below the pinned controls, with no fixed dead-space height", async () => {
    const source = await generatorSource();
    const containerRuleStart = source.indexOf(".full-generated-page-container {");
    const containerRule = source.slice(containerRuleStart, source.indexOf("}", containerRuleStart));

    expect(containerRule).toContain("grid-template-rows: auto minmax(0, 1fr);");
    // The old fixed 70svh mobile windowed sizing must be gone.
    expect(source).not.toContain("70svh");
  });
});

// Issue #320 part 2: the shell never allows sideways movement, in either the
// windowed or full-screen state, on phones.
describe("the shell locks out sideways movement in both windowed and full screen on phones (issue #320 part 2)", () => {
  it("locks horizontal overflow and touch panning to vertical-only on the viewport and frame", async () => {
    const mobile = mobileMediaBlock(await generatorSource());
    const viewportRuleStart = mobile.indexOf(".full-generated-page-viewport {");
    const viewportRule = mobile.slice(viewportRuleStart, mobile.indexOf("}", viewportRuleStart));
    const frameRuleStart = mobile.indexOf(".full-generated-page-frame {");
    const frameRule = mobile.slice(frameRuleStart, mobile.indexOf("}", frameRuleStart));

    expect(viewportRule).toContain("overflow-x: hidden;");
    expect(viewportRule).toContain("touch-action: pan-y;");
    expect(frameRule).toContain("touch-action: pan-y;");

    // Not scoped to :not(.full-generated-page-fullscreen) — applies to both
    // the windowed and full-screen states.
    expect(mobile.slice(0, viewportRuleStart)).not.toMatch(
      /:not\(\.full-generated-page-fullscreen\)\s*$/,
    );
  });

  it("keeps desktop full-screen behaviour untouched by the phone-only sideways lock", async () => {
    const source = await generatorSource();
    const desktopFullscreenStart = source.indexOf(
      ".full-generated-page-container.full-generated-page-fullscreen {",
    );
    const desktopFullscreenRule = source.slice(
      desktopFullscreenStart,
      source.indexOf("}", desktopFullscreenStart),
    );

    expect(desktopFullscreenStart).toBeLessThan(source.indexOf("@media (max-width: 767px) {"));
    expect(desktopFullscreenRule).toContain("width: 100vw;");
    expect(desktopFullscreenRule).toContain("height: 100svh;");
  });
});

// Issue #320 part 3: the windowed overlay (desktop and phone) renders the
// site scaled down via the classic scaled-iframe technique so more of the
// page composition is visible, and toggling window<->fullscreen never
// remounts the iframe.
describe("the windowed preview uses a scaled iframe to show more of the page (issue #320 part 3)", () => {
  it("wraps the single iframe in a scale wrapper that clips to the scaled box", async () => {
    const source = await generatorSource();

    expect(source).toContain('scaleWrapper.className = "full-generated-page-scale";');
    expect(source).toContain("scaleWrapper.appendChild(frame);");
    expect(source).toContain("viewport.appendChild(scaleWrapper);");
    expect((source.match(/document\.createElement\("iframe"\)/g) || [])).toHaveLength(1);
  });

  it("scales the iframe with a top-left transform origin so the wrapper math lines up", async () => {
    const source = await generatorSource();
    const frameRuleStart = source.indexOf(".full-generated-page-frame {");
    const frameRule = source.slice(frameRuleStart, source.indexOf("}", frameRuleStart));

    expect(frameRule).toContain("transform-origin: top left;");
  });

  it("computes the windowed design width/scale/wrapper size and applies them as a transform, never in full screen", async () => {
    const source = await generatorSource();
    const fnStart = source.indexOf("function applyPreviewLayout(preview: RenderedPreview, reportedHeight: number) {");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = source.indexOf("\n}\n", fnStart);
    const fnBody = source.slice(fnStart, fnEnd);

    // Full screen: every inline style this function set for the windowed
    // scaled mode is cleared so the base 1:1 CSS rules take back over.
    expect(fnBody).toContain('if (fullScreen) {');
    expect(fnBody).toContain('frame.style.transform = "";');
    expect(fnBody).toContain('scaleWrapper.style.width = "";');
    expect(fnBody).toContain('scaleWrapper.style.height = "";');

    // Windowed: design width + scale factor drive the transform and the
    // wrapper's clipped, correctly-sized box.
    expect(fnBody).toContain("getWindowedDesignWidth(availableWidth, mobile)");
    expect(fnBody).toContain("getWindowedScale(availableWidth, designWidth)");
    expect(fnBody).toContain("frame.style.transform = `scale(${scale})`;");
    expect(fnBody).toContain("scaleWrapper.style.width = `${Math.round(designWidth * scale)}px`;");
    expect(fnBody).toContain("scaleWrapper.style.height = `${Math.round(contentHeightPx * scale)}px`;");
  });

  it("does not remount the iframe when toggling full screen — it re-runs the same layout function on the existing node", async () => {
    const source = await generatorSource();
    const toggleStart = source.indexOf("const onToggleFullScreen = () => {");
    const toggleEnd = source.indexOf("};", toggleStart) + 2;
    const toggleBody = source.slice(toggleStart, toggleEnd);

    expect(toggleBody).not.toContain('document.createElement("iframe")');
    expect(toggleBody).toContain("onFullScreenToggled();");

    // Both places that construct the preview wire the same re-layout
    // callback through renderGeneratedWebsite's new parameter, so toggling
    // full screen actually re-applies the scale/1:1 layout.
    expect(source).toContain("onFullScreenToggled: () => void,");
    const generateCallCount = (source.match(/\}, applyActiveFrameHeight\);/g) || []).length;
    expect(generateCallCount).toBe(2);
  });
});
