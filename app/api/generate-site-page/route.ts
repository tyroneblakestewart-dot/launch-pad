import { NextResponse } from "next/server";
import { AI_FEATURE_KEYS } from "@/lib/ai-feature-keys";
import { enforceBespokeLinks } from "@/lib/bespoke-site-links";
import { formatCount, type GeneratedPagePayloadRejection } from "@/lib/generated-site-page";
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
  BESPOKE_PAGE_MAX_OUTPUT_TOKENS,
  FREE_REIN_ACCEPTANCE_PROFILE,
  NO_URL_PRESENTATION_BRIEF,
  buildGeneratedSitePageRequestBody,
  buildOversizeRetryCorrectiveFeedback,
  buildPageArtworkIdentityRequestBody,
  describeGeneratedSitePageRejectionDetail,
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
  resolveBespokePageModel,
  type AIResponsesRuntime,
} from "@/lib/server/ai-responses-runtime";
import { recordTextOperationCostBestEffort, runAfterResponse, type AiOperationAccessSource } from "@/lib/server/ai-operation-cost-store";
import { calculateTextCostUsd, readAiPricingRatesForModel, readBespokeSiteCostCapUsd } from "@/lib/server/ai-pricing";
import { extractOpenAIUsage } from "@/lib/server/ai-usage";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { authoriseBespokeSiteGeneration } from "@/lib/server/bespoke-site-entitlement";
import { getBespokeSiteGenerationsStore } from "@/lib/server/bespoke-site-generations-store";
import {
  BESPOKE_ATTEMPTS_USED_CODE,
  BESPOKE_GENERATIONS_PER_PURCHASE,
  bespokeAttempts,
  hashBespokeSiteProject,
  type BespokeAttempts,
} from "@/lib/bespoke-site-access";
import { contentFilterRejectionMessage, runContentFilterFailOpen } from "@/lib/server/content-filter";
import { sanitiseProviderDetail } from "@/lib/server/sanitise-provider-detail";
import { requestArtworkIdentity } from "@/lib/server/artwork-identity-request";
import {
  requestStreamedFullPageGeneration,
  type StreamedFullPageOutcome,
} from "@/lib/server/generate-site-page-stream";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import type { GenerateSitePageStreamEvent } from "@/lib/generate-site-page-stream-protocol";

export const runtime = "nodejs";
// Vercel Pro with Fluid Compute allows up to 800s (owner confirmed the plan,
// 11 Sep 2026). The paid page stage runs gpt-5 at medium reasoning with a
// 64,000-token budget (32,000 until 12 Sep 2026 — see
// BESPOKE_PAGE_MAX_OUTPUT_TOKENS), and the old 120s ceiling left no room for
// a slow answer, let alone the one automatic retry.
export const maxDuration = 800;
const ROUTE_BUDGET_MS = maxDuration * 1_000;
// A retry takes about as long as the first attempt, so it only starts while
// less than this share of the budget has been spent.
const RETRY_TIME_BUDGET_SHARE = 0.45;

// Only the short artwork/inspiration analysis calls need a bounded timeout;
// the single large full-page-generation call is streamed and relies on the
// incoming request's own abort signal (client disconnect) instead.
const ANALYSIS_TIMEOUT_MS = 18_000;
// Progress heartbeats for the "building-page" stage are throttled to this
// interval so a long generation doesn't flood the NDJSON stream.
const BUILDING_PAGE_PROGRESS_INTERVAL_MS = 15_000;

// Issue #323 part 1: a page rejected only for the responsive-layout baseline
// (not for any safety/completeness/evidence reason) gets exactly one
// automatic regeneration with this note appended to the prompt, instead of
// failing the whole request over a fixable layout mistake.
const LAYOUT_RETRY_CORRECTIVE_FEEDBACK =
  "The previous attempt failed the required responsive-layout check. It either omitted the viewport meta tag, made no attempt at responsive CSS (no media queries and no fluid units like clamp()/vw/vh/%), used a fixed pixel container 480px or wider outside any desktop media query, or laid out side-by-side columns that never stack for phones. That last failure shows up as: an always-active multi-column CSS grid (e.g. grid-template-columns: repeat(3, 1fr) or a written-out list like 96px 1fr 1fr) with no max-width media query that ever collapses it to one column; a two-column grid where a track is a fixed pixel width of 200px or more outside any media query; or a display: flex row of content (e.g. an icon-heading-paragraph card) that can never wrap and has no max-width media query that ever switches it to flex-direction: column. Keep the desktop layout exactly as designed — do not change how the page looks at 1280px and up — and add genuine mobile stacking beneath it: at 390px every one of those rows or grids must reflow into a single vertical column with nothing clipped or cut off at the viewport edge. Also make sure the hero section's heading, artwork and call-to-action are all visible within the first viewport at 390px — never a fixed-height hero that renders as an empty colour block with its content clipped or positioned off-screen on a phone.";

