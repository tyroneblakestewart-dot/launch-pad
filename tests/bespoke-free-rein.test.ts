import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARTWORK_PLACEHOLDER, OPTIONAL_PAGE_SECTIONS, REQUIRED_PAGE_SECTIONS, isCompleteGeneratedPageHtml } from "@/lib/generated-site-page";
import {
  DEFAULT_AI_PRICING_RATES,
  DEFAULT_BESPOKE_SITE_COST_CAP_USD,
  DEFAULT_GPT5_TEXT_RATES,
  isGpt5FlagshipModel,
  readAiPricingRatesForModel,
  readBespokeSiteCostCapUsd,
  validateAiPricingConfig,
} from "@/lib/server/ai-pricing";
import { DEFAULT_BESPOKE_PAGE_MODEL, resolveBespokePageModel } from "@/lib/server/ai-responses-runtime";
import { buildWebsiteGenerationPipeline } from "@/lib/server/system-health-pipeline";
import {
  BESPOKE_PAGE_MAX_OUTPUT_TOKENS,
  BESPOKE_PAGE_REASONING_EFFORT,
  FREE_REIN_ACCEPTANCE_PROFILE,
  NO_URL_PRESENTATION_BRIEF,
  buildGeneratedSitePageRequestBody,
} from "@/lib/site-page-openai-pipeline";
import type { ArtworkIdentity } from "@/lib/site-style-openai-pipeline";

const ROOT = process.cwd();
async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

const ARTWORK: ArtworkIdentity = {
  dominantColours: "Powder blue, charcoal black, steel grey, white and restrained transit red accents.",
  memeEnergy: "Curious London journey energy with a playful child-led sense of movement and discovery.",
  subjectAndIcons: "A child studying a Tube map while standing on a scooter, with route lines, station glass and transport details.",
  visibleText: "Tube map and small London transport labels are visible but should not become the project name.",
  typographyPersonality: "Friendly rounded transport signage with clear bold headings.",
  copyVoice: "Warm, adventurous, direct and optimistic.",
  nonNegotiables: "Keep the child, scooter and route-map story central.",
};

function developerText(body: ReturnType<typeof buildGeneratedSitePageRequestBody>): string {
  const developer = body.input.find((item) => item.role === "developer");
  return developer?.content[0]?.text ?? "";
}

describe("gpt-5 pricing for the bespoke full page", () => {
  it("recognises the flagship gpt-5 (dated or Gateway-prefixed) and nothing else in the family", () => {
    expect(isGpt5FlagshipModel("gpt-5")).toBe(true);
    expect(isGpt5FlagshipModel("openai/gpt-5")).toBe(true);
    expect(isGpt5FlagshipModel("gpt-5-2026-08-07")).toBe(true);
    expect(isGpt5FlagshipModel("gpt-5-mini")).toBe(false);
    expect(isGpt5FlagshipModel("gpt-5-nano")).toBe(false);
    expect(isGpt5FlagshipModel("gpt-5-pro")).toBe(false);
    expect(isGpt5FlagshipModel(null)).toBe(false);
  });

  it("meters gpt-5 at its own text rates and leaves every other model on the shared defaults", () => {
    const gpt5 = readAiPricingRatesForModel("gpt-5", {});
    expect(gpt5).toEqual({ ...DEFAULT_AI_PRICING_RATES, ...DEFAULT_GPT5_TEXT_RATES });
    expect(DEFAULT_GPT5_TEXT_RATES).toEqual({ inputCostUsdPerMillion: 1.25, cachedInputCostUsdPerMillion: 0.125, outputCostUsdPerMillion: 10 });
    expect(readAiPricingRatesForModel("gpt-5-mini", {})).toEqual(DEFAULT_AI_PRICING_RATES);
    expect(readAiPricingRatesForModel("gpt-5", { OPENAI_GPT5_OUTPUT_COST_USD_PER_MILLION: "8" }).outputCostUsdPerMillion).toBe(8);
    // Web-search and image rates are model-independent and still come from the shared vars.
    expect(readAiPricingRatesForModel("gpt-5", { OPENAI_IMAGE_COST_USD_PER_IMAGE: "0.05" }).imageCostUsdPerImage).toBe(0.05);
  });

  it("flags a malformed gpt-5 rate in System Health like any other pricing var", () => {
    expect(validateAiPricingConfig({ OPENAI_GPT5_INPUT_COST_USD_PER_MILLION: "1.25junk" })).toHaveLength(1);
    expect(validateAiPricingConfig({ OPENAI_GPT5_INPUT_COST_USD_PER_MILLION: "1.25" })).toHaveLength(0);
  });

  it("reads the per-site cost cap with a $1.50 default and ignores non-positive or unparsable values", () => {
    expect(DEFAULT_BESPOKE_SITE_COST_CAP_USD).toBe(1.5);
    expect(readBespokeSiteCostCapUsd({})).toBe(1.5);
    expect(readBespokeSiteCostCapUsd({ BESPOKE_SITE_COST_CAP_USD: "2.25" })).toBe(2.25);
    expect(readBespokeSiteCostCapUsd({ BESPOKE_SITE_COST_CAP_USD: "0" })).toBe(1.5);
    expect(readBespokeSiteCostCapUsd({ BESPOKE_SITE_COST_CAP_USD: "cheap" })).toBe(1.5);
  });
});

