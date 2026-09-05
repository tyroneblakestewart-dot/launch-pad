import { NextResponse } from "next/server";
import { AI_FEATURE_KEYS } from "@/lib/ai-feature-keys";
import {
  SOCIAL_VOICE_SAMPLE_LIMIT,
  consumeSocialVoiceSampleRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";
import { getVercelOidcToken, resolveAIResponsesRuntime } from "@/lib/server/ai-responses-runtime";
import { recordTextOperationCostBestEffort, runAfterResponse, type AiOperationAccessSource } from "@/lib/server/ai-operation-cost-store";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { contentFilterRejectionMessage, runContentFilterFailOpen } from "@/lib/server/content-filter";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { checkDraftFactualRisk } from "@/lib/server/social-draft-pipeline";
import { authoriseSocialProjectSlot } from "@/lib/server/social-project-slot-entitlement";
import { authoriseSocialStudioRequest } from "@/lib/server/social-studio-entitlement";
import {
  buildVoiceSampleRequestBody,
  normalisePersonaLines,
  normaliseSourcePost,
  parseVoiceSampleResponse,
} from "@/lib/server/social-voice-sample-pipeline";

export const runtime = "nodejs";
export const maxDuration = 30;

type VoiceSampleRequestBody = {
  walletAddress?: unknown;
  projectId?: unknown;
  displayName?: unknown;
  project?: { name?: unknown; ticker?: unknown; description?: unknown };
  sourcePost?: unknown;
  personaLines?: unknown;
};

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

/**
 * Sorting-station supply: reshape ONE of the user's pasted posts into one
 * sample about their own project, voice kept, identity strained out. Same
 * protection stack as every other AI Social Studio route — shared secret +
 * Origin, per-IP rate limit, service isolation, Pro entitlement, project
 * slot, content filter in and out, cost metering — plus the draft pipeline's
 * factual-risk guard so a sample can never smuggle an invented claim into the
 * persona bank.
 */
export async function POST(request: Request) {
  const sharedSecret = process.env.GENERATE_SITE_STYLE_SHARED_SECRET || "";
  const allowedOrigin = process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN || "https://hoodlums.dev";
  const protectionEnabled = Boolean(sharedSecret);

  if (!protectionEnabled && process.env.NODE_ENV !== "test") {
    return NextResponse.json(
      { error: "AI Social Studio access protection is not configured." },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  let rateHeaders: Record<string, string> = {};
  if (protectionEnabled) {
    if (!isGenerateSiteStyleRequestAuthorised(request, sharedSecret, allowedOrigin)) {
      return NextResponse.json({ error: "Unauthorised voice-sample request." }, { status: 401, headers: noStoreHeaders() });
    }
    const rate = consumeSocialVoiceSampleRateLimit(getClientIp(request));
    rateHeaders = {
      "RateLimit-Limit": String(SOCIAL_VOICE_SAMPLE_LIMIT),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Voice-sample rate limit exceeded. Try again later." },
        { status: 429, headers: noStoreHeaders({ ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) }) },
      );
    }
  }

  const isolationResponse = await getServiceIsolationResponse("social-studio-ai");
  if (isolationResponse) return isolationResponse;

  let body: VoiceSampleRequestBody;
  try {
    body = (await request.json()) as VoiceSampleRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }

  // Entitlement is decided before any AI request that can spend tokens.
  const authorisation = await authoriseSocialStudioRequest(body.walletAddress);
  if (authorisation.status === "invalid-wallet") {
    return NextResponse.json({ error: authorisation.message }, { status: 401, headers: noStoreHeaders(rateHeaders) });
  }
  if (authorisation.status === "unavailable") {
    return NextResponse.json({ error: authorisation.message }, { status: 503, headers: noStoreHeaders(rateHeaders) });
  }
  if (authorisation.status === "upsell") {
    return NextResponse.json(
      { error: authorisation.message, code: "social-studio-plan-required", upsell: true },
      { status: 403, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const projectSlot = await authoriseSocialProjectSlot(
    authorisation,
    { projectId: body.projectId, displayName: body.displayName },
    { serviceKey: "social-studio-ai" },
  );
  if (projectSlot.status === "invalid-project") {
    return NextResponse.json({ error: projectSlot.message }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }
  if (projectSlot.status === "limit-reached") {
    return NextResponse.json(
      { error: projectSlot.message, code: "social-studio-project-slot-limit", activeCount: projectSlot.activeCount, limit: projectSlot.limit },
      { status: 403, headers: noStoreHeaders(rateHeaders) },
    );
  }
  if (projectSlot.status === "unavailable") {
    return NextResponse.json({ error: projectSlot.message }, { status: 503, headers: noStoreHeaders(rateHeaders) });
  }

  const name = typeof body.project?.name === "string" ? body.project.name.trim() : "";
  const ticker = typeof body.project?.ticker === "string" ? body.project.ticker.trim() : "";
  const description = typeof body.project?.description === "string" ? body.project.description.trim().slice(0, 600) : "";
  if (!name || !ticker) {
    return NextResponse.json({ error: "A project name and ticker are required." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }

  const source = normaliseSourcePost(body.sourcePost);
  if (!source.ok) {
    return NextResponse.json({ error: source.error }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }
  const personaLines = normalisePersonaLines(body.personaLines);

  const inputContentFilter = runContentFilterFailOpen({ name, ticker, description, sourcePost: source.sourcePost });
  if (inputContentFilter.blocked) {
    void recordAdminActivityBestEffort({
      kind: "content-filter-rejected",
      serviceKey: "social-studio-ai",
      message: `Content filter rejected a voice-sample input (field: ${inputContentFilter.field}, wallet: ${authorisation.walletAddress}).`,
    });
    return NextResponse.json(
      { error: contentFilterRejectionMessage(inputContentFilter.field) },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const ai = resolveAIResponsesRuntime(process.env, getVercelOidcToken(request));
  if (!ai) {
    return NextResponse.json(
      { error: "AI voice samples are not configured on this deployment." },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let response: Response;
  try {
    response = await fetch(ai.responsesUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(
        buildVoiceSampleRequestBody({ project: { name, ticker, description }, sourcePost: source.sourcePost, personaLines }, ai.model),
      ),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    console.error("Voice-sample request failed before receiving a response", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "The voice-sample request could not reach the AI provider. Try again." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    console.error("Voice-sample request failed", response.status, message.slice(0, 500));
    return NextResponse.json({ error: "The voice-sample request failed. Try again." }, { status: 502, headers: noStoreHeaders(rateHeaders) });
  }

  let payload: OpenAIResponse;
  try {
    payload = (await response.json()) as OpenAIResponse;
  } catch {
    return NextResponse.json({ error: "The AI returned an invalid response." }, { status: 502, headers: noStoreHeaders(rateHeaders) });
  }

  const walletAddress = authorisation.walletAddress;
  const accessSource: AiOperationAccessSource = authorisation.accessSource ?? "unknown";
  runAfterResponse(() =>
    recordTextOperationCostBestEffort({
      featureKey: AI_FEATURE_KEYS.SOCIAL_VOICE_SAMPLE,
      walletAddress,
      accessSource,
      provider: ai.source,
      response: payload,
      fallbackModel: ai.model,
    }),
  );

  const parsed = parseVoiceSampleResponse(payload);
  if (!parsed.ok) {
    console.error("Voice-sample parse failed", parsed);
    return NextResponse.json(
      { error: parsed.reason === "invalid_sample" ? "The AI response didn't match the expected format. Try again." : "The AI response was incomplete. Try again." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  // A persona line lives for a long time and shapes every future draft, so an
  // invented holder count or listing claim here would be worse than in a
  // single draft. Fail closed, never return an unsafe sample.
  const factualRisk = checkDraftFactualRisk({ xText: parsed.sample, telegramText: parsed.sample });
  if (factualRisk.violated) {
    return NextResponse.json(
      { error: "The reshaped sample invented a fact that isn't in your project details. Try again." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const outputContentFilter = runContentFilterFailOpen({ sample: parsed.sample });
  if (outputContentFilter.blocked) {
    void recordAdminActivityBestEffort({
      kind: "content-filter-rejected",
      serviceKey: "social-studio-ai",
      message: `Content filter rejected a generated voice sample before it reached the client (wallet: ${authorisation.walletAddress}).`,
    });
    return NextResponse.json(
      { error: "The reshaped sample could not be delivered because it failed our content safety filter. Try again." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  return NextResponse.json({ sample: parsed.sample }, { headers: noStoreHeaders(rateHeaders) });
}
