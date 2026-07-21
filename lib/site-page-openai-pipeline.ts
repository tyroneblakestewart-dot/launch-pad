import { ARTWORK_PLACEHOLDER, parseGeneratedPagePayload } from "@/lib/generated-site-page";
import {
  TOKEN_LANDING_PAGE_GENERATOR_PREFIX,
  extractOutputText,
  type NormalisedGenerateSiteStyleRequest,
  type OpenAIResponse,
} from "@/lib/server/generate-site-style";
import {
  getFusionBriefIds,
  type ArtworkIdentity,
  type FusionBriefIds,
} from "@/lib/site-style-openai-pipeline";

export const NO_URL_PRESENTATION_BRIEF =
  "No external inspiration website was supplied. Build an original presentation directly from the artwork identity, using a clear modern landing-page information architecture.";

export const GENERATED_PAGE_SCHEMA = {
  type: "object",
  properties: {
    html: { type: "string", minLength: 3500, maxLength: 90000 },
    artworkBriefId: { type: "string", pattern: "^art-[0-9a-f]{8}$" },
    inspirationBriefId: { type: "string", pattern: "^url-[0-9a-f]{8}$" },
  },
  required: ["html", "artworkBriefId", "inspirationBriefId"],
  additionalProperties: false,
} as const;

function artworkBriefLines(identity: ArtworkIdentity): string[] {
  return [
    `Dominant colours: ${identity.dominantColours}`,
    `Energy: ${identity.memeEnergy}`,
    `Subject and iconic elements: ${identity.subjectAndIcons}`,
    `Visible text: ${identity.visibleText}`,
    `Typography personality: ${identity.typographyPersonality}`,
    `Copy voice: ${identity.copyVoice}`,
    `Non-negotiables: ${identity.nonNegotiables}`,
  ];
}

export function buildGeneratedSitePageRequestBody(
  request: NormalisedGenerateSiteStyleRequest,
  model: string,
  artworkIdentity: ArtworkIdentity,
  inspirationAnalysis = NO_URL_PRESENTATION_BRIEF,
) {
  const ids = getFusionBriefIds(artworkIdentity, inspirationAnalysis);
  const developerPrompt = [
    TOKEN_LANDING_PAGE_GENERATOR_PREFIX,
    "",
    "PRIVATE FULL-PAGE EXECUTION RULES:",
    "- Return a complete original single-file HTML document inside the strict JSON schema.",
    "- The generated document is rendered directly in a sandboxed iframe. It is not a theme for an existing Hoodlums template.",
    "- Never reuse the Hoodlums launchpad's black terminal dashboard, heist wording, matrix rain, Tokenomics shell or Dexscreener shell unless the uploaded artwork itself unmistakably requires those choices.",
    "- Artwork owns the page identity: palette, imagery, subject treatment, emotional tone, visual motifs and copy personality.",
    "- The inspiration brief owns presentation: information architecture, navigation density, hero composition, card/grid behaviour, spacing, type scale, interaction rhythm and section pacing.",
    "- Fuse both sources into one coherent result. Do not place the artwork inside a generic template and do not recolour a copy of the inspiration brand.",
    "- Use original branding and original copy. Never reproduce the inspiration website's name, logo, product copy, proprietary assets, exact trade dress or source code.",
    "- The HTML must contain inline CSS and inline JavaScript. No external JavaScript, iframes, objects or embeds.",
    "- Google Fonts are allowed. All other visuals must be CSS or the uploaded artwork placeholder.",
    `- Use ${ARTWORK_PLACEHOLDER} as the src for the main uploaded image and any intentionally repeated artwork elements. Do not output the image data itself.`,
    "- Include responsive, genuinely different desktop and mobile layouts.",
    "- Required section IDs: hero, about, tokenomics, roadmap, how-to-buy, community.",
    "- Include a useful header/navigation, a strong hero, multiple presentation patterns, clear CTA hierarchy, animated but readable interactions and at least one artwork click easter egg.",
    "- Echo both supplied brief IDs exactly in artworkBriefId and inspirationBriefId.",
    "- Output only the schema-compliant JSON object.",
  ].join("\n");

  const userPrompt = [
    "Build the finished token landing page now.",
    `Project name: ${request.name}`,
    `Ticker: ${request.ticker}`,
    `Project story: ${request.description}`,
    "",
    `VERIFIED ARTWORK IDENTITY [${ids.artworkBriefId}]:`,
    ...artworkBriefLines(artworkIdentity),
    "END ARTWORK IDENTITY.",
    "",
    `VERIFIED INSPIRATION PRESENTATION [${ids.inspirationBriefId}]:`,
    inspirationAnalysis,
    "END INSPIRATION PRESENTATION.",
    "",
    "SYNTHESIS REQUIREMENT:",
    "Make the subject and colours feel native to the uploaded artwork while making the page structure and browsing experience recognisably informed by the inspiration brief.",
    "For retail or marketplace inspiration, translate product discovery, campaign cards, category navigation and promotional rhythm into token storytelling sections rather than falling back to a crypto terminal.",
    "For editorial, entertainment or app inspiration, translate that site's presentation grammar into the required token sections without copying its brand.",
  ].join("\n");

  return {
    model,
    store: false,
    max_output_tokens: 12_000,
    input: [
      {
        role: "developer",
        content: [{ type: "input_text", text: developerPrompt }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: userPrompt },
          { type: "input_image", image_url: request.imageDataUrl, detail: "high" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "generated_token_landing_page",
        strict: true,
        schema: GENERATED_PAGE_SCHEMA,
      },
    },
  };
}

export function parseGeneratedSitePageResponse(
  response: OpenAIResponse,
  expectedIds: FusionBriefIds,
) {
  const text = extractOutputText(response);
  if (!text) return null;
  try {
    return parseGeneratedPagePayload(JSON.parse(text) as unknown, expectedIds);
  } catch {
    return null;
  }
}
