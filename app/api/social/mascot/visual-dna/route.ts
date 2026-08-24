import { NextResponse } from "next/server";
import { AI_FEATURE_KEYS } from "@/lib/ai-feature-keys";
import {
  SOCIAL_MASCOT_DNA_LIMIT,
  consumeSocialMascotDnaRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";
import { getVercelOidcToken, resolveAIResponsesRuntime } from "@/lib/server/ai-responses-runtime";
import { recordTextOperationCostBestEffort, runAfterResponse, type AiOperationAccessSource } from "@/lib/server/ai-operation-cost-store";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { contentFilterRejectionMessage, runContentFilterFailOpen } from "@/lib/server/content-filter";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import {
  buildMascotVisualDnaRequestBody,
  isValidMascotImageDataUrl,
  parseMascotVisualDnaResponse,
} from "@/lib/server/mascot-visual-dna-pipeline";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { authoriseSocialProjectSlot } from "@/lib/server/social-project-slot-entitlement";
import { authoriseSocialStudioRequest } from "@/lib/server/social-studio-entitlement";

export const runtime = "nodejs";
export const maxDuration = 30;

type VisualDnaRequestBody = {
  walletAddress?: unknown;
  projectId?: unknown;
  displayName?: unknown;
  project?: { name?: unknown; ticker?: unknown };
  imageDataUrl?: unknown;
};

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

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
      return NextResponse.json({ error: "Unauthorised mascot-analysis request." }, { status: 401, headers: noStoreHeaders() });
    }
    const rate = consumeSocialMascotDnaRateLimit(getClientIp(request));
    rateHeaders = {
      "RateLimit-Limit": String(SOCIAL_MASCOT_DNA_LIMIT),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Mascot-analysis rate limit exceeded. Try again later." },
        { status: 429, headers: noStoreHeaders({ ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) }) },
      );
    }
  }

  const isolationResponse = await getServiceIsolationResponse("social-studio-ai");
  if (isolationResponse) return isolationResponse;

  let body: VisualDnaRequestBody;
  try {
    body = (await request.json()) as VisualDnaRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }

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
      {
        error: projectSlot.message,
        code: "social-studio-project-slot-limit",
        activeCount: projectSlot.activeCount,
        limit: projectSlot.limit,
      },
      { status: 403, headers: noStoreHeaders(rateHeaders) },
    );
  }
  if (projectSlot.status === "unavailable") {
    return NextResponse.json({ error: projectSlot.message }, { status: 503, headers: noStoreHeaders(rateHeaders) });
  }

  const name = typeof body.project?.name === "string" ? body.project.name.trim() : "";
  const ticker = typeof body.project?.ticker === "string" ? body.project.ticker.trim() : "";
  if (!name || !ticker) {
    return NextResponse.json({ error: "A project name and ticker are required." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }
  if (!isValidMascotImageDataUrl(body.imageDataUrl)) {
    return NextResponse.json({ error: "Upload a valid mascot reference image." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }

  const inputContentFilter = runContentFilterFailOpen({ name, ticker });
  if (inputContentFilter.blocked) {
    void recordAdminActivityBestEffort({
      kind: "content-filter-rejected",
      serviceKey: "social-studio-ai",
      message: `Content filter rejected a mascot visual-DNA input (field: ${inputContentFilter.field}, wallet: ${authorisation.walletAddress}).`,
    });
    return NextResponse.json(
      { error: contentFilterRejectionMessage(inputContentFilter.field) },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const ai = resolveAIResponsesRuntime(process.env, getVercelOidcToken(request));
  if (!ai) {
    return NextResponse.json(
      { error: "AI mascot analysis is not configured on this deployment." },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let response: Response;
  try {
    response = await fetch(ai.responsesUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildMascotVisualDnaRequestBody({ name, ticker }, body.imageDataUrl, ai.model)),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    console.error("Mascot visual-DNA request failed before receiving a response", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "The mascot-analysis request could not reach the AI provider. Try again." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    console.error("Mascot visual-DNA request failed", response.status, message.slice(0, 500));
    return NextResponse.json(
      { error: "The mascot-analysis request failed. Try again." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
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
      featureKey: AI_FEATURE_KEYS.SOCIAL_MASCOT_ANALYSIS,
      walletAddress,
      accessSource,
      provider: ai.source,
      response: payload,
      fallbackModel: ai.model,
    }),
  );

  const mascotVisualDNA = parseMascotVisualDnaResponse(payload);
  if (!mascotVisualDNA) {
    return NextResponse.json(
      { error: "The AI could not extract a mascot identity from that image. Try a clearer image." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const outputContentFilter = runContentFilterFailOpen({
    characterDescription: mascotVisualDNA.characterDescription,
    colourPalette: mascotVisualDNA.colourPalette,
    signatureProps: mascotVisualDNA.signatureProps,
    artStyle: mascotVisualDNA.artStyle,
  });
  if (outputContentFilter.blocked) {
    void recordAdminActivityBestEffort({
      kind: "content-filter-rejected",
      serviceKey: "social-studio-ai",
      message: `Content filter rejected generated mascot visual-DNA output before it reached the client (wallet: ${authorisation.walletAddress}).`,
    });
    return NextResponse.json(
      { error: "The mascot identity could not be delivered because it failed our content safety filter. Try again." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  return NextResponse.json({ mascotVisualDNA }, { headers: noStoreHeaders(rateHeaders) });
}
