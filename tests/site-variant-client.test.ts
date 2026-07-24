import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSelectedSiteGeneratedEventDetail,
  shouldAcceptActiveFrameMessage,
} from "@/components/full-website-generator";
import {
  getDefaultGeneratedSiteVariant,
  selectGeneratedSiteVariant,
  type GeneratedSiteVariant,
} from "@/lib/generated-site-variants";
import { buildPublicGeneratedSiteFromProject } from "@/lib/public-site";
import type { TokenProject } from "@/lib/types";

const ROOT = process.cwd();

const variants: GeneratedSiteVariant[] = [
  { id: "editorial-poster", label: "Editorial Poster", description: "Editorial", html: "<html>one</html>" },
  { id: "cinematic-showcase", label: "Cinematic Showcase", description: "Cinematic", html: "<html>two</html>" },
];

describe("selected site variant helpers", () => {
  it("uses the first variant by default and switches locally by ID", () => {
    expect(getDefaultGeneratedSiteVariant(variants)?.id).toBe("editorial-poster");
    expect(selectGeneratedSiteVariant(variants, "cinematic-showcase")?.html).toBe("<html>two</html>");
    expect(selectGeneratedSiteVariant(variants, "missing")).toBeNull();
  });

  it("includes the chosen HTML and variant metadata in the existing site-generated event detail", () => {
    expect(buildSelectedSiteGeneratedEventDetail(variants[1], true)).toEqual({
      style: { source: "openai", inspirationUsed: true },
      fullPage: true,
      html: "<html>two</html>",
      variantId: "cinematic-showcase",
      variantLabel: "Cinematic Showcase",
      variantDescription: "Cinematic",
    });
  });

  it("accepts height messages only from the active large iframe", () => {
    const active = {};
    const thumbnail = {};
    expect(shouldAcceptActiveFrameMessage(active, active)).toBe(true);
    expect(shouldAcceptActiveFrameMessage(thumbnail, active)).toBe(false);
    expect(shouldAcceptActiveFrameMessage(active, null)).toBe(false);
  });
});

describe("five-preview client wiring", () => {
  it("renders real sandboxed iframe thumbnails and changes selection without another fetch", async () => {
    const selector = await readFile(
      path.join(ROOT, "components", "generated-site-variant-selector.tsx"),
      "utf8",
    );
    const generator = await readFile(
      path.join(ROOT, "components", "full-website-generator.tsx"),
      "utf8",
    );

    expect(selector).toContain("variants.map");
    expect(selector).toContain("<iframe");
    expect(selector).toContain('sandbox=""');
    expect(selector).toContain("USE THIS DESIGN");
    expect(selector).toContain("aria-pressed={selected}");
    expect(generator).toContain("<GeneratedSiteVariantSelector");
    expect(generator).toContain("onSelect={(variant) => selectVariant(variant)}");
    expect(generator).toContain("selectGeneratedSiteVariant(variants, selectedId)");
    expect(generator.match(/fetch\("\/api\/generate-site-page"/g)).toHaveLength(1);
  });

  it("default-selects design one and dispatches the same event on later selection", async () => {
    const generator = await readFile(
      path.join(ROOT, "components", "full-website-generator.tsx"),
      "utf8",
    );
    expect(generator).toContain("getDefaultGeneratedSiteVariant(page.variants)");
    expect(generator).toContain('new CustomEvent("launchpad:site-generated"');
    expect(generator).toContain("buildSelectedSiteGeneratedEventDetail(variant");
    expect(generator).toContain("event.source, activeWindow");
  });
});

describe("chosen variant project persistence", () => {
  it("captures and clears selected variant metadata with generated HTML", async () => {
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
    expect(studio).toContain("generatedSiteVariantId: variant.id");
    expect(studio).toContain("generatedSiteVariantLabel: variant.label");
    expect(studio).toContain("generatedSiteVariantId: identityChanged ? null");
    expect(studio).toContain("generatedSiteVariantLabel: identityChanged ? null");
    expect(studio).toContain('"description",');
  });

  it("carries only the chosen variant metadata into the public record payload", () => {
    const project: TokenProject = {
      id: "one",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      status: "draft",
      chain: "robinhood",
      name: "Hoodlums",
      ticker: "HOOD",
      description: "Artwork-driven token project description.",
      supply: "1000000000",
      decimals: 18,
      websiteSlug: "hoodlums",
      contractAddress: "",
      xHandle: "",
      telegram: "",
      heroImage: "data:image/png;base64,AAAA",
      theme: "hoodlums",
      generatedSiteHtml: "<html>chosen</html>",
      generatedSiteVersion: 2,
      generatedSiteVariantId: "kinetic-collage",
      generatedSiteVariantLabel: "Kinetic Collage",
    };
    const record = buildPublicGeneratedSiteFromProject(project);
    expect(record.generatedSiteHtml).toBe("<html>chosen</html>");
    expect(record.generatedSiteVariantId).toBe("kinetic-collage");
    expect(record.generatedSiteVariantLabel).toBe("Kinetic Collage");
    expect(record).not.toHaveProperty("generatedSiteVariants");
  });
});
