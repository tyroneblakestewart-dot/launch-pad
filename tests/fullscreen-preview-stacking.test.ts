import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function read(relativePath: string) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

const FULLSCREEN_SELECTOR = "body:has(.full-generated-page-fullscreen)";

// Regression for issue #313: `#launch-studio .preview-panel` is
// `position: sticky` at >=1081px, which creates its own CSS stacking
// context. That traps the fullscreen preview container's huge z-index
// inside the panel's context, so any fixed/sticky app chrome outside the
// panel (the LAUNCH FLOW sidebar, mobile header/menu, bottom nav, the
// sticky workspace bar, and the sticky page topbar) still paints on top of
// the fullscreen preview and can even intercept clicks meant for the
// "Exit full screen" button. The fix hides each surface with a
// `body:has(.full-generated-page-fullscreen)` rule instead of moving DOM
// nodes or disabling the sticky panel — this test guards that every one of
// those surfaces keeps its hide rule so the sticky-trap can't silently
// come back for a surface that isn't covered.
describe("fullscreen preview is not obstructed by app chrome (issue #313)", () => {
  it("keeps the sticky preview panel that originally caused the stacking trap", async () => {
    const studioCss = await read("app/hoodlums-studio-consistency.css");
    expect(studioCss).toMatch(/#launch-studio \.preview-panel \{\s*position: sticky;/);
  });

  it("hides the fixed LAUNCH FLOW sidebar, mobile header/menu and bottom nav while full screen is active", async () => {
    const navCss = await read("components/app-navigation.module.css");

    expect(navCss).toContain(`:global(${FULLSCREEN_SELECTOR}) { padding-left:0 !important; padding-bottom:0 !important; }`);
    const rule = navCss.slice(navCss.indexOf(`:global(${FULLSCREEN_SELECTOR}) .sidebar`));

    for (const selector of [".sidebar", ".mobileHeader", ".mobileMenu", ".bottomNav"]) {
      expect(rule).toContain(`:global(${FULLSCREEN_SELECTOR}) ${selector}`);
    }
    expect(rule).toContain("display:none !important;");
  });

  it("hides the sticky workspace bar while full screen is active", async () => {
    const workspaceCss = await read("components/token-studio-workspace.module.css");

    expect(workspaceCss).toContain(`:global(${FULLSCREEN_SELECTOR}) .workspaceBar`);
    const ruleStart = workspaceCss.indexOf(`:global(${FULLSCREEN_SELECTOR}) .workspaceBar`);
    const ruleEnd = workspaceCss.indexOf("}", ruleStart);
    expect(workspaceCss.slice(ruleStart, ruleEnd)).toContain("display: none !important;");
  });

  it("hides the sticky page topbar while full screen is active", async () => {
    const globalsCss = await read("app/globals.css");

    expect(globalsCss).toContain(`${FULLSCREEN_SELECTOR} .topbar { display: none !important; }`);
    // Guard against the fix drifting away from the class the sticky topbar
    // actually uses.
    expect(globalsCss).toMatch(/\.topbar \{[^}]*position: sticky;[^}]*\}/);
  });
});
