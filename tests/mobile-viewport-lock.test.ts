import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("mobile viewport lock", () => {
  it("loads the overflow guard after the existing global styles", async () => {
    const layout = await readFile(path.join(ROOT, "app", "layout.tsx"), "utf8");
    const lockImport = 'import "./mobile-viewport-lock.css";';

    expect(layout).toContain(lockImport);
    expect(layout.indexOf(lockImport)).toBeGreaterThan(
      layout.indexOf('import "./allocation-mobile-tabs.css";'),
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
});
