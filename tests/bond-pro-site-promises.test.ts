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
  it("keeps the approved price while removing or marking the unbuilt claims", () => {
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
      "[token].hoodlums.dev subdomain — coming soon",
      "Premium bespoke AI design",
      "Full HTML export — coming soon; publish at hoodlums.dev/slug today",
      "Dexscreener chart + holder stats",
    ]);
  });

  it("keeps client and server project-proof normalization identical", () => {
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

  it("keeps free-template generation available and gates only the bespoke AI route", async () => {
    const freeRoute = await source(
      "app",
      "api",
      "generate-free-site",
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

    expect(freeRoute).not.toContain("authoriseBespokeSiteGeneration");
    expect(bespokeRoute).toContain("authoriseBespokeSiteGeneration");
    expect(bespokeRoute).toContain('code: "bespoke-plan-required"');
    expect(bridge).toContain("createUnsignedBespokeSiteAccessProof");
    expect(bridge).toContain("accessProof: { ...proof, signature }");
    expect(
      bespokeRoute.indexOf(
        "const authorisation = await authoriseBespokeSiteGeneration",
      ),
    ).toBeLessThan(
      bespokeRoute.indexOf("const ai = resolveAIResponsesRuntime"),
    );
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

  it("keeps the admin subscriber label for the permanent paid tier", () => {
    expect(SUBSCRIBER_TIER_LABEL.bond_pro_site).toBe("Bond+Pro Site");
  });
});
