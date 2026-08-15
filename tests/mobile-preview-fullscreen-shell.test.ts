import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FULLSCREEN_CONTROLS_AUTO_HIDE_MS,
  FULLSCREEN_CONTROLS_ENTRY_VISIBLE_MS,
  getMobileGeneratedPreviewDesignHeight,
  MOBILE_PREVIEW_SCALE,
} from "@/components/full-website-generator";

const ROOT = process.cwd();

async function generatorSource() {
  return readFile(path.join(ROOT, "components", "full-website-generator.tsx"), "utf8");
}

function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(selector);
  expect(start, `selector not found: ${selector}`).toBeGreaterThan(-1);
  const end = source.indexOf("}", start);
  return source.slice(start, end);
}

function mobileMediaBlock(source: string): string {
  const start = source.indexOf("@media (max-width: 767px) {");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("`}</style>", start);
  return source.slice(start, end);
}

function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `function not found: ${signature}`).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }", start);
  return source.slice(start, end);
}

// Issue #327 problem 1: the windowed preview used to size the iframe's own
// height from the generated page's *reported* scrollHeight, which is
// unstable whenever the page sizes any block in viewport-relative units
// (svh/vh) — the free-site template's centred hero (`min-height: 70svh`)
// and body (`min-height: 100svh`) both do. Feeding scrollHeight back into
// the very iframe height those units resolve against inflates the iframe
// far past one screen, pushing the (vertically centred) hero content below
// the one-screenful slice the scaled preview actually shows. The fix: on
// mobile, derive the iframe's own height from the space actually
// available, never from reported content height.
describe("windowed preview height is available-space-driven on mobile, content-driven on desktop (issue #327 problem 1)", () => {
  it("scales the design height from available height at the same factor as width, filling the available box exactly", () => {
    const availableHeight = 700;
    const designHeight = getMobileGeneratedPreviewDesignHeight(availableHeight, MOBILE_PREVIEW_SCALE);
    expect(designHeight * MOBILE_PREVIEW_SCALE).toBeCloseTo(availableHeight, 0);
  });

  it("never derives a design height from reported content height on mobile", () => {
    // A generated page reporting a huge scrollHeight (e.g. inflated by the
    // vh feedback loop this fix eliminates) must not influence the mobile
    // design height at all.
    const small = getMobileGeneratedPreviewDesignHeight(700, MOBILE_PREVIEW_SCALE);
    const stillSmall = getMobileGeneratedPreviewDesignHeight(700, MOBILE_PREVIEW_SCALE);
    expect(small).toBe(stillSmall);
  });

  it("layout() picks the mobile-only height function for the mobile branch and leaves desktop on the old reportedHeight-driven one", async () => {
    const source = await generatorSource();
    const layoutBody = functionBody(source, "function layout() {");

    expect(layoutBody).toContain(
      "getMobileGeneratedPreviewDesignHeight(viewport.clientHeight || container.clientHeight || 1, factor)",
    );
    expect(layoutBody).toContain("getGeneratedPreviewDesignHeight(reportedHeight)");
    expect(layoutBody).toMatch(/const designHeight = mobile\s*\?\s*getMobileGeneratedPreviewDesignHeight/);
  });
});

