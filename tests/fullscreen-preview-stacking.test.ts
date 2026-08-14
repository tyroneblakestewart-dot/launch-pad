import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function read(relativePath: string) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

const OVERLAY_SELECTOR = "body:has(.full-generated-page-container)";

// Regression for issue #313, broadened for issue #318: `#launch-studio
// .preview-panel` is `position: sticky` at >=1081px, which creates its own
// CSS stacking context. That traps the generated-site overlay's huge
// z-index inside the panel's context, so any fixed/sticky app chrome
// outside the panel (the LAUNCH FLOW sidebar, mobile header/menu, bottom
// nav, the floating Account launcher, the sticky workspace bar, and the
// sticky page topbar) still paints on top of the overlay and can even
// intercept clicks meant for its controls. The fix hides each surface with
// a `body:has(.full-generated-page-container)` rule instead of moving DOM
// nodes or disabling the sticky panel. `.full-generated-page-container` is
// present whenever the overlay is open at all — windowed (the default) or
// full screen — so this test guards that every one of those surfaces keeps
// its hide rule scoped to that broader selector, not just the narrower
// `.full-generated-page-fullscreen` state, so the sticky-trap can't
// silently come back for a surface, or for the windowed default, that
// isn't covered.
describe("the generated-site overlay is not obstructed by app chrome (issues #313, #318)", () => {
  it("keeps the sticky preview panel that originally caused the stacking trap", async () => {
    const studioCss = await read("app/hoodlums-studio-consistency.css");
    expect(studioCss).toMatch(/#launch-studio \.preview-panel \{\s*position: sticky;/);
  });

  it("hides the fixed LAUNCH FLOW sidebar, mobile header/menu and bottom nav while the overlay is open", async () => {
    const navCss = await read("components/app-navigation.module.css");

    expect(navCss).toContain(`:global(${OVERLAY_SELECTOR}) { padding-left:0 !important; padding-bottom:0 !important; }`);
    const rule = navCss.slice(navCss.indexOf(`:global(${OVERLAY_SELECTOR}) .sidebar`));

    for (const selector of [".sidebar", ".mobileHeader", ".mobileMenu", ".bottomNav"]) {
      expect(rule).toContain(`:global(${OVERLAY_SELECTOR}) ${selector}`);
    }
    expect(rule).toContain("display:none !important;");
    // Must not have regressed back to the narrower fullscreen-only selector.
    expect(navCss).not.toContain("full-generated-page-fullscreen");
  });

  it("hides the floating Account launcher while the overlay is open", async () => {
    const accountCss = await read("components/account-overlay.module.css");

    expect(accountCss).toContain(`:global(${OVERLAY_SELECTOR}) .accountDock`);
    const ruleStart = accountCss.indexOf(`:global(${OVERLAY_SELECTOR}) .accountDock`);
    const ruleEnd = accountCss.indexOf("}", ruleStart);
    expect(accountCss.slice(ruleStart, ruleEnd)).toContain("display: none !important;");
  });

  it("hides the sticky workspace bar while the overlay is open", async () => {
    const workspaceCss = await read("components/token-studio-workspace.module.css");

    expect(workspaceCss).toContain(`:global(${OVERLAY_SELECTOR}) .workspaceBar`);
    const ruleStart = workspaceCss.indexOf(`:global(${OVERLAY_SELECTOR}) .workspaceBar`);
    const ruleEnd = workspaceCss.indexOf("}", ruleStart);
    expect(workspaceCss.slice(ruleStart, ruleEnd)).toContain("display: none !important;");
    expect(workspaceCss).not.toContain("full-generated-page-fullscreen");
  });

  it("hides the sticky page topbar while the overlay is open", async () => {
    const globalsCss = await read("app/globals.css");

    expect(globalsCss).toContain(`${OVERLAY_SELECTOR} .topbar { display: none !important; }`);
    // Guard against the fix drifting away from the class the sticky topbar
    // actually uses.
    expect(globalsCss).toMatch(/\.topbar \{[^}]*position: sticky;[^}]*\}/);
    expect(globalsCss).not.toContain("full-generated-page-fullscreen");
  });
});
