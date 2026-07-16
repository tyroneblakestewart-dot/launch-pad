import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RequestBody = {
  name?: string;
  ticker?: string;
  description?: string;
  imageDataUrl?: string;
};

type OpenAIResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

const schema = {
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

function outputText(response: OpenAIResponse) {
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI style generation is not configured. The browser artwork matcher will be used." },
      { status: 503 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = body.name?.trim().slice(0, 40) || "Untitled token";
  const ticker = body.ticker?.trim().slice(0, 12) || "TOKEN";
  const description = body.description?.trim().slice(0, 500) || "Community token project";
  const imageDataUrl = body.imageDataUrl;

  if (!imageDataUrl?.startsWith("data:image/") || imageDataUrl.length > 3_000_000) {
    return NextResponse.json({ error: "A valid optimised artwork image is required." }, { status: 400 });
  }

  const prompt = [
    "You are an expert web art director for distinctive crypto and culture projects.",
    "Analyse the uploaded artwork as the primary design reference. Infer its dominant colours, energy, era, shapes, contrast, composition and visual personality.",
    "Create a website design system that clearly belongs to this artwork. Do not default to hacker, matrix, Robin Hood, green, graffiti or Hoodlums styling unless those qualities are genuinely visible in the uploaded image.",
    "Choose accessible foreground/background contrast. The primary and accent colours must remain recognisable from the artwork.",
    "Choose one layout: split for wide editorial art, poster for portrait characters, gallery for square collectible art, minimal for restrained clean art.",
    "Write a short eyebrow, headline and CTA grounded in the supplied project details. Do not make financial promises.",
    `Project name: ${name}`,
    `Ticker: ${ticker}`,
    `Description: ${description}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || "gpt-5-mini",
      store: false,
      max_output_tokens: 700,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageDataUrl, detail: "low" },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "artwork_site_style",
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    console.error("OpenAI site-style request failed", response.status, message.slice(0, 500));
    return NextResponse.json(
      { error: "AI analysis was unavailable. The browser artwork matcher will be used." },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as OpenAIResponse;
  const text = outputText(payload);
  try {
    const style = JSON.parse(text) as Record<string, unknown>;
    return NextResponse.json({ style: { ...style, source: "openai" } });
  } catch {
    return NextResponse.json(
      { error: "AI returned an invalid design. The browser artwork matcher will be used." },
      { status: 502 },
    );
  }
}
