import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function routeSource() {
  return readFile(path.join(ROOT, "app", "api", "generate-site-page", "route.ts"), "utf8");
}

describe("five-variant full-page route orchestration", () => {
  it("shares artwork/inspiration analysis and fans out five page calls in parallel", async () => {
    const source = await routeSource();
    expect(source).toContain("const [artworkResult, inspirationResult] = await Promise.all");
    expect(source).toContain("SITE_DESIGN_VARIANTS.map((variant) =>");
    expect(source).toContain("const generationResults = await Promise.all");
    expect(source).toContain("buildGeneratedSitePageRequestBody(");
    expect(source).toContain("inspirationAnalysis,\n          variant,");
    expect(source.match(/buildPageArtworkIdentityRequestBody\(/g)).toHaveLength(1);
    expect(source).toContain("variants.length !== SITE_DESIGN_VARIANTS.length");
    expect(source).toContain("haveDistinctVariantLayouts(variants)");
  });

  it("fails the whole request when one generation or parser result is invalid", async () => {
    const source = await routeSource();
    expect(source).toContain("for (let index = 0; index < generationResults.length; index += 1)");
    expect(source).toContain("if (!generation.ok)");
    expect(source).toContain("failed the completeness, safety, identity or variant checks");
    expect(source).not.toContain("partialSuccess");
  });

  it("returns one stable five-item variants payload", async () => {
    const source = await routeSource();
    expect(source).toContain("return NextResponse.json(");
    expect(source).toContain("variants,");
    expect(source).toContain("inspirationUsed: Boolean(input.inspirationUrl)");
  });
});

describe("website-generation protection remains intact", () => {
  it("keeps the shared secret, origin, one rate-limit consumption and AI runtime flow", async () => {
    const source = await routeSource();
    expect(source).toContain("GENERATE_SITE_STYLE_SHARED_SECRET");
    expect(source).toContain("GENERATE_SITE_STYLE_ALLOWED_ORIGIN");
    expect(source).toContain("isGenerateSiteStyleRequestAuthorised(request, sharedSecret, allowedOrigin)");
    expect(source.match(/consumeGenerateSiteStyleRateLimit\(/g)).toHaveLength(1);
    expect(source).toContain("getClientIp(request)");
    expect(source).toContain("resolveAIResponsesRuntime(process.env, getVercelOidcToken(request))");
    expect(source).toContain('"Cache-Control": "no-store"');
    expect(source).toContain("sanitiseProviderDetail");
    expect(source).toContain("Bearer [redacted]");
  });

  it("does not make five browser endpoint requests", async () => {
    const client = await readFile(
      path.join(ROOT, "components", "full-website-generator.tsx"),
      "utf8",
    );
    expect(client.match(/fetch\("\/api\/generate-site-page"/g)).toHaveLength(1);
  });
});
