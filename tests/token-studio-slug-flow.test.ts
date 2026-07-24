import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("Token studio save flow wiring", () => {
  it("validates and checks for collisions before persisting, and shows hoodlums.dev", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");

    expect(studio).toContain('import { findSlugCollision, slugify, validateSlug } from "@/lib/slug"');

    expect(studio).toContain("const validation = validateSlug(slug)");
    expect(studio).toContain("if (!validation.valid) {");
    expect(studio).toContain("setNotice(validation.reason)");

    expect(studio).toContain("const collision = findSlugCollision(projects, slug, project.id)");
    expect(studio).toContain("if (collision) {");

    expect(studio.indexOf("return false")).toBeGreaterThan(-1);
    expect(studio.indexOf("return false")).toBeLessThan(studio.indexOf("persist(nextProjects)"));

    expect(studio).toContain("if (!saveProject(\"prepared\")) return;");

    expect(studio).toContain("<span>hoodlums.dev/</span>");
    expect(studio).not.toContain("launchpad.site/");
  });

  it("captures the generated site HTML from the site-generated event instead of scraping the DOM", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");

    expect(studio).toContain('window.addEventListener("launchpad:site-generated", onSiteGenerated)');
    expect(studio).toContain("isCompleteGeneratedPageHtml(detail.html)");
    expect(studio).toContain("generatedSiteHtml: html");
    expect(studio).not.toContain("document.querySelector(\".full-generated-page-frame\")");
  });

  it("clears the captured generated site HTML when the token identity changes", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");

    expect(studio).toContain('const IDENTITY_KEYS = new Set<keyof TokenProject>(["name", "ticker", "heroImage"]);');
    expect(studio).toContain("const identityChanged = IDENTITY_KEYS.has(key) && current[key] !== value");
    expect(studio).toContain("generatedSiteHtml: identityChanged ? null : current.generatedSiteHtml");
  });
});
