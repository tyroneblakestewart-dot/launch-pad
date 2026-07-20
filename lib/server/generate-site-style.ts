export type GenerateSiteStyleRequestBody = {
  name?: unknown;
  ticker?: unknown;
  description?: unknown;
  imageDataUrl?: unknown;
};

export type NormalizedGenerateSiteStyleInput = {
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

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const MAX_STYLE_IMAGE_DATA_URL_LENGTH = 3_000_000;

export const ARTWORK_SITE_STYLE_SCHEMA = {
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

function stringField(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) || fallback : fallback;
}

export function normalizeGenerateSiteStyleInput(
  value: unknown,
): ValidationResult<NormalizedGenerateSiteStyleInput> {
  const body = value && typeof value === "object" && !Array.isArray(value)
    ? (value as GenerateSiteStyleRequestBody)
    : {};

  const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl.trim() : "";
  if (
    !imageDataUrl.startsWith("data:image/") ||
    imageDataUrl.length > MAX_STYLE_IMAGE_DATA_URL_LENGTH
  ) {
    return { ok: false, error: "A valid optimised artwork image is required." };
  }

  return {
    ok: true,
    value: {
      name: stringField(body.name, "Untitled token", 40),
      ticker: stringField(body.ticker, "TOKEN", 12),
      description: stringField(body.description, "Community token project", 500),
      imageDataUrl,
    },
  };
}

export function buildArtworkStylePrompt(input: NormalizedGenerateSiteStyleInput): string {
  return [
    "You are an expert web art director for distinctive crypto and culture projects.",
    "Analyse the uploaded artwork as the primary design reference. Infer its dominant colours, energy, era, shapes, contrast, composition and visual personality.",
    "Create a website design system that clearly belongs to this artwork. Do not default to hacker, matrix, Robin Hood, green, graffiti or Hoodlums styling unless those qualities are genuinely visible in the uploaded image.",
    "Choose accessible foreground/background contrast. The primary and accent colours must remain recognisable from the artwork.",
    "Choose one layout: split for wide editorial art, poster for portrait characters, gallery for square collectible art, minimal for restrained clean art.",
    "Write a short eyebrow, headline and CTA grounded in the supplied project details. Do not make financial promises.",
    `Project name: ${input.name}`,
    `Ticker: ${input.ticker}`,
    `Description: ${input.description}`,
  ].join("\n");
}

export function buildOpenAIStyleRequest(
  input: NormalizedGenerateSiteStyleInput,
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
          { type: "input_text", text: buildArtworkStylePrompt(input) },
          { type: "input_image", image_url: input.imageDataUrl, detail: "low" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "artwork_site_style",
        strict: true,
        schema: ARTWORK_SITE_STYLE_SCHEMA,
      },
    },
  };
}

export function extractOpenAIOutputText(response: OpenAIResponse): string {
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

export function parseOpenAIStyle(response: OpenAIResponse): Record<string, unknown> | null {
  const text = extractOpenAIOutputText(response);
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
