import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("mobile viewport lock", () => {
  it("loads the overflow guard after the existing global styles", async () => {
    const layout = await readFile(path.join(ROOT, "app", "(app)", "layout.tsx"), "utf8");
    const lockImport = 'import "../mobile-viewport-lock.css";';

    expect(layout).toContain(lockImport);
    expect(layout.indexOf(lockImport)).toBeGreaterThan(
      layout.indexOf('import "../allocation-mobile-tabs.css";'),
    );
  });

  it("prevents the root page from moving horizontally on mobile Safari", async () => {
    const css = await readFile(path.join(ROOT, "app", "mobile-viewport-lock.css"), "utf8");

    expect(css).toMatch(/html,\s*\nbody\s*\{[\s\S]*min-width:\s*0;/);
    expect(css).toContain("overflow-x: hidden;");
    expect(css).toContain("overflow-x: clip;");
    expect(css).toContain("overscroll-behavior-x: none;");
    expect(css).toContain("touch-action: pan-y pinch-zoom;");
  });

  it("allows nested grid, form, preview and long-text children to shrink inside the viewport", async () => {
    const css = await readFile(path.join(ROOT, "app", "mobile-viewport-lock.css"), "utf8");

    for (const selector of [
      ".workspace",
      ".builder-panel",
      ".preview-panel",
      ".site-preview",
      ".hero-section",
      ".modal-card",
      ".ticker-input input",
      ".url-input input",
      ".build-site-inspiration-field input",
      ".contract-strip code",
    ]) {
      expect(css).toContain(selector);
    }
    expect(css).toContain("text-overflow: ellipsis;");
    expect(css).toContain("max-width: 100%;");
  });

  it("sizes .modal-card (the launch summary and saved-projects modals) against the small viewport, not 100vh", async () => {
    // On iOS Safari with the address bar shown, 100vh reports the large
    // (address-bar-hidden) viewport height, which is taller than what's
    // actually visible — sizing a centred fixed modal against that oversized
    // box can push it partly above the visible screen (issue #313 Part C).
    const css = await readFile(path.join(ROOT, "app", "globals.css"), "utf8");
    const modalCardStart = css.indexOf(".modal-card {");
    const rule = css.slice(modalCardStart, css.indexOf(".modal-heading", modalCardStart));

    expect(rule).toContain("max-height: min(760px, calc(100svh - 40px));");
    expect(rule).not.toContain("calc(100vh");
  });
});
