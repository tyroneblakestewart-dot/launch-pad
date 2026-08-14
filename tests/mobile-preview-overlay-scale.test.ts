import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeGeneratedPreviewScale,
  DESKTOP_PREVIEW_DESIGN_WIDTH,
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
  // The mobile block is the last top-level block in the component's style
  // string, so its matching close brace is the template's closing `}` right
  // before the closing backtick.
  const end = source.indexOf("`}</style>", start);
  return source.slice(start, end);
}

// Issue #320 part 1: on phones the overlay used to float mid-screen, leaving
// dead dark space above the tab bar. Windowed mode must now pin the tab bar
// to the top (safe-area aware) and let the site fill the rest of the screen.
describe("phone windowed layout pins controls to the top and fills the rest (issue #320 part 1)", () => {
  it("gives windowed mode the same full-bleed footprint as full screen on phones", async () => {
    const mobile = mobileMediaBlock(await generatorSource());
    const rule = ruleBody(mobile, ".full-generated-page-container:not(.full-generated-page-fullscreen) {");

    expect(rule).toContain("inset: 0;");
    expect(rule).toContain("width: 100vw;");
    expect(rule).toContain("height: 100svh;");
    expect(rule).toContain("transform: none;");
  });

  it("keeps the control bar safe-area aware so it is never clipped by a notch", async () => {
    const mobile = mobileMediaBlock(await generatorSource());
    const rule = ruleBody(mobile, ".full-generated-page-controls {");

    expect(rule).toContain("env(safe-area-inset-top)");
  });

  it("lets the site fill the remaining height via the existing controls/viewport grid, not a fixed vh clamp", async () => {
    const source = await generatorSource();

    expect(source).toContain("grid-template-rows: auto minmax(0, 1fr);");
    expect(source).not.toContain("70svh");
  });

  it("leaves desktop's floating centred window untouched", async () => {
    const source = await generatorSource();
    const rule = ruleBody(source, ".full-generated-page-container {");

    expect(rule).toContain("position: fixed;");
    expect(rule).toContain("top: 50%;");
    expect(rule).toContain("left: 50%;");
    expect(rule).toContain("transform: translate(-50%, -50%);");
  });
});

// Issue #320 part 2: owner videos showed the site sliding side to side in
// both windowed and full screen on phones. The fix is at the shell level so
// it can never regress regardless of what the generated page itself does.
describe("the shell never allows sideways movement, windowed or full screen (issue #320 part 2)", () => {
  it("locks the viewport and frame to vertical-only scrolling", async () => {
    const source = await generatorSource();
    const viewportRule = ruleBody(source, ".full-generated-page-viewport {");
    const frameRule = ruleBody(source, ".full-generated-page-frame {");

    for (const rule of [viewportRule, frameRule]) {
      expect(rule).toContain("overflow-x: hidden;");
      expect(rule).toContain("touch-action: pan-y;");
    }
    // Regression: must not have drifted back to allowing horizontal panning.
    expect(source).not.toContain("touch-action: pan-x pan-y;");
  });

  it("is not scoped to only windowed or only full screen — the lock applies unconditionally", async () => {
    const source = await generatorSource();
    const viewportStart = source.indexOf(".full-generated-page-viewport {");
    const viewportSelectorLine = source.slice(Math.max(0, viewportStart - 5), viewportStart);

    // The rule is a bare top-level selector, not nested under
    // .full-generated-page-fullscreen or a :not(...fullscreen) guard.
    expect(viewportSelectorLine).not.toContain("fullscreen");
  });

  it("forces the iframe back to the device viewport width exactly in mobile full screen, with no transform offset", async () => {
    const source = await generatorSource();
    const rule = ruleBody(source, ".full-generated-page-fullscreen .full-generated-page-frame {");

    expect(rule).toContain("width: 100% !important;");
    expect(rule).toContain("height: 100% !important;");
    expect(rule).toContain("transform: none !important;");
  });
});