describe("the bespoke page model", () => {
  it("defaults to gpt-5 on a direct key and to openai/gpt-5 on the Gateway, honouring an env override either way", () => {
    expect(DEFAULT_BESPOKE_PAGE_MODEL).toBe("gpt-5");
    expect(resolveBespokePageModel({}, { source: "openai" })).toBe("gpt-5");
    expect(resolveBespokePageModel({}, { source: "vercel-ai-gateway" })).toBe("openai/gpt-5");
    expect(resolveBespokePageModel({ OPENAI_BESPOKE_PAGE_MODEL: "openai/gpt-5-mini" }, { source: "openai" })).toBe("gpt-5-mini");
    expect(resolveBespokePageModel({ OPENAI_BESPOKE_PAGE_MODEL: "gpt-5-mini" }, { source: "vercel-ai-gateway" })).toBe("openai/gpt-5-mini");
  });

  it("the cost ledger prices each row for the model that answered, not one flat rate", async () => {
    const store = await source("lib", "server", "ai-operation-cost-store.ts");
    expect(store).toContain("const model = extractOpenAIModel(args.response, args.fallbackModel);");
    expect(store).toContain("const rates = args.rates ?? readAiPricingRatesForModel(model);");
  });
});

describe("free-rein bespoke prompt", () => {
  const body = buildGeneratedSitePageRequestBody(
    { name: "Journey", ticker: "RIDE", description: "A community token inspired by finding your route through London.", imageDataUrl: "data:image/png;base64,aGVsbG8=", inspirationUrl: "" },
    "gpt-5",
    ARTWORK,
    NO_URL_PRESENTATION_BRIEF,
  );

  it("runs gpt-5 at medium reasoning with a 32k output budget", () => {
    expect(BESPOKE_PAGE_REASONING_EFFORT).toBe("medium");
    expect(BESPOKE_PAGE_MAX_OUTPUT_TOKENS).toBe(32_000);
    expect(body.model).toBe("gpt-5");
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body.max_output_tokens).toBe(32_000);
  });

  it("hands the model the creative direction and drops the prescriptive design recipes", () => {
    const text = developerText(body);
    expect(text).toContain("CREATIVE DIRECTION IS YOURS:");
    expect(text).toContain("there is no house style to follow beyond the rules on this list");
    expect(text).not.toContain("bright, spacious discovery experience");
    expect(text).not.toContain("at least six original content cards");
    // The shared generator preamble may still *suggest* small easter eggs; the mandatory "at least one artwork click easter egg" rule is gone.
    expect(text).not.toContain("at least one artwork click easter egg");
    expect(text).not.toContain("The artwork is not cyber or terminal themed");
    expect(text).not.toContain("multiple presentation patterns");
  });

  it("keeps every hard rule: safety, responsiveness, originality, palette-true panels, the size limit", () => {
    const text = developerText(body);
    expect(text).toContain("RESPONSIVE & LAYOUT QUALITY REQUIREMENTS (NON-NEGOTIABLE)");
    expect(text).toContain("No external JavaScript, iframes, objects or embeds.");
    expect(text).toContain("Never reproduce the inspiration website's name, logo, product copy, proprietary assets, exact trade dress or source code.");
    expect(text).toContain("Never reuse the Hoodlums launchpad's black terminal dashboard");
    expect(text).toContain("never a hardcoded white card that ignores the theme");
    expect(text).toContain("Aim for 50,000–70,000 characters of HTML in total and never exceed 80,000");
  });

  it("requires only hero, how-to-buy and community; the rest are the model's call", () => {
    expect([...REQUIRED_PAGE_SECTIONS]).toEqual(["hero", "how-to-buy", "community"]);
    expect([...OPTIONAL_PAGE_SECTIONS]).toContain("tokenomics");
    expect(developerText(body)).toContain("Required section IDs: hero, how-to-buy, community.");
    expect(developerText(body)).toContain("a page with three strong sections beats one with six thin ones");
  });

  it("no longer rejects a page on aesthetic grounds — the acceptance profile is empty and the old builder is gone", async () => {
    expect(FREE_REIN_ACCEPTANCE_PROFILE).toEqual({});
    const pipeline = await source("lib", "site-page-openai-pipeline.ts");
    expect(pipeline).not.toContain("buildGeneratedPageAcceptanceProfile");
    expect(pipeline).not.toContain("RETAIL_PRESENTATION_PATTERN");
    const route = await source("app", "api", "generate-site-page", "route.ts");
    expect(route).toContain("const acceptance = FREE_REIN_ACCEPTANCE_PROFILE;");
    expect(route).toContain("const pageModel = resolveBespokePageModel(process.env, ai);");
    expect(route).toContain("buildGeneratedSitePageRequestBody(input, pageModel, artworkIdentity, inspirationAnalysis)");
    expect(route).toContain("const retryWouldPassCap = firstAttemptCost !== null && firstAttemptCost * 2 > bespokeCostCapUsd;");
    expect(route).toContain('kind: "bespoke-cost-cap-held"');
  });
});

