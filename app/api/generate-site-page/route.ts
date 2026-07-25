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
  type ArtworkIdentity,
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
import { extractSseEvents } from "@/lib/server/sse-events";

export const runtime = "nodejs";
export const maxDuration = 120;

// The finished HTML document is capped at 90,000 characters (see
// lib/generated-site-page.ts). The streamed provider payload wraps that same
// HTML string inside a JSON object with two short brief-id fields, so this
// cap allows headroom for JSON quoting/escaping and the surrounding fields
// without letting a runaway stream grow unbounded in memory.
export const MAX_STREAMED_GENERATED_TEXT_LENGTH = 96_000;
const PROGRESS_EMIT_INTERVAL_CHARACTERS = 400;
const ANALYSIS_REQUEST_TIMEOUT_MS = 18_000;

type OpenAIRequestFailure = {
  ok: false;
  kind: "network" | "http" | "invalid";
  status?: number;
  detail?: string;
};

type OpenAIRequestResult =
  | { ok: true; payload: OpenAIResponse }
  | OpenAIRequestFailure;

type ArtworkIdentityRequestResult =
  | { ok: true; identity: ArtworkIdentity }
  | { ok: false; stage: string; failure: OpenAIRequestFailure };

type ProviderError = {
  stage: string;
  provider: AIResponsesRuntime["source"];
  kind: OpenAIRequestFailure["kind"];
  status: number | null;
  detail: string | null;
};

type OpenAIResponseMetadata = OpenAIResponse & {
  status?: unknown;
  incomplete_details?: { reason?: unknown } | null;
};

type NdjsonStage = "analysing-artwork" | "preparing-design" | "building-page" | "checking-safety";

type NdjsonEvent =
  | { type: "progress"; stage: NdjsonStage; message: string; receivedCharacters?: number }
  | { type: "complete"; html: string; source: AIResponsesRuntime["source"]; inspirationUsed: boolean }
  | { type: "error"; error: string; providerError?: ProviderError };

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

