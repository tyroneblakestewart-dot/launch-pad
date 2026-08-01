import { describe, expect, it } from "vitest";
import { publishableSiteFromProject } from "@/components/token-studio";
import { applyGeneratedSiteCapture } from "@/lib/generated-site-capture";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import type { TokenProject } from "@/lib/types";

function validGeneratedHtml() {
  const padding = "Original responsive campaign card content. ".repeat(110);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Original token page</title>
<style>body{margin:0;font-family:Arial,sans-serif}</style>
</head>
<body>
<header><nav>Home About Roadmap Community</nav></header>
<section id="hero"><h1>Welcome</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Uploaded artwork"></section>
<section id="about"><h2>About</h2><p>${padding}</p></section>
<section id="tokenomics"><h2>Tokenomics</h2><p>Supply details.</p></section>
<section id="roadmap"><h2>Roadmap</h2><p>What happens next.</p></section>
<section id="how-to-buy"><h2>How to buy</h2><ol><li>Connect</li><li>Swap</li></ol></section>
<section id="community"><h2>Community</h2><p>Join in.</p></section>
<script>document.querySelector('img').addEventListener('click',function(){});</script>
</body>
</html>`;
}

function baseProject(): TokenProject {
  return {
    id: "project-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "draft",
    chain: "robinhood",
    name: "Test Token",
    ticker: "TEST",
    description: "A token with a description long enough to pass validation checks.",
    supply: "1000000000",
    decimals: 18,
    websiteSlug: "test-token",
    contractAddress: "",
    xHandle: "",
    telegram: "",
    heroImage: "data:image/png;base64,aaaa",
    theme: "hoodlums",
  };
}

describe("persisting generated site HTML onto the saved project (issue #200)", () => {
  it("writes generatedSiteHtml onto the project when a complete full-page site is generated", () => {
    const html = validGeneratedHtml();
    const project = baseProject();

    const updated = applyGeneratedSiteCapture(project, { fullPage: true, html });

    expect(updated.generatedSiteHtml).toBe(html);
    expect(updated.generatedSiteVersion).toBe(1);
    expect(updated).not.toBe(project);

    const again = applyGeneratedSiteCapture(updated, { fullPage: true, html });
    expect(again.generatedSiteVersion).toBe(2);
  });

  it("never writes generatedSiteHtml from a partial style-only event or incomplete HTML", () => {
    const project = baseProject();

    const styleOnly = applyGeneratedSiteCapture(project, { fullPage: false, html: validGeneratedHtml() });
    expect(styleOnly).toBe(project);
    expect(styleOnly.generatedSiteHtml).toBeUndefined();

    const incomplete = applyGeneratedSiteCapture(project, { fullPage: true, html: "<html>too short</html>" });
    expect(incomplete).toBe(project);
    expect(incomplete.generatedSiteHtml).toBeUndefined();
  });

  it("survives a save-to-storage and reload round trip byte-for-byte", () => {
    const html = validGeneratedHtml();
    const generated = applyGeneratedSiteCapture(baseProject(), { fullPage: true, html });

    // Simulate the studio's localStorage persistence and a fresh page load
    // reading it back (components/token-studio.tsx STORAGE_KEY round trip).
    const serialized = JSON.stringify([generated]);
    const reloaded = (JSON.parse(serialized) as TokenProject[])[0];

    expect(reloaded.generatedSiteHtml).toBe(html);
    expect(reloaded.generatedSiteHtml).toEqual(generated.generatedSiteHtml);
  });

  it("reopen and publish both read the exact HTML persisted on the reloaded project, without any AI call", () => {
    const html = validGeneratedHtml();
    const generated = applyGeneratedSiteCapture(baseProject(), { fullPage: true, html });
    const reloaded = (JSON.parse(JSON.stringify([generated])) as TokenProject[])[0];

    const site = publishableSiteFromProject(reloaded);

    expect(site).not.toBeNull();
    expect(site?.generatedSiteHtml).toBe(html);
    expect(site?.slug).toBe(reloaded.websiteSlug);
  });

  it("has nothing to reopen or publish for a project that was never generated", () => {
    expect(publishableSiteFromProject(baseProject())).toBeNull();
  });
});
