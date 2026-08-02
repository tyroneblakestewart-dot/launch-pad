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
import { sanitiseProviderDetail } from "@/lib/server/sanitise-provider-detail";
import { requestArtworkIdentity } from "@/lib/server/artwork-identity-request";
import {
  requestStreamedFullPageGeneration,
  type StreamedFullPageOutcome,
} from "@/lib/server/generate-site-page-stream";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import type { GenerateSitePageStreamEvent } from "@/lib/generate-site-page-stream-protocol";

export const runtime = "nodejs";
export const maxDuration = 120;

// Only the short artwork/inspiration analysis calls need a bounded timeout;
// the single large full-page-generation call is streamed and relies on the
// incoming request's own abort signal (client disconnect) instead.
const ANALYSIS_TIMEOUT_MS = 18_000;
// Progress heartbeats for the "building-page" stage are throttled to this
// interval so a long generation doesn't flood the NDJSON stream.
const BUILDING_PAGE_PROGRESS_INTERVAL_MS = 15_000;

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
  kind: string;
  status: number | null;
  detail: string | null;
};

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

function providerError(
  stage: string,
  ai: AIResponsesRuntime,
  failure: { kind: string; status?: number; detail?: string },
): ProviderError {
  return {
    stage,
    provider: ai.source,
    kind: failure.kind,
    status: failure.status ?? null,
    detail: failure.detail || null,
  };
}

function isTimeoutFailure(failure: { kind: string; detail?: string }): boolean {
  if (failure.kind !== "network") return false;
  return /\b(?:abort|aborted|timeout|timed out)\b/i.test(failure.detail || "");
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

function generationFailureMessage(generation: Extract<StreamedFullPageOutcome, { ok: false }>): string {
  if (isTimeoutFailure(generation)) {
    return "The artwork analysis succeeded, but the connection to the AI was interrupted while building the full website. Try generating again once; the artwork does not need to be replaced.";
  }
  switch (generation.kind) {
    case "incomplete":
      return "The AI stopped before finishing the full website. Try generating again; the artwork does not need to be replaced.";
    case "failed":
      return "The artwork and inspiration were analysed, but the standalone website generation failed. Try again.";
    case "invalid":
      return "AI returned an invalid website document. Try generating again.";
    default:
      return "The artwork and inspiration were analysed, but the standalone website could not be generated. Try again.";
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

  const isolationResponse = await getServiceIsolationResponse("website-generation");
  if (isolationResponse) return isolationResponse;

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
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: GenerateSitePageStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting; nothing more to do.
        }
      };

      try {
        send({ type: "progress", stage: "analysing-artwork" });

        const artworkBody = buildPageArtworkIdentityRequestBody(input, model);
        const domain = input.inspirationUrl ? getInspirationDomain(input.inspirationUrl) : null;
        const inspirationBody = input.inspirationUrl
          ? buildInspirationInspectionRequestBody(input, model)
          : null;

        const [artworkResult, inspirationResult] = await Promise.all([
          requestArtworkIdentity(
            (stage) => requestOpenAI(ai, artworkBody, ANALYSIS_TIMEOUT_MS, stage),
            {
              first: "page-artwork-analysis",
              retry: "page-artwork-analysis-retry",
              parseFailure: "page-artwork-analysis-parse",
            },
          ),
          inspirationBody
            ? requestOpenAI(ai, inspirationBody, ANALYSIS_TIMEOUT_MS, "page-inspiration-analysis")
            : Promise.resolve<OpenAIRequestResult>({ ok: true, payload: {} }),
        ]);

        if (!artworkResult.ok) {
          const parseFailure = artworkResult.failure.kind === "invalid";
          send({
            type: "error",
            error: parseFailure
              ? "The AI returned an incomplete artwork analysis twice. Try generating again in a moment. Your artwork has not been rejected."
              : "The AI artwork-analysis service could not complete the request. Try again later; your artwork has not been rejected.",
            providerError: providerError(artworkResult.stage, ai, artworkResult.failure),
          });
          close();
          return;
        }
        const artworkIdentity = artworkResult.identity;

        let inspirationAnalysis = NO_URL_PRESENTATION_BRIEF;
        if (input.inspirationUrl) {
          if (!domain || !inspirationBody) {
            send({
              type: "error",
              error: "Enter a valid public http or https inspiration website URL.",
            });
            close();
            return;
          }
          if (!inspirationResult.ok) {
            send({
              type: "error",
              error: "The inspiration website could not be inspected. Check that it is public and try again.",
              providerError: providerError("page-inspiration-analysis", ai, inspirationResult),
            });
            close();
            return;
          }
          const verified = extractVerifiedInspirationAnalysis(inspirationResult.payload, domain);
          if (!verified) {
            send({
              type: "error",
              error: "The inspiration website was not inspected, so no full website was generated.",
              providerError: {
                stage: "page-inspiration-analysis-verify",
                provider: ai.source,
                kind: "invalid",
                status: null,
                detail: "The provider response did not contain a completed search result from the requested domain.",
              },
            });
            close();
            return;
          }
          inspirationAnalysis = verified;
        }

        send({ type: "progress", stage: "preparing-design" });

        const briefIds = getFusionBriefIds(artworkIdentity, inspirationAnalysis);
        const acceptance = buildGeneratedPageAcceptanceProfile(artworkIdentity, inspirationAnalysis);
        const generationBody = buildGeneratedSitePageRequestBody(input, model, artworkIdentity, inspirationAnalysis);

        send({ type: "progress", stage: "building-page" });

        let lastProgressAt = Date.now();
        const generation = await requestStreamedFullPageGeneration(ai, generationBody, request.signal, () => {
          const now = Date.now();
          if (now - lastProgressAt >= BUILDING_PAGE_PROGRESS_INTERVAL_MS) {
            lastProgressAt = now;
            send({ type: "progress", stage: "building-page" });
          }
        });

        if (!generation.ok) {
          send({
            type: "error",
            error: generationFailureMessage(generation),
            providerError: providerError("full-page-generation", ai, generation),
          });
          close();
          return;
        }

        send({ type: "progress", stage: "checking-safety" });

        const page = parseGeneratedSitePageResponse(generation.payload, briefIds, acceptance);
        if (!page) {
          send({
            type: "error",
            error:
              "AI returned a website that was incomplete, unsafe, still resembled the legacy terminal fallback, or did not apply the inspiration structure. Try again.",
            providerError: {
              stage: "full-page-generation-parse",
              provider: ai.source,
              kind: "invalid",
              status: null,
              detail: "The generated document failed the server-side completeness, safety, evidence, or inspiration acceptance checks.",
            },
          });
          close();
          return;
        }

        send({
          type: "complete",
          html: page.html,
          source: ai.source,
          inspirationUsed: Boolean(input.inspirationUrl),
        });
        close();
      } catch (error) {
        if (!request.signal.aborted) {
          console.error("Unexpected error while streaming full page generation", sanitiseProviderDetail(error));
          send({
            type: "error",
            error: "The standalone website could not be generated because of an unexpected server error. Try again.",
          });
        }
        close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: noStoreHeaders({ ...rateHeaders, "Content-Type": "application/x-ndjson" }),
  });
}