type GenerateSitePageRequest = GenerateSiteStyleRequest & {
  accessProof?: unknown;
};

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

/** One honest sentence for the studio when our own checks refuse the AI's page — naming the rule, never the generic list. */
function bespokeRejectionUserMessage(rejection: GeneratedPagePayloadRejection): string {
  switch (rejection.code) {
    case "too-long":
      return `The AI wrote a page of ${formatCount(rejection.htmlBytes ?? 0)} bytes, over the 90,000-byte limit published sites are stored under, and a shorter retry did not land under it either. Try again — every attempt is told to keep the page compact.`;
    case "layout":
      return "The AI's page failed the responsive-layout check even after one corrective retry. Try again.";
    case "missing-section":
    case "missing-artwork-placeholder":
    case "missing-viewport":
    case "missing-style-or-script":
      return `The AI left the page incomplete: ${rejection.message} Try again.`;
    case "evidence-mismatch":
    case "invalid-payload":
      return `The AI's answer was not a usable page: ${rejection.message} Try again.`;
    default:
      return `The AI's page failed our safety check: ${rejection.message ?? "unknown reason."} Try again.`;
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

  let body: GenerateSitePageRequest;
  try {
    body = (await request.json()) as GenerateSitePageRequest;
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

  const inputContentFilter = runContentFilterFailOpen({
    name: input.name,
    ticker: input.ticker,
    description: input.description,
  });
  if (inputContentFilter.blocked) {
    void recordAdminActivityBestEffort({
      kind: "content-filter-rejected",
      serviceKey: "website-generation",
      message: `Content filter rejected a generate-site-page input (field: ${inputContentFilter.field}).`,
    });
    return NextResponse.json(
      { error: contentFilterRejectionMessage(inputContentFilter.field) },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const authorisation = await authoriseBespokeSiteGeneration({
    proof: body.accessProof,
    project: input,
    requestOrigin: request.headers.get("origin") || "",
  });
  if (authorisation.status === "invalid-proof") {
    return NextResponse.json(
      {
        code: "bespoke-wallet-proof-required",
        error: authorisation.message,
      },
      { status: 401, headers: noStoreHeaders(rateHeaders) },
    );
  }
  if (authorisation.status === "unavailable") {
    return NextResponse.json(
      {
        code: "bespoke-access-unavailable",
        error: authorisation.message,
      },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }
  if (authorisation.status === "upsell") {
    return NextResponse.json(
      {
        code: "bespoke-plan-required",
        upsell: true,
        message: authorisation.message,
      },
      { status: 403, headers: noStoreHeaders(rateHeaders) },
    );
  }
  if (authorisation.status === "attempts-used") {
    return NextResponse.json(
      {
        code: BESPOKE_ATTEMPTS_USED_CODE,
        upsell: true,
        attempts: authorisation.attempts,
        message: authorisation.message,
      },
      { status: 403, headers: noStoreHeaders(rateHeaders) },
    );
  }

  // Paid access has been decided by the server before provider resolution or
  // any request that can spend AI tokens. Client state never reaches this line
  // on its own.
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

  const model = ai.model;
  // The paid full page runs on gpt-5 (owner decision, 6 Sep 2026); the two
  // analysis stages stay on the runtime's cheaper model.
  const pageModel = resolveBespokePageModel(process.env, ai);
  const bespokeCostCapUsd = readBespokeSiteCostCapUsd(process.env);
  const encoder = new TextEncoder();
  const walletAddress = authorisation.walletAddress;
  const accessSource: AiOperationAccessSource = authorisation.accessSource ?? "unknown";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const startedAt = Date.now();
      const recordBespokeCost = (featureKey: string, response: OpenAIResponse | undefined, stageModel = model) => {
        runAfterResponse(() =>
          recordTextOperationCostBestEffort({
            featureKey,
            walletAddress,
            accessSource,
            provider: ai.source,
            response,
            fallbackModel: stageModel,
          }),
        );
      };
      /** What one full-page attempt cost, from the provider's own usage — the same maths the cost ledger records. */
      const fullPageAttemptCostUsd = (response: OpenAIResponse | undefined): number | null => {
        const usage = extractOpenAIUsage(response);
        if (!usage) return null;
        return calculateTextCostUsd({ ...usage, webSearchCallCount: 0 }, readAiPricingRatesForModel(pageModel));
      };
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
            (stage) =>
              requestOpenAI(ai, artworkBody, ANALYSIS_TIMEOUT_MS, stage).then((result) => {
                recordBespokeCost(
                  stage === "page-artwork-analysis-retry" ? AI_FEATURE_KEYS.BESPOKE_ARTWORK_IDENTITY_RETRY : AI_FEATURE_KEYS.BESPOKE_ARTWORK_IDENTITY,
                  result.ok ? result.payload : undefined,
                );
                return result;
              }),
            {
              first: "page-artwork-analysis",
              retry: "page-artwork-analysis-retry",
              parseFailure: "page-artwork-analysis-parse",
            },
          ),
          inspirationBody
            ? requestOpenAI(ai, inspirationBody, ANALYSIS_TIMEOUT_MS, "page-inspiration-analysis").then((result) => {
                recordBespokeCost(AI_FEATURE_KEYS.BESPOKE_INSPIRATION_SEARCH, result.ok ? result.payload : undefined);
                return result;
              })
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
        const acceptance = FREE_REIN_ACCEPTANCE_PROFILE;

        send({ type: "progress", stage: "building-page" });

        let lastProgressAt = Date.now();
        const onBuildingPageProgress = () => {
          const now = Date.now();
          if (now - lastProgressAt >= BUILDING_PAGE_PROGRESS_INTERVAL_MS) {
            lastProgressAt = now;
            send({ type: "progress", stage: "building-page" });
          }
        };

        let generation = await requestStreamedFullPageGeneration(
          ai,
          buildGeneratedSitePageRequestBody(input, pageModel, artworkIdentity, inspirationAnalysis),
          request.signal,
          onBuildingPageProgress,
        );
        recordBespokeCost(AI_FEATURE_KEYS.BESPOKE_FULL_PAGE, generation.ok ? generation.payload : generation.usageMetadata, pageModel);

        // One automatic retry with corrective feedback when the only problem
        // was the responsive-layout baseline (issue #323) or, since 11 Sep
        // 2026, the size limit (a free-rein gpt-5 page overshooting 90,000
        // bytes — the model cannot count characters). Every other rejection
        // reason (missing section, unsafe embed, wrong evidence id) still
        // fails on the first attempt. The retry is the only multiplier on a
        // single sale, so it is skipped when this attempt plus a like-sized
        // second one would pass the per-site cost cap (owner decision, 6 Sep
        // 2026) or the route's own time budget — the user sees the same
        // failure, named, and decides whether to try again.
        let retrySkippedReason: "cost-cap" | "time-budget" | null = null;
        if (generation.ok) {
          const firstRejection = describeGeneratedSitePageRejectionDetail(generation.payload, briefIds, acceptance);
          const retryFeedback =
            firstRejection.reason === "layout"
              ? LAYOUT_RETRY_CORRECTIVE_FEEDBACK
              : firstRejection.code === "too-long"
                ? buildOversizeRetryCorrectiveFeedback(firstRejection.htmlBytes ?? 0)
                : null;
          if (retryFeedback) {
            const retryLabel = firstRejection.reason === "layout" ? "layout" : "oversize";
            const firstAttemptCost = fullPageAttemptCostUsd(generation.payload);
            const retryWouldPassCap = firstAttemptCost !== null && firstAttemptCost * 2 > bespokeCostCapUsd;
            const elapsedMs = Date.now() - startedAt;
            const retryWouldPassTimeBudget = elapsedMs > ROUTE_BUDGET_MS * RETRY_TIME_BUDGET_SHARE;
            if (retryWouldPassCap) {
              retrySkippedReason = "cost-cap";
              console.warn(
                `Bespoke ${retryLabel} retry skipped: two attempts would pass the per-site cost cap`,
                JSON.stringify({ firstAttemptCost, bespokeCostCapUsd, pageModel }),
              );
              void recordAdminActivityBestEffort({
                kind: "bespoke-cost-cap-held",
                serviceKey: "website-generation",
                message: `Bespoke ${retryLabel} retry skipped for wallet ${walletAddress}: first attempt ~$${firstAttemptCost.toFixed(3)}, cap $${bespokeCostCapUsd.toFixed(2)}.`,
              });
            } else if (retryWouldPassTimeBudget) {
              retrySkippedReason = "time-budget";
              console.warn(
                `Bespoke ${retryLabel} retry skipped: not enough of the route's time budget remains for a second attempt`,
                JSON.stringify({ elapsedMs, routeBudgetMs: ROUTE_BUDGET_MS, pageModel }),
              );
            } else {
              generation = await requestStreamedFullPageGeneration(
                ai,
                buildGeneratedSitePageRequestBody(input, pageModel, artworkIdentity, inspirationAnalysis, retryFeedback),
                request.signal,
                onBuildingPageProgress,
              );
              recordBespokeCost(AI_FEATURE_KEYS.BESPOKE_FULL_PAGE_LAYOUT_RETRY, generation.ok ? generation.payload : generation.usageMetadata, pageModel);
            }
          }
        }

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
          // Name the rule that fired — in the server log, the admin Activity
          // log (so /admin's "Last generation outcome" is no longer blank) and
          // the studio's own error line (owner report, 11 Sep 2026).
          const rejection = describeGeneratedSitePageRejectionDetail(generation.payload, briefIds, acceptance);
          const retryNote =
            retrySkippedReason === "cost-cap"
              ? " Retry skipped: cost cap."
              : retrySkippedReason === "time-budget"
                ? " Retry skipped: time budget."
                : "";
          // The model's own token usage on the refused attempt (owner report,
          // 12 Sep 2026: a page came back at 0 characters). Reasoning tokens
          // count against the same max_output_tokens as the visible page, so
          // "output near the budget, most of it reasoning" is the signature of
          // a model that thought its budget away and had nothing left to write
          // the page with — visible here rather than inferred.
          const usage = extractOpenAIUsage(generation.payload);
          const usageNote = usage
            ? ` Output ${formatCount(usage.outputTokens)} tokens (${formatCount(usage.reasoningTokens)} reasoning) of the ${formatCount(BESPOKE_PAGE_MAX_OUTPUT_TOKENS)} budget.`
            : " Token usage not reported by the provider.";
          console.warn(
            "Bespoke page rejected by the acceptance checks",
            JSON.stringify({
              code: rejection.code,
              message: rejection.message,
              htmlBytes: rejection.htmlBytes,
              pageModel,
              retrySkippedReason,
              outputTokens: usage?.outputTokens ?? null,
              reasoningTokens: usage?.reasoningTokens ?? null,
              maxOutputTokens: BESPOKE_PAGE_MAX_OUTPUT_TOKENS,
            }),
          );
          void recordAdminActivityBestEffort({
            kind: "bespoke-page-rejected",
            serviceKey: "website-generation",
            message: `Bespoke page rejected (${rejection.code ?? "unknown"}): ${rejection.message ?? "no detail."}${retryNote}${usageNote} Model ${pageModel}, wallet ${walletAddress}.`,
          });
          send({
            type: "error",
            error: bespokeRejectionUserMessage(rejection),
            providerError: {
              stage: "full-page-generation-parse",
              provider: ai.source,
              kind: "invalid",
              status: null,
              detail: `${rejection.code ?? "unknown"}: ${rejection.message ?? "The generated document failed the server-side checks."}`,
            },
          });
          close();
          return;
        }

        const outputContentFilter = runContentFilterFailOpen({ html: page.html });
        if (outputContentFilter.blocked) {
          void recordAdminActivityBestEffort({
            kind: "content-filter-rejected",
            serviceKey: "website-generation",
            message: "Content filter rejected generated site-page output before it reached the client.",
          });
          send({
            type: "error",
            error: "The generated website could not be delivered because it failed our content safety filter. Try again.",
          });
          close();
          return;
        }

        // Real links (owner direction, 6 Sep 2026): the real X / Telegram handles
        // go in now; any social / venue / explorer URL the model invented is
        // re-aimed; Buy / explorer / contract placeholders wait for serve time.
        const deliveredHtml = enforceBespokeLinks(page.html, { xHandle: input.xHandle ?? "", telegram: input.telegram ?? "" });

        // Three per purchase (owner decision, 6 Sep 2026): count the page only
        // now that it is genuinely being delivered — a failed or rejected
        // attempt never costs the buyer a design. Counting failure never
        // withholds a paid page; it is logged and the count catches up next time.
        let attemptsAfter: BespokeAttempts | undefined;
        if (authorisation.attempts) {
          try {
            await getBespokeSiteGenerationsStore().record({
              walletAddress,
              projectHash: hashBespokeSiteProject(input),
              model: pageModel,
            });
            attemptsAfter = bespokeAttempts(
              authorisation.attempts.allowance / BESPOKE_GENERATIONS_PER_PURCHASE,
              authorisation.attempts.used + 1,
            );
          } catch (error) {
            console.error("Bespoke generation could not be counted", error instanceof Error ? error.message : error);
            attemptsAfter = authorisation.attempts;
          }
        }

        send({
          type: "complete",
          html: deliveredHtml,
          source: ai.source,
          inspirationUsed: Boolean(input.inspirationUrl),
          ...(attemptsAfter ? { attempts: attemptsAfter } : {}),
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
