export type GenerateSiteStyleRequest = {
  name?: unknown;
  ticker?: unknown;
  description?: unknown;
  imageDataUrl?: unknown;
};

export type NormalisedGenerateSiteStyleRequest = {
  name: string;
  ticker: string;
  description: string;
  imageDataUrl: string;
};

export type OpenAIResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

export type SiteStyle = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  secondary: string;
  accent: string;
  layout: "split" | "poster" | "gallery" | "minimal";
  mood: "bold" | "playful" | "luxury" | "clean" | "retro" | "cyber";
  texture: "none" | "grain" | "glow" | "halftone" | "gradient";
  radius: "sharp" | "soft" | "round";
  eyebrow: string;
  headline: string;
  cta: string;
};

export const MAX_IMAGE_DATA_URL_LENGTH = 3_000_000;

export const SITE_STYLE_SCHEMA = {
  type: "object",
  properties: {
    background: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
    surface: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
    text: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
    muted: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
    primary: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
    secondary: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
    accent: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
    layout: { type: "string", enum: ["split", "poster", "gallery", "minimal"] },
    mood: { type: "string", enum: ["bold", "playful", "luxury", "clean", "retro", "cyber"] },
    texture: { type: "string", enum: ["none", "grain", "glow", "halftone", "gradient"] },
    radius: { type: "string", enum: ["sharp", "soft", "round"] },
    eyebrow: { type: "string", minLength: 3, maxLength: 42 },
    headline: { type: "string", minLength: 8, maxLength: 90 },
    cta: { type: "string", minLength: 3, maxLength: 32 },
  },
  required: [
    "background",
    "surface",
    "text",
    "muted",
    "primary",
    "secondary",
    "accent",
    "layout",
    "mood",
    "texture",
    "radius",
    "eyebrow",
    "headline",
    "cta",
  ],
  additionalProperties: false,
} as const;

const COLOUR_KEYS = [
  "background",
  "surface",
  "text",
  "muted",
  "primary",
  "secondary",
  "accent",
] as const;
const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;
const LAYOUTS = new Set(["split", "poster", "gallery", "minimal"]);
const MOODS = new Set(["bold", "playful", "luxury", "clean", "retro", "cyber"]);
const TEXTURES = new Set(["none", "grain", "glow", "halftone", "gradient"]);
const RADII = new Set(["sharp", "soft", "round"]);

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normaliseGenerateSiteStyleRequest(
  value: GenerateSiteStyleRequest,
): NormalisedGenerateSiteStyleRequest {
  return {
    name: stringValue(value.name).trim().slice(0, 40) || "Untitled token",
    ticker: stringValue(value.ticker).trim().slice(0, 12) || "TOKEN",
    description:
      stringValue(value.description).trim().slice(0, 500) || "Community token project",
    imageDataUrl: stringValue(value.imageDataUrl),
  };
}

export function isValidImageDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("data:image/") &&
    value.length <= MAX_IMAGE_DATA_URL_LENGTH
  );
}

export function buildSiteStylePrompt(
  request: Pick<NormalisedGenerateSiteStyleRequest, "name" | "ticker" | "description">,
): string {
  return [
    "You are an expert web art director for distinctive crypto and culture projects.",
    "Analyse the uploaded artwork as the primary design reference. Infer its dominant colours, energy, era, shapes, contrast, composition and visual personality.",
    "Create a website design system that clearly belongs to this artwork. Do not default to hacker, matrix, Robin Hood, green, graffiti or Hoodlums styling unless those qualities are genuinely visible in the uploaded image.",
    "Choose accessible foreground/background contrast. The primary and accent colours must remain recognisable from the artwork.",
    "Choose one layout: split for wide editorial art, poster for portrait characters, gallery for square collectible art, minimal for restrained clean art.",
    "Write a short eyebrow, headline and CTA grounded in the supplied project details. Do not make financial promises.",
    `Project name: ${request.name}`,
    `Ticker: ${request.ticker}`,
    `Description: ${request.description}`,
  ].join("\n");
}

export function buildOpenAIRequestBody(
  request: NormalisedGenerateSiteStyleRequest,
  model: string,
) {
  return {
    model,
    store: false,
    max_output_tokens: 700,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: buildSiteStylePrompt(request) },
          { type: "input_image", image_url: request.imageDataUrl, detail: "low" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "artwork_site_style",
        strict: true,
        schema: SITE_STYLE_SCHEMA,
      },
    },
  };
}

export function extractOutputText(response: OpenAIResponse): string {
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

export function isSiteStyle(value: unknown): value is SiteStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;

  if (!COLOUR_KEYS.every((key) => typeof item[key] === "string" && HEX_COLOUR.test(item[key]))) {
    return false;
  }
  if (typeof item.layout !== "string" || !LAYOUTS.has(item.layout)) return false;
  if (typeof item.mood !== "string" || !MOODS.has(item.mood)) return false;
  if (typeof item.texture !== "string" || !TEXTURES.has(item.texture)) return false;
  if (typeof item.radius !== "string" || !RADII.has(item.radius)) return false;

  const eyebrow = typeof item.eyebrow === "string" ? item.eyebrow : "";
  const headline = typeof item.headline === "string" ? item.headline : "";
  const cta = typeof item.cta === "string" ? item.cta : "";
  return (
    eyebrow.length >= 3 &&
    eyebrow.length <= 42 &&
    headline.length >= 8 &&
    headline.length <= 90 &&
    cta.length >= 3 &&
    cta.length <= 32
  );
}

export function parseSiteStyleResponse(response: OpenAIResponse): SiteStyle | null {
  const text = extractOutputText(response);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isSiteStyle(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
