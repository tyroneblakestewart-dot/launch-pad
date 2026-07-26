import { NextResponse } from "next/server";
import {
  buildFreeSiteDesignRequestBody,
  parseFreeSiteDesignResponse,
} from "@/lib/free-site-openai-pipeline";
import { renderFreeSiteTemplate } from "@/lib/free-site-template";
import {
  ARTWORK_PLACEHOLDER,
  isCompleteGeneratedPageHtml,
} from "@/lib/generated-site-page";
import {
  getVercelOidcToken,
  resolveAIResponsesRuntime,
  type AIResponsesRuntime,
} from "@/lib/server/ai-responses-runtime";
import {
  GENERATE_SITE_STYLE_LIMIT,
  consumeGenerateSiteStyleRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";
import {
  isValidImageDataUrl,
  normaliseGenerateSiteStyleRequest,
  type GenerateSiteStyleRequest,
  type OpenAIResponse,
} from "@/lib/server/generate-site-style";
import { buildPageArtworkIdentityRequestBody } from "@/lib/site-page-openai-pipeline";
import { requestArtworkIdentity } from "@/lib/server/artwork-identity-request";

export const runtime = "nodejs";
export const maxDuration = 60;

const ARTWORK_TIMEOUT_MS = 18_000;
const DESIGN_TIMEOUT_MS = 35_000;

type ProviderResult =
  | { ok: true; payload: OpenAIResponse }
  | { ok: false; kind: "network" | "http" | "invalid"; status?: number };

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

async function requestProvider(
  ai: AIResponsesRuntime,
  body: unknown,
  timeoutMs: number,
): Promise<ProviderResult> {
  let response: Response;
  try {
    response = await fetch(ai.responsesUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, kind: "network" };
  }

  if (!response.ok) {
    return { ok: false, kind: "http", status: response.status };
  }

  try {
    return { ok: true, payload: (await response.json()) as OpenAIResponse };
  } catch {
    return { ok: false, kind: "invalid" };
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function substituteArtwork(html: string, artworkDataUrl: string): string {
  const substituted = html.replaceAll(
    ARTWORK_PLACEHOLDER,
    escapeHtmlAttribute(artworkDataUrl),
  );
  if (substituted.includes(ARTWORK_PLACEHOLDER)) {
    throw new Error("The free-site artwork could not be inserted.");
  }
  return substituted;
}

export async function POST(request: Request) {
  const sharedSecret = process.env.GENERATE_SITE_STYLE_SHARED_SECRET || "";
  const allowedOrigin =
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN || "https://hoodlums.dev";
  const protectionEnabled = Boolean(sharedSecret);

  if (!protectionEnabled && process.env.NODE_ENV !== "test") {
    return NextResponse.json(
      { error: "Website generation access protection is not configured." },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  let rateHeaders: Record<string, string> = {};
  if (protectionEnabled) {
    if (!isGenerateSiteStyleRequestAuthorised(request, sharedSecret, allowedOrigin)) {
      return NextResponse.json(
        { error: "Unauthorised website-generation request." },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    const rate = consumeGenerateSiteStyleRateLimit(getClientIp(request));
    rateHeaders = {
      "RateLimit-Limit": String(GENERATE_SITE_STYLE_LIMIT),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Website generation rate limit exceeded. Try again later." },
        {
          status: 429,
          headers: noStoreHeaders({
            ...rateHeaders,
            "Retry-After": String(rate.retryAfterSeconds),
          }),
        },
      );
    }
  }

  const ai = resolveAIResponsesRuntime(
    process.env,
    getVercelOidcToken(request),
  );
  if (!ai) {
    return NextResponse.json(
      {
        error:
          "AI website generation is unavailable because neither OpenAI nor Vercel AI Gateway authentication is available.",
      },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let body: GenerateSiteStyleRequest;
  try {
    body = (await request.json()) as GenerateSiteStyleRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const input = normaliseGenerateSiteStyleRequest(body);
  if (!isValidImageDataUrl(input.imageDataUrl)) {
    return NextResponse.json(
      { error: "A valid optimised artwork image is required." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const artworkBody = buildPageArtworkIdentityRequestBody(input, ai.model);
  const artworkResult = await requestArtworkIdentity(
    () => requestProvider(ai, artworkBody, ARTWORK_TIMEOUT_MS),
    {
      first: "artwork-analysis",
      retry: "artwork-analysis-retry",
      parseFailure: "artwork-analysis-parse",
    },
  );
  if (!artworkResult.ok) {
    const parseFailure = artworkResult.failure.kind === "invalid";
    return NextResponse.json(
      {
        error: parseFailure
          ? "The AI returned an invalid artwork identity."
          : "The AI artwork-analysis service could not complete the request.",
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const artworkIdentity = artworkResult.identity;

  const designResult = await requestProvider(
    ai,
    buildFreeSiteDesignRequestBody(input, ai.model, artworkIdentity),
    DESIGN_TIMEOUT_MS,
  );
  if (!designResult.ok) {
    return NextResponse.json(
      { error: "The AI free-site design service could not complete the request." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let design;
  try {
    design = parseFreeSiteDesignResponse(designResult.payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid free-site design: the model response was rejected.",
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let templateHtml: string;
  try {
    templateHtml = renderFreeSiteTemplate(design);
  } catch {
    return NextResponse.json(
      { error: "The generated free-site theme or copy could not be rendered." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const acceptance =
    design.theme.tokenomicsStyle === "terminal"
      ? {}
      : { forbidTerminalAesthetic: true };
  if (!isCompleteGeneratedPageHtml(templateHtml, acceptance)) {
    return NextResponse.json(
      { error: "The generated free-site document failed server-side validation." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let html: string;
  try {
    html = substituteArtwork(templateHtml, input.imageDataUrl);
  } catch {
    return NextResponse.json(
      { error: "The free-site artwork could not be inserted." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  return NextResponse.json(
    { html },
    { headers: noStoreHeaders(rateHeaders) },
  );
}