// Issue #320 part 3: the windowed preview should show more of the page
// composition (hero plus the next section or two), not just a nav bar and
// one tall block, by laying the iframe out wider than available and
// scaling it down to fit.
describe("windowed preview renders a scaled, more-complete composition (issue #320 part 3)", () => {
  it("wraps the iframe in a scale wrapper sized to the scaled box", async () => {
    const source = await generatorSource();

    expect(source).toContain('scale.className = "full-generated-page-scale";');
    expect(source).toContain("scale.appendChild(frame);");
    expect(source).toContain("viewport.appendChild(scale);");
  });

  it("computes a design width/scale pair and applies a top-left transform in layout()", async () => {
    const source = await generatorSource();
    const layoutStart = source.indexOf("function layout() {");
    const layoutEnd = source.indexOf("\n  }", layoutStart);
    const layoutBody = source.slice(layoutStart, layoutEnd);

    expect(layoutBody).toContain("computeGeneratedPreviewScale(availableWidth, mobile)");
    expect(layoutBody).toContain('frame.style.transform = `scale(${factor})`;');
    expect(layoutBody).toContain('frame.style.transformOrigin = "top left";');
    expect(layoutBody).toContain("scale.style.width = `${Math.round(designWidth * factor)}px`;");
    expect(layoutBody).toContain("scale.style.height = `${Math.round(designHeight * factor)}px`;");
  });

  it("scales desktop from a fixed 1280px design width and mobile from a viewport-proportional width", () => {
    const desktop = computeGeneratedPreviewScale(1180, false);
    expect(desktop.designWidth).toBe(DESKTOP_PREVIEW_DESIGN_WIDTH);
    expect(desktop.scale).toBeLessThan(1);

    const mobile = computeGeneratedPreviewScale(390, true);
    expect(mobile.scale).toBe(MOBILE_PREVIEW_SCALE);
    // The scaled result exactly fills the available width — no gutters,
    // no off-centre offset, consistent with part 2's shell-level guarantee.
    expect(mobile.designWidth * mobile.scale).toBeCloseTo(390);
  });

  it("clears back to a real 1:1 render in full screen without remounting the iframe", async () => {
    const source = await generatorSource();
    const iframeCreations = source.match(/document\.createElement\("iframe"\)/g) || [];
    const rule = ruleBody(source, ".full-generated-page-fullscreen .full-generated-page-scale {");

    expect(iframeCreations).toHaveLength(1);
    expect(rule).toContain("width: 100% !important;");
    expect(rule).toContain("height: 100% !important;");
  });

  it("re-runs layout() on full screen toggle so the scale recomputes for the newly active state", async () => {
    const source = await generatorSource();
    const toggleStart = source.indexOf("const onToggleFullScreen = () => {");
    const toggleEnd = source.indexOf("};", toggleStart) + 2;
    const toggleBody = source.slice(toggleStart, toggleEnd);

    expect(toggleBody).toContain('container.classList.toggle("full-generated-page-fullscreen")');
    expect(toggleBody).not.toContain('document.createElement("iframe")');
    expect(toggleBody).toContain("layout();");
  });
});

// Owner browser-verification follow-up: .preview-panel applies a `filter`
// while the build gate is locked (components/build-site-gate.tsx), and a
// filtered ancestor becomes the containing block for `position: fixed`
// descendants. Because the backdrop/container used to mount inside
// .site-preview (a .preview-panel child), the "full-bleed" phone overlay
// intermittently re-anchored to .site-preview's own box instead of the
// viewport. Mounting on document.body permanently escapes that trap.
describe("the overlay mounts on document.body, immune to ancestor filter/transform containing-block traps", () => {
  it("appends the backdrop and container to document.body, not .site-preview", async () => {
    const source = await generatorSource();

    expect(source).toContain("document.body.append(backdrop, container);");
    expect(source).not.toContain("site.append(backdrop, container);");
  });

  it("no longer needs backdrop/container exceptions in the site-preview hide rule", async () => {
    const source = await generatorSource();

    expect(source).toContain(
      ".site-preview.full-generated-page > :not(.full-generated-page-status) { display: none !important; }",
    );
    expect(source).not.toContain(":not(.full-generated-page-backdrop)");
  });

  it("still hides .site-preview's placeholder/reopen-card content while the overlay is open", async () => {
    // clearPreviewStatus only ever removes .full-generated-page-status, and
    // the hide rule above still applies `display: none !important` to
    // every other .site-preview child (the empty-state and "Reopen
    // generated site" cards from components/token-studio.tsx) whenever
    // .full-generated-page is toggled on — that toggle is unchanged by the
    // body-mount fix.
    const source = await generatorSource();

    expect(source).toContain('site.classList.add("full-generated-page");');
    expect(source).toContain('site.classList.remove("full-generated-page");');
  });

  it("still removes the backdrop and container from wherever they are mounted on dispose", async () => {
    const source = await generatorSource();
    const disposeStart = source.indexOf("function disposeRenderedPreview(preview: RenderedPreview | null) {");
    const disposeEnd = source.indexOf("}", source.indexOf("preview.backdrop.remove();", disposeStart)) + 1;
    const disposeBody = source.slice(disposeStart, disposeEnd);

    expect(disposeBody).toContain("preview.container.remove();");
    expect(disposeBody).toContain("preview.backdrop.remove();");
  });
});
