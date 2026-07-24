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
import { haveDistinctVariantLayouts, type GeneratedSiteVariant } from "@/lib/generated-site-variants";
import { SITE_DESIGN_VARIANTS } from "@/lib/site-design-variants";
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
    .replace(/(?:api[_-]?key|token)(["'\s:=]+)[A-Za-z0-9._~+/=-]+/gi, "credential$1[redacted]")
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

  // Artwork and inspiration are analysed once and shared by all five directions.
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

  // One protected browser request fans out to five parallel full-page calls.
  const generationResults = await Promise.all(
    SITE_DESIGN_VARIANTS.map((variant) =>
      requestOpenAI(
        ai,
        buildGeneratedSitePageRequestBody(
          input,
          model,
          artworkIdentity,
          inspirationAnalysis,
          variant,
        ),
        38_000,
        `full-page-generation-${variant.id}`,
      ),
    ),
  );

  for (let index = 0; index < generationResults.length; index += 1) {
    const generation = generationResults[index];
    const variant = SITE_DESIGN_VARIANTS[index];
    if (!generation.ok) {
      return NextResponse.json(
        {
          error:
            generation.kind === "invalid"
              ? `AI returned an invalid ${variant.label} website. Try generating all five designs again.`
              : `The ${variant.label} design could not be generated. Try generating all five designs again.`,
          providerError: providerError(`full-page-generation-${variant.id}`, ai, generation),
        },
        { status: 502, headers: noStoreHeaders(rateHeaders) },
      );
    }
  }

  const variants: GeneratedSiteVariant[] = [];
  for (let index = 0; index < generationResults.length; index += 1) {
    const generation = generationResults[index];
    const descriptor = SITE_DESIGN_VARIANTS[index];
    if (!generation.ok) continue;
    const page = parseGeneratedSitePageResponse(
      generation.payload,
      briefIds,
      acceptance,
      descriptor,
    );
    if (!page) {
      return NextResponse.json(
        {
          error: `${descriptor.label} failed the completeness, safety, identity or variant checks. Generate all five designs again.`,
          providerError: {
            stage: `full-page-generation-parse-${descriptor.id}`,
            provider: ai.source,
            kind: "invalid",
            status: null,
            detail: "One generated document failed its server-side page, evidence, variant marker or safety checks.",
          },
        },
        { status: 502, headers: noStoreHeaders(rateHeaders) },
      );
    }
    variants.push({
      id: descriptor.id,
      label: descriptor.label,
      description: descriptor.description,
      html: page.html,
    });
  }

  if (variants.length !== SITE_DESIGN_VARIANTS.length || !haveDistinctVariantLayouts(variants)) {
    return NextResponse.json(
      {
        error:
          "The five generated websites were not structurally distinct enough. Generate again for five genuinely different layouts.",
        providerError: {
          stage: "full-page-generation-diversity",
          provider: ai.source,
          kind: "invalid",
          status: null,
          detail: "Duplicate or colour-swap-only layout structures were detected across the generated variants.",
        },
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  return NextResponse.json(
    {
      variants,
      source: ai.source,
      inspirationUsed: Boolean(input.inspirationUrl),
    },
    { headers: noStoreHeaders(rateHeaders) },
  );
}
