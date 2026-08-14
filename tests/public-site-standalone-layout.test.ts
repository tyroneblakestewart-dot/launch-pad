import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const STUDIO_COMPONENT_IMPORTS = [
  "AppNavigation",
  "MobileBottomNavigation",
  "WalletProviderSelector",
  "GenerateSiteStyleAuthBridge",
];

const STUDIO_STYLESHEETS = [
  "globals.css",
  "hoodlums-brand-theme.css",
  "hoodlums-dashboard-consistency.css",
  "hoodlums-studio-consistency.css",
  "allocation-mobile-tabs.css",
  "mobile-viewport-lock.css",
];

async function source(...parts: string[]) {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("published site route does not inherit the launchpad studio shell", () => {
  it("keeps the shared root layout free of studio navigation and studio stylesheets", async () => {
    const rootLayout = await source("app", "layout.tsx");

    for (const component of STUDIO_COMPONENT_IMPORTS) {
      expect(rootLayout).not.toContain(component);
    }
    for (const stylesheet of STUDIO_STYLESHEETS) {
      expect(rootLayout).not.toContain(stylesheet);
    }
  });

  it("keeps the public site layout free of studio navigation and studio stylesheets", async () => {
    const publicLayout = await source("app", "[slug]", "layout.tsx");

    for (const component of STUDIO_COMPONENT_IMPORTS) {
      expect(publicLayout).not.toContain(component);
    }
    for (const stylesheet of STUDIO_STYLESHEETS) {
      expect(publicLayout).not.toContain(stylesheet);
    }
    expect(publicLayout).toContain("./public-site-reset.css");
  });

  it("keeps the public site reset minimal and free of studio-only rules", async () => {
    const reset = await source("app", "[slug]", "public-site-reset.css");

    expect(reset).not.toContain("sidebar");
    expect(reset).not.toContain("overscroll-behavior-x");
    expect(reset).not.toContain("touch-action");
    expect(reset).not.toContain(".app-shell");
    expect(reset).not.toContain("#launch-studio");
    expect(reset).not.toMatch(/padding-left:\s*\d/);
    // issue #323 part 1: a minimal, generated-page-agnostic overflow clamp
    // on the page shell itself — not the studio's multi-selector viewport
    // lock machinery from mobile-viewport-lock.css, which this test still
    // keeps out of the public reset.
    expect(reset).toContain("overflow-x: hidden;");
  });

  it("still mounts the studio shell and studio stylesheets for the launchpad app routes", async () => {
    const studioLayout = await source("app", "(app)", "layout.tsx");

    for (const component of STUDIO_COMPONENT_IMPORTS) {
      expect(studioLayout).toContain(component);
    }
    for (const stylesheet of STUDIO_STYLESHEETS) {
      expect(studioLayout).toContain(stylesheet);
    }
  });
});
