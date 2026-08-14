import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function read(relativePath: string) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

const OVERLAY_SELECTOR = "body:has(.full-generated-page-container)";

// Issue #318: the generated-site overlay is now a fixed, centred window as
// soon as it opens — not only once "Full screen" is pressed — so it inherits
// the exact same stacking trap that issue #313 fixed for the fullscreen
// toggle (`.preview-panel` is `position: sticky`, which traps the overlay's
// z-index inside its own stacking context). Every surface issue #313 hid for
// the fullscreen state must also be hidden for the windowed default state,
// in addition to (not instead of) the existing fullscreen-only rules.
describe("the windowed default overlay is not obstructed by app chrome (issue #318)", () => {
  it("hides the fixed LAUNCH FLOW sidebar, mobile header/menu and bottom nav for the whole overlay", async () => {
    const navCss = await read("components/app-navigation.module.css");

    expect(navCss).toContain(`:global(${OVERLAY_SELECTOR}) { padding-left:0 !important; padding-bottom:0 !important; }`);
    const rule = navCss.slice(navCss.indexOf(`:global(${OVERLAY_SELECTOR}) .sidebar`));

    for (const selector of [".sidebar", ".mobileHeader", ".mobileMenu", ".bottomNav"]) {
      expect(rule).toContain(`:global(${OVERLAY_SELECTOR}) ${selector}`);
    }
    expect(rule).toContain("display:none !important;");
  });

  it("hides the sticky workspace bar for the whole overlay", async () => {
    const workspaceCss = await read("components/token-studio-workspace.module.css");

    expect(workspaceCss).toContain(`:global(${OVERLAY_SELECTOR}) .workspaceBar`);
    const ruleStart = workspaceCss.indexOf(`:global(${OVERLAY_SELECTOR}) .workspaceBar`);
    const ruleEnd = workspaceCss.indexOf("}", ruleStart);
    expect(workspaceCss.slice(ruleStart, ruleEnd)).toContain("display: none !important;");
  });

  it("hides the sticky page topbar for the whole overlay", async () => {
    const globalsCss = await read("app/globals.css");

    expect(globalsCss).toContain(`${OVERLAY_SELECTOR} .topbar { display: none !important; }`);
  });

  it("still keeps the fullscreen-only rules issue #313 added, so the fullscreen toggle is covered twice over rather than once", async () => {
    const navCss = await read("components/app-navigation.module.css");
    const workspaceCss = await read("components/token-studio-workspace.module.css");
    const globalsCss = await read("app/globals.css");

    expect(navCss).toContain(":global(body:has(.full-generated-page-fullscreen))");
    expect(workspaceCss).toContain(":global(body:has(.full-generated-page-fullscreen)) .workspaceBar");
    expect(globalsCss).toContain("body:has(.full-generated-page-fullscreen) .topbar { display: none !important; }");
  });
});
