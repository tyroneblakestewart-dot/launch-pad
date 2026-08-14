import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REOPEN_GENERATED_SITE_EVENT } from "@/components/full-website-generator";

const ROOT = process.cwd();

async function generatorSource() {
  return readFile(path.join(ROOT, "components", "full-website-generator.tsx"), "utf8");
}

async function studioSource() {
  return readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
}

describe("reopening a previously generated site (issue #198)", () => {
  it("exposes a stable reopen event name", () => {
    expect(REOPEN_GENERATED_SITE_EVENT).toBe("launchpad:reopen-generated-site");
  });

  it("lets the studio redisplay a saved generation and adds/removes the listener", async () => {
    const generator = await generatorSource();

    expect(generator).toContain('import { useEffect } from "react"');
    expect(generator).toContain("function onReopen(event: Event)");
    expect(generator).toContain("window.addEventListener(REOPEN_GENERATED_SITE_EVENT, onReopen)");
    expect(generator).toContain("window.removeEventListener(REOPEN_GENERATED_SITE_EVENT, onReopen)");
    expect(
      generator.indexOf('window.addEventListener(REOPEN_GENERATED_SITE_EVENT, onReopen)'),
    ).toBeLessThan(generator.indexOf("return () => {"));
  });

  it("never regenerates via the AI endpoints when reopening", async () => {
    const generator = await generatorSource();
    const onReopenStart = generator.indexOf("function onReopen(event: Event) {");
    const onReopenEnd = generator.indexOf("\n    }\n", onReopenStart);
    const onReopenBody = generator.slice(onReopenStart, onReopenEnd);

    expect(onReopenBody).not.toContain("fetch(");
    expect(onReopenBody).not.toContain("requestGeneratedWebsite");
    expect(onReopenBody).not.toContain("requestFreeGeneratedWebsite");
  });

  it("renders the reopened site through the same renderGeneratedWebsite call used for a fresh generation", async () => {
    const generator = await generatorSource();
    const onGenerateStart = generator.indexOf("async function onGenerate(event: Event) {");
    const onGenerateEnd = generator.indexOf("function onReopen(event: Event) {");
    const onGenerateBody = generator.slice(onGenerateStart, onGenerateEnd);
    const onReopenStart = generator.indexOf("function onReopen(event: Event) {");
    const onReopenBody = generator.slice(onReopenStart);

    // Same source-of-truth guarantee: both a fresh generation and a
    // reopened one run their raw HTML through previewHtmlFor before handing
    // it, and the exact same site/publish payload, to renderGeneratedWebsite.
    expect(onGenerateBody).toContain("const previewHtml = previewHtmlFor(page.html, detail.contractAddress?.trim() || \"\");");
    expect(onGenerateBody).toContain("renderGeneratedWebsite(previewHtml, detail.imageDataUrl || \"\", publishSite,");
    expect(onReopenBody).toContain("const previewHtml = previewHtmlFor(site.generatedSiteHtml, site.contractAddress);");
    expect(onReopenBody).toContain('renderGeneratedWebsite(previewHtml, detail?.imageDataUrl || "", site,');

    // publishSite passed to the fresh-generation render carries the exact
    // html that was just generated, and the reopened render passes the
    // exact stored site object straight through — so whatever the "Publish
    // draft" button submits is provably the same HTML shown in the iframe
    // (inline and, since full screen toggles the same iframe, full screen too).
    expect(onGenerateBody).toContain("publishableSiteFromGeneration(detail, page.html)");
  });

  it("guards reopen against a missing or incomplete stored site", async () => {
    const generator = await generatorSource();
    const onReopenStart = generator.indexOf("function onReopen(event: Event) {");
    const onReopenEnd = generator.indexOf("\n    }\n", onReopenStart);
    const onReopenBody = generator.slice(onReopenStart, onReopenEnd);

    expect(onReopenBody).toContain("if (!site || !site.generatedSiteHtml) return;");
  });

  it("exports PublishableSitePayload so the studio can build a compatible reopen payload", async () => {
    const generator = await generatorSource();
    expect(generator).toContain("export type PublishableSitePayload");
  });

  it("wires the studio to dispatch a reopen event with the project's stored HTML", async () => {
    const studio = await studioSource();

    expect(studio).toContain(
      'import {\n  REOPEN_GENERATED_SITE_EVENT,\n  type PublishableSitePayload,\n} from "@/components/full-website-generator"',
    );
    expect(studio).toContain("function reopenGeneratedSite(target: TokenProject)");
    // The generatedSiteHtml guard lives in publishableSiteFromProject, which
    // reopenGeneratedSite calls and bails out on before dispatching anything.
    expect(studio).toContain("if (!target.generatedSiteHtml) return null;");
    expect(studio).toContain("const site = publishableSiteFromProject(target);");
    expect(studio).toContain("if (!site) return;");
    expect(studio).toContain("generatedSiteHtml: target.generatedSiteHtml");
    expect(studio).toContain(
      "new CustomEvent(REOPEN_GENERATED_SITE_EVENT, {\n      detail: { imageDataUrl: target.heroImage, site },\n    })",
    );
  });

  it("reopens automatically when a saved project is loaded, without regenerating", async () => {
    const studio = await studioSource();
    const loadProjectStart = studio.indexOf("async function loadProject(entry: SavedProjectIndexEntry) {");
    const loadProjectEnd = studio.indexOf("\n  async function handleImage", loadProjectStart);
    const loadProjectBody = studio.slice(loadProjectStart, loadProjectEnd);

    expect(loadProjectBody).toContain("reopenGeneratedSite(saved)");
    expect(loadProjectBody).not.toContain("launchpad:generate-site");
  });

  it("gives the user a manual reopen control gated on having a generated site", async () => {
    const studio = await studioSource();

    expect(studio).toContain("{project.generatedSiteHtml && (");
    expect(studio).toContain("reopen-generated-site-button");
    expect(studio).toContain("onClick={() => reopenGeneratedSite(project)}");
    expect(studio).toContain("Reopen generated site");
  });
});
