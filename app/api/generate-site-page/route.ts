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
  buildInspirationInspectionRequestBody,
  extractVerifiedInspirationAnalysis,
  getFusionBriefIds,
  parseArtworkIdentityResponse,
} from "@/lib/site-style-openai-pipeline";
import {
  NO_URL_PRESENTATION_BRIEF,
  buildGeneratedPageAcceptanceProfile,
  buildGeneratedSitePageRequestBody,
  buildPageArtworkIdentityRequestBody,
  parseGeneratedSitePageResponse,
} from "@/lib/site-page-openai-pipeline";
import {
  GENERATE_SITE_STYLE_LIMIT,
  consumeGenerateSiteStyleRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";
import {
  getVercelOidcToken,
  resolveAIResponsesRuntime,
  type AIResponsesRuntime,
} from "@/lib/server/ai-responses-runtime";

export const runtime = "nodejs";
export const maxDuration = 60;

type OpenAIRequestFailure = {
  ok: false;
  kind: "network" | "http" | "invalid";
  status?: number;
  detail?: string;
};

type OpenAIRequestResult =
  | { ok: true; payload: OpenAIResponse }
  | OpenAIRequestFailure;

type ProviderError = {
  stage: string;
  provider: AIResponsesRuntime["source"];
  kind: OpenAIRequestFailure["kind"];
  status: number | null;
  detail: string | null;
};

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

function sanitiseProviderDetail(value: unknown): string {
  const text = typeof value === "string" ? value : value instanceof Error ? value.message : String(value || "");
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(?:api[_-]?key|token)([\"'\s:=]+)[A-Za-z0-9._~+/=-]+/gi, "credential$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function providerError(
  stage: string,
  ai: AIResponsesRuntime,
  failure: OpenAIRequestFailure,
): ProviderError {
  return {
    stage,
    provider: ai.source,
    kind: failure.kind,
    status: failure.status ?? null,
    detail: failure.detail || null,
  };
}

async function requestOpenAI(
  ai: AIResponsesRuntime,
  body: unknown,
  timeoutMs: number,
  stage: string,
): Promise<OpenAIRequestResult> {
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
  } catch (error) {
    const detail = sanitiseProviderDetail(error);
    console.error(`AI ${stage} request failed before receiving a response`, detail);
    return { ok: false, kind: "network", detail };
  }

  if (!response.ok) {
    const message = sanitiseProviderDetail(await response.text().catch(() => ""));
    console.error(
      `AI ${stage} request failed through ${ai.source}`,
      response.status,
      message,
    );
    return { ok: false, kind: "http", status: response.status, detail: message };
  }

  try {
    return { ok: true, payload: (await response.json()) as OpenAIResponse };
  } catch (error) {
    return { ok: false, kind: "invalid", detail: sanitiseProviderDetail(error) };
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

  const ai = resolveAIResponsesRuntime(process.env, getVercelOidcToken(request));
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
  if (!isValidInspirationUrl(input.inspirationUrl)) {
    return NextResponse.json(
      { error: "Enter a valid public http or https inspiration website URL." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const model = ai.model;
  const artworkBody = buildPageArtworkIdentityRequestBody(input, model);
  const domain = input.inspirationUrl ? getInspirationDomain(input.inspirationUrl) : null;
  const inspirationBody = input.inspirationUrl
    ? buildInspirationInspectionRequestBody(input, model)
    : null;

  const [artworkResult, inspirationResult] = await Promise.all([
    requestOpenAI(ai, artworkBody, 18_000, "page-artwork-analysis"),
    inspirationBody
      ? requestOpenAI(ai, inspirationBody, 18_000, "page-inspiration-analysis")
      : Promise.resolve<OpenAIRequestResult>({ ok: true, payload: {} }),
  ]);

  if (!artworkResult.ok) {
    return NextResponse.json(
      {
        error: "The uploaded artwork could not be analysed. Re-upload it and try again.",
        providerError: providerError("page-artwork-analysis", ai, artworkResult),
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }
  const artworkIdentity = parseArtworkIdentityResponse(artworkResult.payload);
  if (!artworkIdentity) {
    return NextResponse.json(
      {
        error: "The uploaded artwork did not produce a complete visual identity analysis.",
        providerError: {
          stage: "page-artwork-analysis-parse",
          provider: ai.source,
          kind: "invalid",
          status: null,
          detail: "The provider response was successful but did not match the required artwork identity object.",
        },
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let inspirationAnalysis = NO_URL_PRESENTATION_BRIEF;
  if (input.inspirationUrl) {
    if (!domain || !inspirationBody) {
      return NextResponse.json(
        { error: "Enter a valid public http or https inspiration website URL." },
        { status: 400, headers: noStoreHeaders(rateHeaders) },
      );
    }
    if (!inspirationResult.ok) {
      return NextResponse.json(
        {
          error: "The inspiration website could not be inspected. Check that it is public and try again.",
          providerError: providerError("page-inspiration-analysis", ai, inspirationResult),
        },
        { status: 502, headers: noStoreHeaders(rateHeaders) },
      );
    }
    const verified = extractVerifiedInspirationAnalysis(inspirationResult.payload, domain);
    if (!verified) {
      return NextResponse.json(
        {
          error: "The inspiration website was not inspected, so no full website was generated.",
          providerError: {
            stage: "page-inspiration-analysis-verify",
            provider: ai.source,
            kind: "invalid",
            status: null,
            detail: "The provider response did not contain a completed search result from the requested domain.",
          },
        },
        { status: 502, headers: noStoreHeaders(rateHeaders) },
      );
    }
    inspirationAnalysis = verified;
  }

  const briefIds = getFusionBriefIds(artworkIdentity, inspirationAnalysis);
  const acceptance = buildGeneratedPageAcceptanceProfile(artworkIdentity, inspirationAnalysis);
  const generation = await requestOpenAI(
    ai,
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
            : "The artwork and inspiration were analysed, but the standalone website could not be generated. Try again.",
        providerError: providerError("full-page-generation", ai, generation),
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const page = parseGeneratedSitePageResponse(generation.payload, briefIds, acceptance);
  if (!page) {
    return NextResponse.json(
      {
        error:
          "AI returned a website that was incomplete, unsafe, still resembled the legacy terminal fallback, or did not apply the inspiration structure. Try again.",
        providerError: {
          stage: "full-page-generation-parse",
          provider: ai.source,
          kind: "invalid",
          status: null,
          detail: "The generated document failed the server-side completeness, safety, evidence, or inspiration acceptance checks.",
        },
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  return NextResponse.json(
    {
      html: page.html,
      source: ai.source,
      inspirationUsed: Boolean(input.inspirationUrl),
    },
    { headers: noStoreHeaders(rateHeaders) },
  );
}
