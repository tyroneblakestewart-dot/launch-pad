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
import { SseEventParser, type SseParsedEvent } from "@/lib/server/sse-events";

export const runtime = "nodejs";
export const maxDuration = 120;

// A valid 90,000-character HTML document can grow well past that once it is
// embedded as an escaped JSON string value (quotes, backslashes, newlines and
// unicode escapes all expand) plus the surrounding artworkBriefId/
// inspirationBriefId JSON wrapper. 220,000 keeps every real completion intact
// while still failing a stuck/runaway stream long before it grows unbounded.
export const MAX_STREAMED_GENERATED_TEXT_LENGTH = 220_000;

// How many additional characters must arrive before another "building-page"
// progress event is emitted, so the client isn't sent one event per token.
const BUILD_PROGRESS_CHARACTER_STEP = 2_000;

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

type NdjsonEvent =
  | { type: "progress"; stage: string; message: string; receivedCharacters?: number }
  | { type: "complete"; html: string; source: AIResponsesRuntime["source"]; inspirationUsed: boolean }
  | { type: "error"; error: string; providerError?: ProviderError };

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
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
    const result = await requestOpenAI(ai, body, 18_000, stage);
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

type StreamOutcome =
  | { ok: true; payload: OpenAIResponse }
  | OpenAIRequestFailure;

/**
 * Sends the full-page generation request with `stream: true` and consumes the
 * SSE body as it arrives. Only ever returns the final `response.completed`
 * payload for parsing — partial/delta text is used solely for progress
 * reporting and the size cap, never rendered or returned.
 */
