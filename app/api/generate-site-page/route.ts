import { NextResponse } from "next/server";
import {
  getInspirationDomain,
  isValidImageDataUrl,
  isValidInspirationUrl,
  normaliseGenerateSiteStyleRequest,
  type GenerateSiteStyleRequest,
  type OpenAIResponse,
} from "@/lib/server/generate-site-style";
import {
  buildArtworkIdentityRequestBody,
  buildInspirationInspectionRequestBody,
  extractVerifiedInspirationAnalysis,
  getFusionBriefIds,
  parseArtworkIdentityResponse,
} from "@/lib/site-style-openai-pipeline";
import {
  NO_URL_PRESENTATION_BRIEF,
  buildGeneratedSitePageRequestBody,
  parseGeneratedSitePageResponse,
} from "@/lib/site-page-openai-pipeline";
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
          headers: noStoreHeaders({ ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) }),
        },
      );
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI website generation is not configured." },
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
  const artworkBody = buildArtworkIdentityRequestBody(input, model);
  const domain = input.inspirationUrl ? getInspirationDomain(input.inspirationUrl) : null;
  const inspirationBody = input.inspirationUrl
    ? buildInspirationInspectionRequestBody(input, model)
    : null;

  const [artworkResult, inspirationResult] = await Promise.all([
    requestOpenAI(apiKey, artworkBody, 20_000, "page-artwork-analysis"),
    inspirationBody
      ? requestOpenAI(apiKey, inspirationBody, 22_000, "page-inspiration-analysis")
      : Promise.resolve<OpenAIRequestResult>({ ok: true, payload: {} }),
  ]);

  if (!artworkResult.ok) {
    return NextResponse.json(
      { error: "The uploaded artwork could not be analysed. Re-upload it and try again." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }
  const artworkIdentity = parseArtworkIdentityResponse(artworkResult.payload);
  if (!artworkIdentity) {
    return NextResponse.json(
      { error: "The uploaded artwork did not produce a complete visual identity analysis." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let inspirationAnalysis = NO_URL_PRESENTATION_BRIEF;
  if (input.inspirationUrl) {
    if (!domain || !inspirationBody || !inspirationResult.ok) {
      return NextResponse.json(
        { error: "The inspiration website could not be inspected. Check that it is public and try again." },
        { status: 502, headers: noStoreHeaders(rateHeaders) },
      );
    }
    const verified = extractVerifiedInspirationAnalysis(inspirationResult.payload, domain);
    if (!verified) {
      return NextResponse.json(
        { error: "The inspiration website was not inspected, so no full website was generated." },
        { status: 502, headers: noStoreHeaders(rateHeaders) },
      );
    }
    inspirationAnalysis = verified;
  }

  const briefIds = getFusionBriefIds(artworkIdentity, inspirationAnalysis);
  const generation = await requestOpenAI(
    apiKey,
    buildGeneratedSitePageRequestBody(input, model, artworkIdentity, inspirationAnalysis),
    38_000,
    "full-page-generation",
  );

  if (!generation.ok) {
    return NextResponse.json(
      {
        error:
          generation.kind === "invalid"
            ? "AI returned an invalid website document. Try generating again."
            : "The artwork and inspiration were analysed, but the full website could not be generated. Try again.",
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const page = parseGeneratedSitePageResponse(generation.payload, briefIds);
  if (!page) {
    return NextResponse.json(
      {
        error:
          "AI returned a website that was incomplete, unsafe, or did not prove it used both sources. Try again.",
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  return NextResponse.json(
    {
      html: page.html,
      source: "openai",
      inspirationUsed: Boolean(input.inspirationUrl),
    },
    { headers: noStoreHeaders(rateHeaders) },
  );
}
