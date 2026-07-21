import { NextResponse } from "next/server";
import {
  getInspirationDomain,
  isValidImageDataUrl,
  isValidInspirationUrl,
  normaliseGenerateSiteStyleRequest,
  parseSiteStyleResponse,
  type GenerateSiteStyleRequest,
  type OpenAIResponse,
} from "@/lib/server/generate-site-style";
import {
  buildArtworkIdentityRequestBody,
  buildFinalSiteStyleRequestBody,
  buildInspirationInspectionRequestBody,
  extractVerifiedInspirationAnalysis,
  getFusionBriefIds,
  parseArtworkIdentityResponse,
  parseCollaborativeSiteStyleResponse,
  type ArtworkIdentity,
  type FusionBriefIds,
} from "@/lib/site-style-openai-pipeline";
import {
  GENERATE_SITE_STYLE_LIMIT,
  consumeGenerateSiteStyleRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";

export const runtime = "nodejs";
export const maxDuration = 60;

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

type OpenAIRequestResult =
  | { ok: true; payload: OpenAIResponse }
  | { ok: false; kind: "network" | "http" | "invalid" };

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

async function requestOpenAI(
  apiKey: string,
  body: unknown,
  timeoutMs: number,
  stage: string,
): Promise<OpenAIRequestResult> {
  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    console.error(
      `OpenAI ${stage} request failed before receiving a response`,
      error instanceof Error ? error.message : error,
    );
    return { ok: false, kind: "network" };
  }

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    console.error(`OpenAI ${stage} request failed`, response.status, message.slice(0, 500));
    return { ok: false, kind: "http" };
  }

  try {
    return { ok: true, payload: (await response.json()) as OpenAIResponse };
  } catch {
    return { ok: false, kind: "invalid" };
  }
}

export async function POST(request: Request) {
  const sharedSecret = process.env.GENERATE_SITE_STYLE_SHARED_SECRET || "";
  const allowedOrigin = process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN || "https://hoodlums.dev";
  const protectionEnabled = Boolean(sharedSecret);

  if (!protectionEnabled && process.env.NODE_ENV !== "test") {
    return NextResponse.json(
      { error: "Artwork generation access protection is not configured." },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  let rateHeaders: Record<string, string> = {};
  if (protectionEnabled) {
    if (!isGenerateSiteStyleRequestAuthorised(request, sharedSecret, allowedOrigin)) {
      return NextResponse.json(
        { error: "Unauthorised artwork-generation request." },
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
        { error: "Artwork generation rate limit exceeded. Try again later." },
        {
          status: 429,
          headers: noStoreHeaders({ ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) }),
        },
      );
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI style generation is not configured. The browser artwork matcher will be used." },
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
  if (!isValidInspirationUrl(input.inspirationUrl)) {
    return NextResponse.json(
      { error: "Enter a valid public http or https inspiration website URL." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const model = process.env.OPENAI_VISION_MODEL || "gpt-5-mini";
  let inspirationAnalysis = "";
  let artworkIdentity: ArtworkIdentity | undefined;
  let fusionBriefIds: FusionBriefIds | undefined;

  if (input.inspirationUrl) {
    const domain = getInspirationDomain(input.inspirationUrl);
    const inspirationBody = buildInspirationInspectionRequestBody(input, model);
    const artworkBody = buildArtworkIdentityRequestBody(input, model);
    if (!domain || !inspirationBody) {
      return NextResponse.json(
        { error: "Enter a valid public http or https inspiration website URL." },
        { status: 400, headers: noStoreHeaders(rateHeaders) },
      );
    }

    const [inspirationResult, artworkResult] = await Promise.all([
      requestOpenAI(apiKey, inspirationBody, 22_000, "inspiration-inspection"),
      requestOpenAI(apiKey, artworkBody, 20_000, "artwork-identity-analysis"),
    ]);

    if (!inspirationResult.ok) {
      return NextResponse.json(
        {
          error:
            "The inspiration website could not be inspected. Check that it is public and try again.",
        },
        { status: 502, headers: noStoreHeaders(rateHeaders) },
      );
    }
    if (!artworkResult.ok) {
      return NextResponse.json(
        {
          error:
            "The uploaded artwork could not be analysed for collaboration. Re-upload it and try again.",
        },
        { status: 502, headers: noStoreHeaders(rateHeaders) },
      );
    }

    const verifiedInspiration = extractVerifiedInspirationAnalysis(
      inspirationResult.payload,
      domain,
    );
    artworkIdentity = parseArtworkIdentityResponse(artworkResult.payload) || undefined;

    if (!verifiedInspiration) {
      return NextResponse.json(
        {
          error:
            "The inspiration website was not inspected, so no collaborative design was generated. Try the URL again or remove it.",
        },
        { status: 502, headers: noStoreHeaders(rateHeaders) },
      );
    }
    if (!artworkIdentity) {
      return NextResponse.json(
        {
          error:
            "The artwork identity could not be extracted, so it could not collaborate with the inspiration website.",
        },
        { status: 502, headers: noStoreHeaders(rateHeaders) },
      );
    }

    inspirationAnalysis = verifiedInspiration;
    fusionBriefIds = getFusionBriefIds(artworkIdentity, inspirationAnalysis);
  }

  const generation = await requestOpenAI(
    apiKey,
    buildFinalSiteStyleRequestBody(input, model, inspirationAnalysis, artworkIdentity),
    28_000,
    "artwork-site-generation",
  );
  if (!generation.ok) {
    if (generation.kind === "invalid") {
      return NextResponse.json(
        { error: "AI returned an invalid design. Try generating the website again." },
        { status: 502, headers: noStoreHeaders(rateHeaders) },
      );
    }
    return NextResponse.json(
      {
        error: input.inspirationUrl
          ? "The artwork and inspiration were analysed, but their collaborative website could not be generated. Try again."
          : "AI analysis was unavailable. The browser artwork matcher will be used.",
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const style = fusionBriefIds
    ? parseCollaborativeSiteStyleResponse(generation.payload, fusionBriefIds)
    : parseSiteStyleResponse(generation.payload);
  if (!style) {
    return NextResponse.json(
      {
        error: fusionBriefIds
          ? "AI returned a design that did not prove collaboration between the artwork and inspiration website. Try again."
          : "AI returned an invalid design. Try generating the website again.",
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  return NextResponse.json(
    {
      style: {
        ...style,
        source: "openai",
        inspirationUsed: Boolean(fusionBriefIds),
      },
    },
    { headers: noStoreHeaders(rateHeaders) },
  );
}
