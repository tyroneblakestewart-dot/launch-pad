import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

// Regression coverage for issue #313: the generated site's Full screen mode
// must be a completely unobstructed view. #launch-studio .preview-panel is
// `position: sticky` at >=1081px, which creates its own CSS stacking
// context, so the fullscreen container's huge z-index
// (components/full-website-generator.tsx) only wins *inside* that context —
// the fixed sidebar (z-index:90) and the sticky workspace bar (z-index:50)
// still paint on top of it everywhere else. The fix hides that chrome while
// fullscreen is open instead of trying to out-rank the trap.
describe("full screen preview is not obstructed by the app chrome", () => {
  it("keeps the class name that both the JS toggle and the CSS chrome-hiding rules key off in sync", async () => {
    const generator = await readFile(
      path.join(ROOT, "components", "full-website-generator.tsx"),
      "utf8",
    );
    const navigationCss = await readFile(
      path.join(ROOT, "components", "app-navigation.module.css"),
      "utf8",
    );
    const workspaceCss = await readFile(
      path.join(ROOT, "components", "token-studio-workspace.module.css"),
      "utf8",
    );

    // The class the fullscreen toggle actually adds to the DOM.
    expect(generator).toContain('classList.toggle("full-generated-page-fullscreen")');

    // Every selector below must key off that exact class name — a rename on
    // either side would silently reopen the stacking-context trap.
    for (const css of [navigationCss, workspaceCss]) {
      expect(css).toContain(":has(.full-generated-page-fullscreen))");
    }
  });

  it("hides the fixed sidebar and mobile chrome behind body:has(.full-generated-page-fullscreen)", async () => {
    const css = await readFile(
      path.join(ROOT, "components", "app-navigation.module.css"),
      "utf8",
    );

    const rule = css.slice(css.indexOf(":global(body:has(.full-generated-page-fullscreen))"));
    expect(rule).toContain(".sidebar");
    expect(rule).toContain(".mobileHeader");
    expect(rule).toContain(".mobileMenu");
    expect(rule).toContain(".bottomNav");
    expect(rule).toContain("display:none !important;");
  });

  it("hides the sticky workspace bar behind body:has(.full-generated-page-fullscreen)", async () => {
    const css = await readFile(
      path.join(ROOT, "components", "token-studio-workspace.module.css"),
      "utf8",
    );

    expect(css).toContain(
      ":global(body:has(.full-generated-page-fullscreen)) .workspaceBar { display: none !important; }",
    );
  });

  it("keeps the documented sticky trap in place so the guard above stays meaningful", async () => {
    // .preview-panel's position: sticky is what creates the stacking-context
    // trap in the first place. This isn't being removed (it's a real desktop
    // layout feature) — the chrome is hidden around it instead. If this
    // sticky rule is ever deleted without also removing the body:has() guard
    // rules above, that's a sign the fix needs re-review, not silent drift.
    const css = await readFile(
      path.join(ROOT, "app", "hoodlums-studio-consistency.css"),
      "utf8",
    );

    expect(css).toMatch(/#launch-studio \.preview-panel \{\s*position: sticky;/);
  });
});
