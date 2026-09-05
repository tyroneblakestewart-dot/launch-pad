import { NextResponse } from "next/server";
import { AI_FEATURE_KEYS } from "@/lib/ai-feature-keys";
import {
  SOCIAL_MASCOT_IMAGE_LIMIT,
  consumeSocialMascotImageRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";
import { getVercelOidcToken, resolveAIResponsesRuntime } from "@/lib/server/ai-responses-runtime";
import { recordImageOperationCostBestEffort, runAfterResponse, type AiOperationAccessSource } from "@/lib/server/ai-operation-cost-store";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { contentFilterRejectionMessage, runContentFilterFailOpen } from "@/lib/server/content-filter";
import { buildMascotImagePrompt, type MascotVisualDNA } from "@/lib/server/mascot-prompt-builder";
import { requestMascotImage } from "@/lib/server/mascot-image-request";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { authoriseSocialProjectSlot } from "@/lib/server/social-project-slot-entitlement";
import { authoriseSocialStudioRequest } from "@/lib/server/social-studio-entitlement";
import { isAddress } from "viem";
import { buildMascotImageUsage, utcDayKey } from "@/lib/mascot-image-allowance";
import { MAX_MASCOT_IMAGES_PER_DAY } from "@/lib/social-studio-types";
import { MascotImageUsageStoreUnavailableError, getMascotImageUsageStore } from "@/lib/server/mascot-image-usage-store";

export const runtime = "nodejs";
export const maxDuration = 45;

type MascotImageRequestBody = {
  walletAddress?: unknown;
  projectId?: unknown;
  displayName?: unknown;
  project?: { name?: unknown; ticker?: unknown };
  mascotVisualDNA?: unknown;
  sceneInput?: unknown;
};

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

function isMascotVisualDNA(value: unknown): value is MascotVisualDNA {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.characterDescription === "string" &&
    typeof candidate.colourPalette === "string" &&
    typeof candidate.signatureProps === "string" &&
    typeof candidate.artStyle === "string"
  );
}

/** The allowance is per token: keyed by the browser project id the slot registry already uses, or "default" when a caller carries none. */
function allowanceProjectKey(projectId: unknown): string {
  return typeof projectId === "string" && projectId.trim() ? projectId.trim().slice(0, 200) : "default";
}

/**
 * Today's allowance for the rail pill and the Generate button. Same shared
 * secret + Origin gate as every Social Studio route; a bad wallet is a 400.
 * Fails closed to 503 when the usage table can't be reached, so the UI shows
 * "unknown" rather than a made-up count.
 */