function sanitiseProviderDetail(value: unknown): string {
  const messageField =
    value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string"
      ? (value as { message: string }).message
      : null;
  const text =
    typeof value === "string"
      ? value
      : value instanceof Error
        ? value.message
        : messageField ?? String(value || "");
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

function isTimeoutFailure(failure: OpenAIRequestFailure): boolean {
  if (failure.kind !== "network") return false;
  return /\b(?:abort|aborted|timeout|timed out)\b/i.test(failure.detail || "");
}

function artworkParseDetail(payload: OpenAIResponse, attempt: number): string {
  const metadata = payload as OpenAIResponseMetadata;
  const reason = metadata.incomplete_details?.reason;
  if (metadata.status === "incomplete") {
    const suffix = typeof reason === "string" && reason.trim()
      ? ` because ${reason.trim()}`
      : "";
    return `Artwork analysis attempt ${attempt} returned an incomplete response${suffix}.`;
  }
  return `Artwork analysis attempt ${attempt} completed but did not match the required seven-field identity object.`;
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

async function requestArtworkIdentity(
  ai: AIResponsesRuntime,
  body: unknown,
): Promise<ArtworkIdentityRequestResult> {
  const parseDetails: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const stage = attempt === 1 ? "page-artwork-analysis" : "page-artwork-analysis-retry";
    const result = await requestOpenAI(ai, body, ANALYSIS_REQUEST_TIMEOUT_MS, stage);
    if (!result.ok) return { ok: false, stage, failure: result };

    const identity = parseArtworkIdentityResponse(result.payload);
    if (identity) return { ok: true, identity };

    const detail = artworkParseDetail(result.payload, attempt);
    parseDetails.push(detail);
    if (attempt === 1) {
      console.warn("AI artwork identity response was incomplete; retrying once", detail);
    }
  }

  return {
    ok: false,
    stage: "page-artwork-analysis-parse",
    failure: {
      ok: false,
      kind: "invalid",
      detail: sanitiseProviderDetail(parseDetails.join(" ")),
    },
  };
}

// Streams the full-page generation request via the Responses API's SSE mode
// instead of waiting for one large response. Only `response.output_text.delta`
// character counts are surfaced while the stream runs; the actual structured
// JSON used for parsing/validation only ever comes from the final
// `response.completed` event, so no partial or unvalidated HTML is ever
// exposed to callers of this function.
async function requestStreamedFullPageGeneration(
  ai: AIResponsesRuntime,
  body: Record<string, unknown>,
  onProgress: (receivedCharacters: number) => void,
): Promise<OpenAIRequestResult> {
  let response: Response;
  try {
    response = await fetch(ai.responsesUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ ...body, stream: true }),
    });
  } catch (error) {
    const detail = sanitiseProviderDetail(error);
    console.error("AI full-page-generation stream request failed before receiving a response", detail);
    return { ok: false, kind: "network", detail };
  }

  if (!response.ok) {
    const message = sanitiseProviderDetail(await response.text().catch(() => ""));
    console.error("AI full-page-generation stream request failed through", ai.source, response.status, message);
    return { ok: false, kind: "http", status: response.status, detail: message };
  }

  if (!response.body) {
    return {
      ok: false,
      kind: "invalid",
      detail: "The provider did not return a streamable response body.",
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedCharacters = 0;
  let charactersSinceProgress = 0;
  let completed: OpenAIResponse | null = null;
  let failure: OpenAIRequestFailure | null = null;

  try {
    readLoop: while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const extraction = extractSseEvents(buffer);
      buffer = extraction.remainder;

      for (const sseEvent of extraction.events) {
        if (sseEvent.data === "[DONE]") continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(sseEvent.data) as Record<string, unknown>;
        } catch {
          continue;
        }

        const type = typeof parsed.type === "string" ? parsed.type : sseEvent.event || "";

        if (type === "response.output_text.delta") {
          const delta = typeof parsed.delta === "string" ? parsed.delta : "";
          receivedCharacters += delta.length;
          charactersSinceProgress += delta.length;
          if (receivedCharacters > MAX_STREAMED_GENERATED_TEXT_LENGTH) {
            failure = {
              ok: false,
              kind: "invalid",
              detail: "The generated website exceeded the maximum allowed size before it finished streaming.",
            };
            break readLoop;
          }
          if (charactersSinceProgress >= PROGRESS_EMIT_INTERVAL_CHARACTERS) {
            charactersSinceProgress = 0;
            onProgress(receivedCharacters);
          }
          continue;
        }

        if (type === "response.completed") {
          const payload = parsed.response;
          if (payload && typeof payload === "object") {
            completed = payload as OpenAIResponse;
          }
          break readLoop;
        }

        if (type === "response.incomplete") {
          const payload = parsed.response as OpenAIResponseMetadata | undefined;
          const reason = payload?.incomplete_details?.reason;
          failure = {
            ok: false,
            kind: "invalid",
            detail: sanitiseProviderDetail(
              `The website generation stream ended incomplete${
                typeof reason === "string" && reason.trim() ? ` because ${reason.trim()}` : ""
              }.`,
            ),
          };
          break readLoop;
        }

        if (type === "response.failed") {
          const payloadError =
            parsed.response && typeof parsed.response === "object"
              ? (parsed.response as { error?: unknown }).error
              : parsed.error;
          failure = {
            ok: false,
            kind: "invalid",
            detail: sanitiseProviderDetail(payloadError ?? "The provider reported a streaming failure."),
          };
          break readLoop;
        }
      }
    }
  } catch (error) {
    return { ok: false, kind: "network", detail: sanitiseProviderDetail(error) };
  } finally {
    reader.releaseLock();
  }

  if (failure) return failure;
  if (!completed) {
    return {
      ok: false,
      kind: "invalid",
      detail: "The provider stream ended before the website finished generating.",
    };
  }

  onProgress(receivedCharacters);
  return { ok: true, payload: completed };
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

  const resolvedRuntime = resolveAIResponsesRuntime(process.env, getVercelOidcToken(request));
  if (!resolvedRuntime) {
    return NextResponse.json(
      {
        error:
          "AI website generation is unavailable because neither OpenAI nor Vercel AI Gateway authentication is available.",
      },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }
  // Narrowed to a non-null binding so the ReadableStream's nested `run()`
  // closure below can reference it without TypeScript widening it back to
  // `AIResponsesRuntime | null` (control-flow narrowing doesn't cross into
  // functions declared inside a later closure).
  const ai: AIResponsesRuntime = resolvedRuntime;

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
  const inspirationDomain: string | null = input.inspirationUrl
    ? getInspirationDomain(input.inspirationUrl)
    : null;
  const inspirationBody = input.inspirationUrl
    ? buildInspirationInspectionRequestBody(input, model)
    : null;

  if (input.inspirationUrl && (!inspirationDomain || !inspirationBody)) {
    return NextResponse.json(
      { error: "Enter a valid public http or https inspiration website URL." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (event: NdjsonEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const fail = (message: string, failureProviderError?: ProviderError) => {
        send({
          type: "error",
          error: message,
          ...(failureProviderError ? { providerError: failureProviderError } : {}),
        });
        closed = true;
        controller.close();
      };

      async function run() {
        send({
          type: "progress",
          stage: "analysing-artwork",
          message: input.inspirationUrl
            ? "Analysing the uploaded artwork and the inspiration website…"
            : "Analysing the uploaded artwork…",
        });

        const [artworkResult, inspirationResult] = await Promise.all([
          requestArtworkIdentity(ai, artworkBody),
          inspirationBody
            ? requestOpenAI(ai, inspirationBody, ANALYSIS_REQUEST_TIMEOUT_MS, "page-inspiration-analysis")
            : Promise.resolve<OpenAIRequestResult>({ ok: true, payload: {} }),
        ]);

        if (!artworkResult.ok) {
          const parseFailure = artworkResult.failure.kind === "invalid";
          fail(
            parseFailure
              ? "The AI returned an incomplete artwork analysis twice. Try generating again in a moment. Your artwork has not been rejected."
              : "The AI artwork-analysis service could not complete the request. Try again later; your artwork has not been rejected.",
            providerError(artworkResult.stage, ai, artworkResult.failure),
          );
          return;
        }
        const artworkIdentity = artworkResult.identity;

        let inspirationAnalysis = NO_URL_PRESENTATION_BRIEF;
        if (input.inspirationUrl) {
          if (!inspirationResult.ok) {
            fail(
              "The inspiration website could not be inspected. Check that it is public and try again.",
              providerError("page-inspiration-analysis", ai, inspirationResult),
            );
            return;
          }
          const verified = extractVerifiedInspirationAnalysis(inspirationResult.payload, inspirationDomain as string);
          if (!verified) {
            fail(
              "The inspiration website was not inspected, so no full website was generated.",
              {
                stage: "page-inspiration-analysis-verify",
                provider: ai.source,
                kind: "invalid",
                status: null,
                detail: "The provider response did not contain a completed search result from the requested domain.",
              },
            );
            return;
          }
          inspirationAnalysis = verified;
        }

        send({
          type: "progress",
          stage: "preparing-design",
          message: "Preparing the design brief from the verified artwork and inspiration…",
        });

        const briefIds = getFusionBriefIds(artworkIdentity, inspirationAnalysis);
        const acceptance = buildGeneratedPageAcceptanceProfile(artworkIdentity, inspirationAnalysis);

        send({
          type: "progress",
          stage: "building-page",
          message: "Writing the finished website…",
        });

        const generation = await requestStreamedFullPageGeneration(
          ai,
          buildGeneratedSitePageRequestBody(input, model, artworkIdentity, inspirationAnalysis),
          (receivedCharacters) => {
            send({
              type: "progress",
              stage: "building-page",
              message: "Writing the finished website…",
              receivedCharacters,
            });
          },
        );

        if (!generation.ok) {
          const timedOut = isTimeoutFailure(generation);
          fail(
            timedOut
              ? "The artwork analysis succeeded, but the AI took too long to finish the full website. Try generating again once; the artwork does not need to be replaced."
              : generation.kind === "invalid"
                ? "AI returned an invalid website document. Try generating again."
                : "The artwork and inspiration were analysed, but the standalone website could not be generated. Try again.",
            providerError("full-page-generation", ai, generation),
          );
          return;
        }

        send({
          type: "progress",
          stage: "checking-safety",
          message: "Checking the generated website against the safety and quality rules…",
        });

        const page = parseGeneratedSitePageResponse(generation.payload, briefIds, acceptance);
        if (!page) {
          fail(
            "AI returned a website that was incomplete, unsafe, still resembled the legacy terminal fallback, or did not apply the inspiration structure. Try again.",
            {
              stage: "full-page-generation-parse",
              provider: ai.source,
              kind: "invalid",
              status: null,
              detail: "The generated document failed the server-side completeness, safety, evidence, or inspiration acceptance checks.",
            },
          );
          return;
        }

        send({
          type: "complete",
          html: page.html,
          source: ai.source,
          inspirationUsed: Boolean(input.inspirationUrl),
        });
        closed = true;
        controller.close();
      }

      try {
        await run();
      } catch (error) {
        console.error("Full-page generation stream failed unexpectedly", sanitiseProviderDetail(error));
        fail("The website generation stopped unexpectedly. Try again.");
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: noStoreHeaders({ ...rateHeaders, "Content-Type": "application/x-ndjson" }),
  });
}