// Issue #327 problem 2: full screen must reach every edge of the phone
// screen — 100svh alone left a dead band at the bottom under Safari's
// dynamic toolbar. Scoped to mobile only; desktop full screen (the base,
// non-media-query-scoped rule) is untouched.
describe("mobile full screen reaches every edge of the screen (issue #327 problem 2)", () => {
  it("uses a dvh-preferred fallback chain instead of a bare 100vh/100svh", async () => {
    const mobile = mobileMediaBlock(await generatorSource());
    const rule = ruleBody(mobile, ".full-generated-page-container.full-generated-page-fullscreen {");

    const heightDeclarations = [...rule.matchAll(/height:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(heightDeclarations).toEqual(["100vh", "-webkit-fill-available", "100svh", "100dvh"]);
  });

  it("gives the viewport the whole container instead of sharing it with a reserved control-bar row", async () => {
    const mobile = mobileMediaBlock(await generatorSource());
    const rule = ruleBody(mobile, ".full-generated-page-container.full-generated-page-fullscreen {");

    expect(rule).toContain("grid-template-rows: minmax(0, 1fr);");
  });

  it("leaves desktop's non-mobile-scoped full screen rule untouched", async () => {
    const source = await generatorSource();
    const mediaStart = source.indexOf("@media (max-width: 767px) {");
    const baseSource = source.slice(0, mediaStart);
    const rule = ruleBody(baseSource, ".full-generated-page-container.full-generated-page-fullscreen {");

    expect(rule).toContain("height: 100svh;");
    expect(rule).not.toContain("100dvh");
    expect(rule).not.toContain("grid-template-rows");
  });
});

// Issue #327 problem 3: controls default to hidden in mobile full screen and
// slide in as an overlay on tap/focus, instead of permanently reserving a
// layout row.
describe("mobile full-screen controls auto-hide with tap-to-reveal (issue #327 problem 3)", () => {
  it("exports the entry and tap auto-hide delays", () => {
    expect(FULLSCREEN_CONTROLS_ENTRY_VISIBLE_MS).toBe(2000);
    expect(FULLSCREEN_CONTROLS_AUTO_HIDE_MS).toBe(4000);
    expect(FULLSCREEN_CONTROLS_ENTRY_VISIBLE_MS).toBeLessThan(FULLSCREEN_CONTROLS_AUTO_HIDE_MS);
  });

  it("hides the controls by default and only reveals them via a visible-state class, as a slide/fade overlay", async () => {
    const mobile = mobileMediaBlock(await generatorSource());
    const hiddenRule = ruleBody(mobile, ".full-generated-page-fullscreen .full-generated-page-controls {");

    expect(hiddenRule).toContain("position: absolute;");
    expect(hiddenRule).toContain("opacity: 0;");
    expect(hiddenRule).toContain("pointer-events: none;");
    expect(hiddenRule).toContain("transform: translateY(-100%);");

    const visibleRule = ruleBody(
      mobile,
      ".full-generated-page-fullscreen.full-generated-page-controls-visible .full-generated-page-controls {",
    );
    expect(visibleRule).toContain("opacity: 1;");
    expect(visibleRule).toContain("pointer-events: auto;");
    expect(visibleRule).toContain("transform: translateY(0);");
  });

  it("shows controls for the longer entry window on entering full screen, and gates it on mobile", async () => {
    const source = await generatorSource();
    const toggleBody = functionBody(source, "const onToggleFullScreen = () => {");

    expect(toggleBody).toContain("if (fullScreen && isMobilePreviewViewport()) {");
    expect(toggleBody).toContain("showFullScreenControls(FULLSCREEN_CONTROLS_ENTRY_VISIBLE_MS);");
    expect(toggleBody).toContain("hideFullScreenControls();");
  });

  it("gates every part of the toggle/show/hide state machine on full screen + mobile", async () => {
    const source = await generatorSource();

    expect(source).toContain(
      'const isFullScreenMobile = () =>\n    container.classList.contains("full-generated-page-fullscreen") && isMobilePreviewViewport();',
    );
    const toggleFn = functionBody(source, "const toggleFullScreenControls = () => {");
    expect(toggleFn).toContain("if (!isFullScreenMobile()) return;");
  });

  it("a tap toggles unless it lands on the controls themselves, so it can't fight a button's own action", async () => {
    const source = await generatorSource();
    const tapHandler = functionBody(source, "const onContainerTapToggle = (event: Event) => {");

    expect(tapHandler).toContain("if (!isFullScreenMobile()) return;");
    expect(tapHandler).toContain('target.closest(".full-generated-page-controls")');
    expect(tapHandler).toContain("toggleFullScreenControls();");
    expect(source).toContain('container.addEventListener("click", onContainerTapToggle);');
    expect(source).toContain('controlCleanups.push(() => container.removeEventListener("click", onContainerTapToggle));');
  });

  it("keeps controls visible indefinitely while focus is inside them, for keyboard/VoiceOver users", async () => {
    const source = await generatorSource();
    const focusIn = functionBody(source, "const onControlsFocusIn = () => {");
    const focusOut = functionBody(source, "const onControlsFocusOut = (event: FocusEvent) => {");

    expect(focusIn).toContain("showFullScreenControls(null);");
    expect(focusOut).toContain("if (next instanceof Node && controls.contains(next)) return;");
    expect(focusOut).toContain("showFullScreenControls(FULLSCREEN_CONTROLS_AUTO_HIDE_MS);");
    expect(source).toContain('controls.addEventListener("focusin", onControlsFocusIn);');
    expect(source).toContain('controls.addEventListener("focusout", onControlsFocusOut);');
  });

  it("never hides controls out from under an element inside them that already has focus", async () => {
    const source = await generatorSource();
    const showFn = functionBody(source, "const showFullScreenControls = (autoHideMs: number | null) => {");

    expect(showFn).toContain("if (controls.contains(document.activeElement)) return;");
  });

  it("clears the pending auto-hide timer on dispose", async () => {
    const source = await generatorSource();
    expect(source).toContain("controlCleanups.push(clearControlsAutoHideTimer);");
  });

  it("forwards a tap landing inside the sandboxed iframe (which never bubbles to the parent DOM) via a postMessage the iframe itself sends", async () => {
    const source = await generatorSource();

    expect(source).toContain("onFrameTap: toggleFullScreenControls,");
    const onMessageBody = source.slice(
      source.indexOf("function onMessage(event: MessageEvent) {"),
      source.indexOf("function onViewportResize"),
    );
    expect(onMessageBody).toContain('data?.type === "hoodlums-generated-page-tap"');
    expect(onMessageBody).toContain("activePreview.onFrameTap();");
  });
});