export async function GET(request: Request) {
  const sharedSecret = process.env.GENERATE_SITE_STYLE_SHARED_SECRET || "";
  const allowedOrigin = process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN || "https://hoodlums.dev";
  if (sharedSecret && !isGenerateSiteStyleRequestAuthorised(request, sharedSecret, allowedOrigin)) {
    return NextResponse.json({ error: "Unauthorised mascot-image usage request." }, { status: 401, headers: noStoreHeaders() });
  }
  const url = new URL(request.url);
  const walletAddress = (url.searchParams.get("walletAddress") || "").trim();
  if (!isAddress(walletAddress)) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400, headers: noStoreHeaders() });
  }
  const projectKey = allowanceProjectKey(url.searchParams.get("projectId"));
  try {
    const usedToday = await getMascotImageUsageStore().usage(walletAddress, projectKey, utcDayKey());
    return NextResponse.json({ usage: buildMascotImageUsage(usedToday) }, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof MascotImageUsageStoreUnavailableError) {
      return NextResponse.json({ error: "The daily image allowance could not be read." }, { status: 503, headers: noStoreHeaders() });
    }
    console.error("Mascot image usage read failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The daily image allowance could not be read." }, { status: 503, headers: noStoreHeaders() });
  }
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
      return NextResponse.json({ error: "Unauthorised mascot-image request." }, { status: 401, headers: noStoreHeaders() });
    }
    const rate = consumeSocialMascotImageRateLimit(getClientIp(request));
    rateHeaders = {
      "RateLimit-Limit": String(SOCIAL_MASCOT_IMAGE_LIMIT),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Mascot-image rate limit exceeded. Try again later." },
        { status: 429, headers: noStoreHeaders({ ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) }) },
      );
    }
  }

  const isolationResponse = await getServiceIsolationResponse("social-studio-ai");
  if (isolationResponse) return isolationResponse;

  let body: MascotImageRequestBody;
  try {
    body = (await request.json()) as MascotImageRequestBody;
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
  const sceneInput = typeof body.sceneInput === "string" ? body.sceneInput.trim().slice(0, 200) : "";
  if (!name || !ticker) {
    return NextResponse.json({ error: "A project name and ticker are required." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }
  if (!sceneInput) {
    return NextResponse.json({ error: "Choose or describe a scene for the mascot." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }
  if (!isMascotVisualDNA(body.mascotVisualDNA)) {
    return NextResponse.json(
      { error: "Upload a mascot reference image first so its visual identity can be locked in." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const inputContentFilter = runContentFilterFailOpen({ name, ticker, sceneInput });
  if (inputContentFilter.blocked) {
    void recordAdminActivityBestEffort({
      kind: "content-filter-rejected",
      serviceKey: "social-studio-ai",
      message: `Content filter rejected a mascot-image input (field: ${inputContentFilter.field}, wallet: ${authorisation.walletAddress}).`,
    });
    return NextResponse.json(
      { error: contentFilterRejectionMessage(inputContentFilter.field) },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  // Daily allowance (owner decision, 5 Sep 2026): two images per token per UTC
  // day, hard-blocked at the cap. Reserved atomically BEFORE any paid call, and
  // fails closed — if the count can't be read, no image is generated.
  const usageStore = getMascotImageUsageStore();
  const projectKey = allowanceProjectKey(body.projectId);
  const day = utcDayKey();
  let reservation: Awaited<ReturnType<typeof usageStore.reserve>>;
  try {
    reservation = await usageStore.reserve(authorisation.walletAddress, projectKey, day, MAX_MASCOT_IMAGES_PER_DAY);
  } catch (error) {
    if (!(error instanceof MascotImageUsageStoreUnavailableError)) {
      console.error("Mascot image allowance check failed", error instanceof Error ? error.message : error);
    }
    return NextResponse.json(
      { error: "The daily image allowance could not be checked. No image was generated." },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }
  if (!reservation.allowed) {
    const usage = buildMascotImageUsage(reservation.usedToday);
    return NextResponse.json(
      {
        error: `You've used today's ${usage.limit} mascot images for this token. The allowance resets at midnight UTC.`,
        code: "social-studio-daily-image-limit",
        usage,
      },
      { status: 403, headers: noStoreHeaders(rateHeaders) },
    );
  }
  const releaseReservation = () =>
    usageStore.release(authorisation.walletAddress, projectKey, day).catch((error) => {
      console.error("Mascot image allowance release failed", error instanceof Error ? error.message : error);
    });

  const ai = resolveAIResponsesRuntime(process.env, getVercelOidcToken(request));
  if (!ai) {
    await releaseReservation();
    return NextResponse.json(
      { error: "AI image generation is not configured on this deployment." },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const { prompt } = buildMascotImagePrompt(body.mascotVisualDNA, sceneInput, { name, ticker });
  const result = await requestMascotImage(ai, prompt);

  if (!result.ok) {
    // A failed generation costs nothing, so it must not spend the allowance.
    await releaseReservation();
    if (result.kind === "unsupported-provider") {
      return NextResponse.json(
        {
          error:
            "Mascot image generation needs a direct OpenAI API key on this deployment; it isn't available through the fallback AI gateway yet.",
        },
        { status: 503, headers: noStoreHeaders(rateHeaders) },
      );
    }
    return NextResponse.json(
      { error: "Mascot image generation failed. Try again." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const walletAddress = authorisation.walletAddress;
  const accessSource: AiOperationAccessSource = authorisation.accessSource ?? "unknown";
  runAfterResponse(() =>
    recordImageOperationCostBestEffort({
      featureKey: AI_FEATURE_KEYS.SOCIAL_MASCOT_IMAGE,
      walletAddress,
      accessSource,
      provider: ai.source,
      model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1",
      imageCount: 1,
    }),
  );

  return NextResponse.json(
    { imageDataUrl: result.imageDataUrl, usage: buildMascotImageUsage(reservation.usedToday) },
    { headers: noStoreHeaders(rateHeaders) },
  );
}