describe("a three-section page is a complete page", () => {
  it("accepts a page carrying only the required sections", () => {
    const padding = "Original responsive campaign card content. ".repeat(110);
    const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Original token page</title>
<style>
:root{--ink:#101820;--paper:#f7f9fb}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:var(--paper);color:var(--ink)}section{padding:44px 20px}.grid{display:grid;grid-template-columns:1fr;gap:20px}img{max-width:100%}@media(min-width:700px){.grid{grid-template-columns:repeat(3,1fr)}section{padding:72px 7vw}}
</style>
</head>
<body>
<header><nav>Home Buy Community</nav></header>
<section id="hero"><h1>Move through the city differently</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Uploaded artwork"><button>Explore</button></section>
<section id="how-to-buy"><h2>How to buy</h2><p>${padding}</p><div class="grid"><article>Connect</article><article>Swap</article><article>Join</article></div></section>
<section id="community"><h2>Community</h2><button>Join the conversation</button></section>
<script>document.querySelector('img').addEventListener('click',function(){document.body.classList.toggle('celebrate')});</script>
</body>
</html>`;
    expect(isCompleteGeneratedPageHtml(page)).toBe(true);
    expect(isCompleteGeneratedPageHtml(page.replace('id="how-to-buy"', 'id="buying"'))).toBe(false);
  });
});

describe("website-generation health stage for the bespoke model", () => {
  const control = { key: "website-generation", label: "", description: "", affectedRoutes: "", isolated: false, reason: "", updatedAt: "2026-01-01T00:00:00.000Z" } as never;

  it("is green on gpt-5 with its rates and the cap spelled out", async () => {
    const pipeline = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => control,
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    const stage = pipeline.stages.find((entry) => entry.id === "bespoke-page-model");
    expect(stage?.status).toBe("green");
    expect(stage?.message).toContain("Full page on gpt-5 (medium reasoning, 32,000-token output budget)");
    expect(stage?.message).toContain("$1.25/M in, $10/M out");
    expect(stage?.message).toContain("per-site cost cap $1.50");
  });

  it("is amber when the configured page model has no dedicated rate table, since its cost would be under-reported", async () => {
    const pipeline = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key", OPENAI_BESPOKE_PAGE_MODEL: "gpt-4.1" },
      getServiceControl: async () => control,
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    const stage = pipeline.stages.find((entry) => entry.id === "bespoke-page-model");
    expect(stage?.status).toBe("amber");
    expect(stage?.message).toContain("no dedicated rate table");
  });

  it("documents the new env vars and the activity kind", async () => {
    const env = await source(".env.example");
    expect(env).toContain("OPENAI_BESPOKE_PAGE_MODEL=gpt-5");
    expect(env).toContain("BESPOKE_SITE_COST_CAP_USD=");
    expect(env).toContain("OPENAI_GPT5_OUTPUT_COST_USD_PER_MILLION=10.00");
    const admin = await source("lib", "admin-operations.ts");
    expect(admin).toContain('| "bespoke-cost-cap-held"');
  });
});
