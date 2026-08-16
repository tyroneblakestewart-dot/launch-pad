import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUBSCRIBER_TIER_LABEL } from "@/lib/admin-operations";
import { hashBespokeSiteProject } from "@/lib/bespoke-site-access";
import { LAUNCH_PATH_OPTIONS } from "@/lib/launch-paths";
import { normaliseGenerateSiteStyleRequest } from "@/lib/server/generate-site-style";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Bond + Pro Site promise audit", () => {
  it("keeps the approved price and marks the implemented subdomain promise live", () => {
    const plan = LAUNCH_PATH_OPTIONS.find(
      (option) => option.id === "bond-pro-site",
    );

    expect(plan).toMatchObject({
      price: "$10 · one-off",
      tagline: "Your token. Your premium design. Your brand.",
    });
    expect(plan?.tagline.toLowerCase()).not.toContain("domain");
    expect(plan?.bullets).toEqual([
      "Everything in Bond + Site",
      "[token].hoodlums.dev subdomain",
      "Premium bespoke AI design",
      "Full HTML export",
      "Publish at slug.hoodlums.dev",
      "Dexscreener chart + holder stats",
    ]);
    expect(plan?.bullets.some((bullet) => bullet.toLowerCase().includes("coming soon"))).toBe(false);
    expect(plan?.bullets).not.toContain("Publish at hoodlums.dev/slug");
  });

  it("keeps client and server project-challenge normalization identical", () => {
    const raw = {
      name: `  ${"A".repeat(50)}  `,
      ticker: ` ${"T".repeat(20)} `,
      description: ` ${"story ".repeat(100)} `,
      inspirationUrl: ` https://example.com/${"x".repeat(520)} `,
      imageDataUrl: "data:image/png;base64,ignored-by-proof",
    };

    expect(hashBespokeSiteProject(raw)).toBe(
      hashBespokeSiteProject(normaliseGenerateSiteStyleRequest(raw)),
    );
  });

  it("keeps free-template generation open and wraps only the bespoke route in paid wallet auth", async () => {
    const freeRoute = await source(
      "app",
      "api",
      "generate-free-site",
      "route.ts",
    );
    const challengeRoute = await source(
      "app",
      "api",
      "generate-site-page",
      "challenge",
      "route.ts",
    );
    const bespokeRoute = await source(
      "app",
      "api",
      "generate-site-page",
      "route.ts",
    );
    const bridge = await source(
      "components",
      "generate-site-style-auth-bridge.tsx",
    );
    const premiumController = await source(
      "components",
      "bespoke-site-premium-controller.tsx",
    );

    expect(freeRoute).not.toContain("authoriseBespokeSiteGeneration");
    expect(freeRoute).not.toContain("issueBespokeSiteGenerationChallenge");
    expect(challengeRoute).toContain("issueBespokeSiteGenerationChallenge");
    expect(challengeRoute).toContain("isGenerateSiteStyleRequestAuthorised");
    expect(challengeRoute).toContain("consumeBespokeSiteChallengeRateLimit");
    expect(bespokeRoute).toContain("authoriseBespokeSiteGeneration");
    expect(bespokeRoute).toContain('code: "bespoke-plan-required"');
    expect(bridge).toContain('"/api/generate-site-page/challenge"');
    expect(bridge).toContain("challenge.message");
    expect(bridge).toContain("challengeId: challenge.challengeId");
    expect(bridge).toContain("nonce: challenge.nonce");
    expect(bridge).toContain("signature");
    expect(bridge).not.toContain("createUnsignedBespokeSiteAccessProof");
    expect(premiumController).toContain("PREMIUM · GENERATE BESPOKE AI SITE");
    expect(premiumController).toContain(
      'storeLaunchPathPreset(detail?.checkoutPlan || "bond-pro-site")',
    );
    expect(premiumController).toContain(".change-plan-button");
    expect(
      bespokeRoute.indexOf(
        "const authorisation = await authoriseBespokeSiteGeneration",
      ),
    ).toBeLessThan(
      bespokeRoute.indexOf("const ai = resolveAIResponsesRuntime"),
    );
  });

  it("keeps the paid responsive prompt and mechanical validator intact around the new gate", async () => {
    const prompt = await source("lib", "site-page-openai-pipeline.ts");
    const validator = await source("lib", "generated-site-page.ts");

    expect(prompt).toContain(
      "RESPONSIVE & LAYOUT QUALITY REQUIREMENTS (NON-NEGOTIABLE)",
    );
    expect(prompt).toContain("390px, 768px and 1280px+");
    expect(prompt).toContain("roughly 1100-1300px");
    expect(prompt).toContain("no element may be wider than the viewport");
    expect(prompt).toContain("prefers-reduced-motion");
    expect(prompt).toContain("inline CSS and inline JavaScript");
    expect(validator).toContain("export function isCompleteGeneratedPageHtml");
    expect(validator).toContain("function hasResponsiveBaseline");
    expect(validator).toContain("MEDIA_QUERY_PATTERN");
    expect(validator).toContain("RESPONSIVE_UNIT_PATTERN");
  });

  it("gives free and bespoke generations the same publish flow without mounting a second preview", async () => {
    const generator = await source(
      "components",
      "full-website-generator.tsx",
    );
    const generationStart = generator.indexOf(
      "async function onGenerate(event: Event) {",
    );
    const generationEnd = generator.indexOf(
      "function onReopen(event: Event) {",
      generationStart,
    );
    const generation = generator.slice(generationStart, generationEnd);

    expect(generation).toContain('mode === "bespoke"');
    expect(generation).toContain("requestGeneratedWebsite(detail");
    expect(generation).toContain("requestFreeGeneratedWebsite(detail");
    expect(generation.match(/renderGeneratedWebsite\(previewHtml/g)).toHaveLength(1);
    expect(generator).toContain("publishDraft(publishSite)");
    expect(generator).toContain("makePublishedSiteLive(publishSite)");
    expect(generator).toContain("Publish draft");
    expect(generator).toContain("Go live");
    expect(generator).not.toContain("Export full HTML");
    expect(generator.match(/document\.createElement\("iframe"\)/g)).toHaveLength(1);
  });

  it("renders Dexscreener and holder surfaces for bespoke public pages", async () => {
    const publicPage = await source("app", "[slug]", "page.tsx");

    expect(publicPage).toContain("<PublicDexscreenerSection");
    expect(publicPage).toContain(
      "!isFreeSiteTemplate && site.contractAddress",
    );
    expect(publicPage).toContain("<TokenHolderStats");
    expect(publicPage).toContain(
      "for both pipelines whenever a contract address is on record",
    );
  });

  it("keeps one-off access outside the expiring subscription lifecycle", async () => {
    const lifecycle = await source(
      "lib",
      "server",
      "subscription-lifecycle.ts",
    );
    const payments = await source("lib", "server", "plan-payments.ts");

    expect(lifecycle).toContain("WHERE tier IN ('pro', 'pro_bundle')");
    expect(lifecycle).not.toContain(
      "WHERE tier IN ('bond_pro_site', 'pro', 'pro_bundle')",
    );
    expect(payments).toContain("if (isSubscriptionPlan(payment.plan))");
    expect(payments).toContain("definition.subscriptionTier");
  });

  it("keeps the admin subscriber label and shows the server gate decision", async () => {
    const subscribers = await source(
      "components",
      "admin-subscribers-section.tsx",
    );
    expect(SUBSCRIBER_TIER_LABEL.bond_pro_site).toBe("Bond+Pro Site");
    expect(subscribers).toContain("Bespoke AI site");
    expect(subscribers).toContain("Allowed by server entitlement");
    expect(subscribers).toContain("Blocked · upgrade or renew");
  });
});
