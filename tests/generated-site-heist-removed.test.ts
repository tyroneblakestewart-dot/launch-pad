import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function studioSource() {
  return readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
}

// Issue #318: closing (or never opening) the generated-site overlay used to
// reveal a hardcoded "heist" mock with the user's artwork dropped into it —
// something a user could easily mistake for their own generated site. The
// studio's preview panel must never render that mock again; it shows only an
// honest empty state or a reopen card for the real, generated HTML.
describe("the hardcoded heist mock no longer stands in for the generated-site preview (issue #318)", () => {
  it("never renders any of the heist copy or markers", async () => {
    const studio = await studioSource();

    for (const heistMarker of [
      "initiate_heist",
      "JOIN THE HEIST",
      "STEAL THE MEMES",
      "// THE LOOT",
      "// THE PLAN",
      "THE HEIST",
      "TAKE FROM THE RICH",
      "GIVE TO THE MEMES",
      "matrix-rain",
      "preview-nav",
      "hero-section",
      "graffiti-ticker",
      "hooded-placeholder",
      "roadmap-grid",
      "ticker-tape",
    ]) {
      expect(studio).not.toContain(heistMarker);
    }
  });

  it("shows an honest empty state before any site has been generated", async () => {
    const studio = await studioSource();

    expect(studio).toContain("{!project.generatedSiteHtml && (");
    expect(studio).toContain("site-preview-empty-state");
    expect(studio).toContain("Your generated site will appear here");
  });

  it("shows a reopen card, not the mock, once a site has been generated", async () => {
    const studio = await studioSource();

    expect(studio).toContain("{project.generatedSiteHtml && (");
    expect(studio).toContain("site-preview-reopen-card");
    expect(studio).toContain("reopen-generated-site-button");
    expect(studio).toContain("onClick={() => reopenGeneratedSite(project)}");
    expect(studio).toContain("Reopen generated site");
  });

  it("retires the DexscreenerSiteSection mount, which only anchored itself inside the removed mock", async () => {
    const page = await readFile(path.join(ROOT, "app", "(app)", "page.tsx"), "utf8");

    expect(page).not.toContain("DexscreenerSiteSection");
  });
});
