import { NextResponse } from "next/server";
import { AI_FEATURE_KEYS } from "@/lib/ai-feature-keys";
import {
  SOCIAL_POST_IMAGE_LIMIT,
  consumeSocialPostImageRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";
import { getVercelOidcToken, resolveAIResponsesRuntime } from "@/lib/server/ai-responses-runtime";
import { recordImageOperationCostBestEffort, runAfterResponse, type AiOperationAccessSource } from "@/lib/server/ai-operation-cost-store";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { contentFilterRejectionMessage, runContentFilterFailOpen } from "@/lib/server/content-filter";
import type { MascotVisualDNA } from "@/lib/server/mascot-prompt-builder";
import { requestMascotImage } from "@/lib/server/mascot-image-request";
import { MascotImageUsageStoreUnavailableError, getMascotImageUsageStore } from "@/lib/server/mascot-image-usage-store";
import { MAX_POST_IMAGE_TEXT_LENGTH, buildPostImagePrompt } from "@/lib/server/post-image-prompt";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { authoriseSocialProjectSlot } from "@/lib/server/social-project-slot-entitlement";
import { authoriseSocialStudioRequest } from "@/lib/server/social-studio-entitlement";
import { buildMascotImageUsage, utcDayKey } from "@/lib/mascot-image-allowance";
import { MAX_MASCOT_IMAGES_PER_DAY } from "@/lib/social-studio-types";

export const runtime = "nodejs";
export const maxDuration = 45;

// AI image for one approved post (owner decision, 6 Sep 2026). Same
// protection stack as /api/social/mascot/image — shared secret + Origin,
// per-IP rate limit, service isolation, Pro entitlement, project slot,
// content filter — and the SAME daily allowance table: two AI images per
// token per UTC day, shared with manual mascot scenes, reserved before any
// paid call and released if the provider call fails. The client only ever
// calls this when the user approves a draft the AI picked for an image.

type PostImageRequestBody = {
  walletAddress?: unknown;
  projectId?: unknown;
  displayName?: unknown;
  project?: { name?: unknown; ticker?: unknown; description?: unknown };
  postText?: unknown;
  mascotVisualDNA?: unknown;
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

/** Same key the mascot-image route uses, so both consumers count against one allowance. */
function allowanceProjectKey(projectId: unknown): string {
  return typeof projectId === "string" && projectId.trim() ? projectId.trim().slice(0, 200) : "default";
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
      return NextResponse.json({ error: "Unauthorised post-image request." }, { status: 401, headers: noStoreHeaders() });
    }
    const rate = consumeSocialPostImageRateLimit(getClientIp(request));
    rateHeaders = {
      "RateLimit-Limit": String(SOCIAL_POST_IMAGE_LIMIT),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Post-image rate limit exceeded. Try again later." },
        { status: 429, headers: noStoreHeaders({ ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) }) },
      );
    }
  }

  const isolationResponse = await getServiceIsolationResponse("social-studio-ai");
  if (isolationResponse) return isolationResponse;

  let body: PostImageRequestBody;
  try {
    body = (await request.json()) as PostImageRequestBody;
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
  const description = typeof body.project?.description === "string" ? body.project.description.slice(0, 2000) : "";
  const postText = typeof body.postText === "string" ? body.postText.trim().slice(0, MAX_POST_IMAGE_TEXT_LENGTH) : "";
  if (!name || !ticker) {
    return NextResponse.json({ error: "A project name and ticker are required." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }
  if (!postText) {
    return NextResponse.json({ error: "The post text is required to make an image for it." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }
  const mascotVisualDNA = isMascotVisualDNA(body.mascotVisualDNA) ? body.mascotVisualDNA : null;

  const inputContentFilter = runContentFilterFailOpen({ name, ticker, description, postText });
  if (inputContentFilter.blocked) {
    void recordAdminActivityBestEffort({
      kind: "content-filter-rejected",
      serviceKey: "social-studio-ai",
      message: `Content filter rejected a post-image input (field: ${inputContentFilter.field}, wallet: ${authorisation.walletAddress}).`,
    });
    return NextResponse.json(
      { error: contentFilterRejectionMessage(inputContentFilter.field) },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  // The shared daily allowance, reserved atomically BEFORE any paid call and
  // failing closed: if the count can't be read, no image is generated.
  const usageStore = getMascotImageUsageStore();
  const projectKey = allowanceProjectKey(body.projectId);
  const day = utcDayKey();
  let reservation: Awaited<ReturnType<typeof usageStore.reserve>>;
  try {
    reservation = await usageStore.reserve(authorisation.walletAddress, projectKey, day, MAX_MASCOT_IMAGES_PER_DAY);
  } catch (error) {
    if (!(error instanceof MascotImageUsageStoreUnavailableError)) {
      console.error("Post image allowance check failed", error instanceof Error ? error.message : error);
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
        error: `Today's ${usage.limit} AI images for this token are used. The allowance resets at midnight UTC.`,
        code: "social-studio-daily-image-limit",
        usage,
      },
      { status: 403, headers: noStoreHeaders(rateHeaders) },
    );
  }
  const releaseReservation = () =>
    usageStore.release(authorisation.walletAddress, projectKey, day).catch((error) => {
      console.error("Post image allowance release failed", error instanceof Error ? error.message : error);
    });

  const ai = resolveAIResponsesRuntime(process.env, getVercelOidcToken(request));
  if (!ai) {
    await releaseReservation();
    return NextResponse.json(
      { error: "AI image generation is not configured on this deployment." },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const { prompt, mode } = buildPostImagePrompt({ postText, project: { name, ticker, description }, mascotVisualDNA });
  const result = await requestMascotImage(ai, prompt);

  if (!result.ok) {
    // A failed generation costs nothing, so it must not spend the allowance.
    await releaseReservation();
    if (result.kind === "unsupported-provider") {
      return NextResponse.json(
        {
          error:
            "AI image generation needs a direct OpenAI API key on this deployment; it isn't available through the fallback AI gateway yet.",
        },
        { status: 503, headers: noStoreHeaders(rateHeaders) },
      );
    }
    return NextResponse.json({ error: "The post image could not be generated." }, { status: 502, headers: noStoreHeaders(rateHeaders) });
  }

  const walletAddress = authorisation.walletAddress;
  const accessSource: AiOperationAccessSource = authorisation.accessSource ?? "unknown";
  runAfterResponse(() =>
    recordImageOperationCostBestEffort({
      featureKey: AI_FEATURE_KEYS.SOCIAL_POST_IMAGE,
      walletAddress,
      accessSource,
      provider: ai.source,
      model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1",
      imageCount: 1,
    }),
  );
  // Rule 10: the Activity log records that an image was made, never the post text or the image.
  void recordAdminActivityBestEffort({
    kind: "social-post-image-generated",
    serviceKey: "social-studio-ai",
    message: `AI image made for an approved post (${mode} mode, wallet: ${walletAddress}, project: ${projectKey}).`,
  });

  return NextResponse.json(
    { imageDataUrl: result.imageDataUrl, usage: buildMascotImageUsage(reservation.usedToday), mode },
    { headers: noStoreHeaders(rateHeaders) },
  );
}