async function runStreamedFullPageGeneration(
  ai: AIResponsesRuntime,
  body: Record<string, unknown>,
  signal: AbortSignal,
  emitProgress: (receivedCharacters: number) => void,
): Promise<StreamOutcome> {
  let response: Response;
  try {
    response = await fetch(ai.responsesUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
  } catch (error) {
    const detail = sanitiseProviderDetail(error);
    console.error("AI full-page-generation request failed before receiving a response", detail);
    return { ok: false, kind: "network", detail };
  }

  if (!response.ok) {
    const message = sanitiseProviderDetail(await response.text().catch(() => ""));
    console.error("AI full-page-generation request failed", response.status, message);
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
  const parser = new SseEventParser();

  let receivedLength = 0;
  let lastReportedLength = 0;
  let sawDelta = false;
  let outcome: StreamOutcome | null = null;

  function report(force: boolean) {
    if (force || receivedLength - lastReportedLength >= BUILD_PROGRESS_CHARACTER_STEP) {
      lastReportedLength = receivedLength;
      emitProgress(receivedLength);
    }
  }

  function oversizeFailure(): StreamOutcome {
    return {
      ok: false,
      kind: "invalid",
      detail: `The streamed website generation exceeded the ${MAX_STREAMED_GENERATED_TEXT_LENGTH}-character safe size limit.`,
    };
  }

  function handle(event: SseParsedEvent): StreamOutcome | null {
    if (event.type === "raw") return null;
    if (event.type === "done") {
      return {
        ok: false,
        kind: "invalid",
        detail: "The provider closed the stream before completing the website generation.",
      };
    }

    const json = event.json as Record<string, unknown>;
    const jsonType = typeof json.type === "string" ? json.type : "";

    if (jsonType === "response.output_text.delta") {
      const delta = typeof json.delta === "string" ? json.delta : "";
      sawDelta = true;
      receivedLength += delta.length;
      if (receivedLength > MAX_STREAMED_GENERATED_TEXT_LENGTH) return oversizeFailure();
      report(false);
      return null;
    }

    if (jsonType === "response.output_text.done") {
      if (!sawDelta) {
        const text = typeof json.text === "string" ? json.text : "";
        receivedLength = text.length;
      }
      if (receivedLength > MAX_STREAMED_GENERATED_TEXT_LENGTH) return oversizeFailure();
      report(true);
      return null;
    }

    if (jsonType === "response.completed") {
      return { ok: true, payload: (json.response as OpenAIResponse) || {} };
    }

    if (jsonType === "response.incomplete") {
      const payload = json.response as OpenAIResponseMetadata | undefined;
      const reason = payload?.incomplete_details?.reason;
      const suffix = typeof reason === "string" && reason.trim() ? ` because ${reason.trim()}` : "";
      return {
        ok: false,
        kind: "invalid",
        detail: `The streamed website generation returned an incomplete response${suffix}.`,
      };
    }

    if (jsonType === "response.failed") {
      const payload = json.response as { error?: { message?: unknown } } | undefined;
      const message = payload?.error?.message;
      return {
        ok: false,
        kind: "invalid",
        detail: sanitiseProviderDetail(
          typeof message === "string" ? message : "The provider reported a failed website generation.",
        ),
      };
    }

    if (jsonType === "error") {
      const message = typeof json.message === "string" ? json.message : "The provider reported a streaming error.";
      return { ok: false, kind: "invalid", detail: sanitiseProviderDetail(message) };
    }

    return null;
  }

  try {
    while (!outcome) {
      const { value, done } = await reader.read();
      if (done) break;
      const events = parser.push(decoder.decode(value, { stream: true }));
      for (const event of events) {
        const result = handle(event);
        if (result) {
          outcome = result;
          break;
        }
      }
    }

    if (!outcome) {
      const tail = decoder.decode();
      const trailingEvents = [...(tail ? parser.push(tail) : []), ...parser.flush()];
      for (const event of trailingEvents) {
        const result = handle(event);
        if (result) {
          outcome = result;
          break;
        }
      }
    }
  } catch (error) {
    if (!outcome) {
      outcome = { ok: false, kind: "network", detail: sanitiseProviderDetail(error) };
    }
  } finally {
    if (outcome) {
      await reader.cancel().catch(() => undefined);
    }
  }

  return outcome ?? {
    ok: false,
    kind: "invalid",
    detail: "The provider ended the stream before completing the website generation.",
  };
}

export async function POST(request: Request) {
  const sharedSecret = process.env.GENERATE_SITE_STYLE_SHARED_SECRET || "";
  const allowedOrigin = process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN || "https://hoodlums.dev";
  const protectionEnabled = Boolean(sharedSecret);

  if (!protectionEnabled && process.env.NODE_ENV !== "test") {
    return jsonResponse(
      { error: "Website generation access protection is not configured." },
      503,
      noStoreHeaders(),
    );
  }

  let rateHeaders: Record<string, string> = {};
  if (protectionEnabled) {
    if (!isGenerateSiteStyleRequestAuthorised(request, sharedSecret, allowedOrigin)) {
      return jsonResponse(
        { error: "Unauthorised website-generation request." },
        401,
        noStoreHeaders(),
      );
    }

    const rate = consumeGenerateSiteStyleRateLimit(getClientIp(request));
    rateHeaders = {
      "RateLimit-Limit": String(GENERATE_SITE_STYLE_LIMIT),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return jsonResponse(
        { error: "Website generation rate limit exceeded. Try again later." },
        429,
        noStoreHeaders({ ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) }),
      );
    }
  }

  const ai = resolveAIResponsesRuntime(process.env, getVercelOidcToken(request));
  if (!ai) {
    return jsonResponse(
      {
        error:
          "AI website generation is unavailable because neither OpenAI nor Vercel AI Gateway authentication is available.",
      },
      503,
      noStoreHeaders(rateHeaders),
    );
  }

  let body: GenerateSiteStyleRequest;
  try {
    body = (await request.json()) as GenerateSiteStyleRequest;
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400, noStoreHeaders(rateHeaders));
  }

  const input = normaliseGenerateSiteStyleRequest(body);
  if (!isValidImageDataUrl(input.imageDataUrl)) {
    return jsonResponse(
      { error: "A valid optimised artwork image is required." },
      400,
      noStoreHeaders(rateHeaders),
    );
  }
  if (!isValidInspirationUrl(input.inspirationUrl)) {
    return jsonResponse(
      { error: "Enter a valid public http or https inspiration website URL." },
      400,
      noStoreHeaders(rateHeaders),
    );
  }

  const model = ai.model;
  const artworkBody = buildPageArtworkIdentityRequestBody(input, model);
  const domain = input.inspirationUrl ? getInspirationDomain(input.inspirationUrl) : null;
  const inspirationBody = input.inspirationUrl
    ? buildInspirationInspectionRequestBody(input, model)
    : null;

  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      function write(event: NdjsonEvent) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      }

      function finish() {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed/errored (e.g. the client disconnected) — nothing to clean up.
        }
      }

      write({
        type: "progress",
        stage: "analysing-artwork",
        message: "Analysing the uploaded artwork…",
      });

      const [artworkResult, inspirationResult] = await Promise.all([
        requestArtworkIdentity(ai, artworkBody),
        inspirationBody
          ? requestOpenAI(ai, inspirationBody, 18_000, "page-inspiration-analysis")
          : Promise.resolve<OpenAIRequestResult>({ ok: true, payload: {} }),
      ]);

      if (signal.aborted) {
        finish();
        return;
      }

      if (!artworkResult.ok) {
        const parseFailure = artworkResult.failure.kind === "invalid";
        write({
          type: "error",
          error: parseFailure
            ? "The AI returned an incomplete artwork analysis twice. Try generating again in a moment. Your artwork has not been rejected."
            : "The AI artwork-analysis service could not complete the request. Try again later; your artwork has not been rejected.",
          providerError: providerError(artworkResult.stage, ai, artworkResult.failure),
        });
        finish();
        return;
      }
      const artworkIdentity = artworkResult.identity;

      let inspirationAnalysis = NO_URL_PRESENTATION_BRIEF;
      if (input.inspirationUrl) {
        if (!domain || !inspirationBody) {
          write({
            type: "error",
            error: "Enter a valid public http or https inspiration website URL.",
          });
          finish();
          return;
        }
        if (!inspirationResult.ok) {
          write({
            type: "error",
            error: "The inspiration website could not be inspected. Check that it is public and try again.",
            providerError: providerError("page-inspiration-analysis", ai, inspirationResult),
          });
          finish();
          return;
        }
        const verified = extractVerifiedInspirationAnalysis(inspirationResult.payload, domain);
        if (!verified) {
          write({
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
          finish();
          return;
        }
        inspirationAnalysis = verified;
      }

      write({
        type: "progress",
        stage: "preparing-design",
        message: "Preparing the design brief…",
      });

      const briefIds = getFusionBriefIds(artworkIdentity, inspirationAnalysis);
      const acceptance = buildGeneratedPageAcceptanceProfile(artworkIdentity, inspirationAnalysis);

      write({
        type: "progress",
        stage: "building-page",
        message: "Writing the finished website…",
        receivedCharacters: 0,
      });

      const outcome = await runStreamedFullPageGeneration(
        ai,
        buildGeneratedSitePageRequestBody(input, model, artworkIdentity, inspirationAnalysis),
        signal,
        (receivedCharacters) =>
          write({
            type: "progress",
            stage: "building-page",
            message: "Writing the finished website…",
            receivedCharacters,
          }),
      );

      if (signal.aborted) {
        finish();
        return;
      }

      if (!outcome.ok) {
        const message =
          outcome.kind === "network"
            ? "The connection to the AI provider was interrupted while writing the website. Try generating again once; the artwork does not need to be replaced."
            : outcome.kind === "invalid"
              ? "AI returned an invalid website document. Try generating again."
              : "The artwork and inspiration were analysed, but the standalone website could not be generated. Try again.";
        write({
          type: "error",
          error: message,
          providerError: providerError("full-page-generation", ai, outcome),
        });
        finish();
        return;
      }

      write({
        type: "progress",
        stage: "checking-safety",
        message: "Checking the generated website is safe and complete…",
      });

      const page = parseGeneratedSitePageResponse(outcome.payload, briefIds, acceptance);
      if (!page) {
        write({
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
        finish();
        return;
      }

      write({
        type: "complete",
        html: page.html,
        source: ai.source,
        inspirationUsed: Boolean(input.inspirationUrl),
      });
      finish();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: noStoreHeaders({ ...rateHeaders, "Content-Type": "application/x-ndjson" }),
  });
}
