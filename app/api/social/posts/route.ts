import { NextResponse } from "next/server";
import { isAddress } from "viem";
import {
  SOCIAL_STUDIO_ACTION_LIMIT,
  SOCIAL_STUDIO_READ_LIMIT,
  consumeSocialStudioActionRateLimit,
  consumeSocialStudioReadRateLimit,
  getClientIp,
  isSocialStudioRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { findDuplicateScheduledPost } from "@/lib/server/social-post-duplicate-detection";
import { X_DRAFT_CHARACTER_LIMIT } from "@/lib/server/social-draft-pipeline";
import { getSocialConnectionsStore, isSocialPlatform, type SocialPlatform } from "@/lib/server/social-connections-store";
import {
  SocialScheduledPostsStoreUnavailableError,
  getSocialScheduledPostsStore,
} from "@/lib/server/social-scheduled-posts-store";
import { authoriseSocialStudioAction, type AuthoriseSocialStudioActionResult } from "@/lib/server/social-studio-action-auth";
import { parseArtwork } from "@/lib/server/telegram";

// Approve-first scheduled post queue (issue #335, Mode 1 "review & release").
// POST here IS the approval — there is no separate unapproved state stored
// server-side (drafts stay local in IndexedDB until this point), so
// "unapproved posts never send" holds by construction. Wallet-signed via
// the shared challenge flow, purpose "social:post-create". Destinations are
// validated against the wallet's actually-connected accounts before a row
// is ever written, and default the scheduled time to "now" (approve = send
// as soon as the cron next runs) when the caller doesn't set one.

export const runtime = "nodejs";
export const MAX_POST_BODY_LENGTH = 2000;

function actionHeaders(rate: ReturnType<typeof consumeSocialStudioActionRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(SOCIAL_STUDIO_ACTION_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function readHeaders(rate: ReturnType<typeof consumeSocialStudioReadRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(SOCIAL_STUDIO_READ_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function authFailureResponse(result: Exclude<AuthoriseSocialStudioActionResult, { status: "ok" }>, headers: Record<string, string>) {
  if (result.status === "expired") return NextResponse.json({ error: "The approval challenge expired. Try again." }, { status: 410, headers });
  if (result.status === "replayed") return NextResponse.json({ error: "That approval challenge has already been used." }, { status: 409, headers });
  return NextResponse.json({ error: "Wallet authorisation failed." }, { status: 401, headers });
}

export async function GET(request: Request) {
  // Plain GET reads don't gate on an Origin header, matching the existing
  // hoodchat/token-chat GET routes — same-page GET fetches often omit one.
  const rate = consumeSocialStudioReadRateLimit(getClientIp(request));
  const headers = readHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("social-posting");
  if (isolationResponse) return isolationResponse;

  const walletAddress = new URL(request.url).searchParams.get("walletAddress") || "";
  if (!isAddress(walletAddress)) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400, headers });
  }

  const posts = await getSocialScheduledPostsStore().list(walletAddress);
  return NextResponse.json({ posts }, { status: 200, headers });
}

export async function POST(request: Request) {
  if (!isSocialStudioRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const rate = consumeSocialStudioActionRateLimit(getClientIp(request));
  const headers = actionHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("social-posting");
  if (isolationResponse) return isolationResponse;

  const requestBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const postBody = typeof requestBody?.body === "string" ? requestBody.body.trim() : "";
  const artworkDataUrlRaw = typeof requestBody?.artworkDataUrl === "string" ? requestBody.artworkDataUrl.trim() : "";
  const destinationsInput = Array.isArray(requestBody?.destinations) ? requestBody.destinations : [];
  const scheduledAtInput = typeof requestBody?.scheduledAt === "string" ? requestBody.scheduledAt.trim() : "";
  const challengeId = typeof requestBody?.challengeId === "string" ? requestBody.challengeId.trim() : "";
  const nonce = typeof requestBody?.nonce === "string" ? requestBody.nonce.trim() : "";
  const signature = typeof requestBody?.signature === "string" ? requestBody.signature.trim() : "";

  if (!postBody || postBody.length > MAX_POST_BODY_LENGTH) {
    return NextResponse.json({ error: `The post must be between 1 and ${MAX_POST_BODY_LENGTH} characters.` }, { status: 400, headers });
  }
  const destinations = [...new Set(destinationsInput)] as unknown[];
  if (destinations.length === 0 || !destinations.every(isSocialPlatform)) {
    return NextResponse.json({ error: "Select at least one valid destination (x, telegram)." }, { status: 400, headers });
  }
  const typedDestinations = destinations as SocialPlatform[];
  if (typedDestinations.includes("x") && postBody.length > X_DRAFT_CHARACTER_LIMIT) {
    return NextResponse.json({ error: `Posts going to X must be ${X_DRAFT_CHARACTER_LIMIT} characters or fewer.` }, { status: 400, headers });
  }
  if (artworkDataUrlRaw && !parseArtwork(artworkDataUrlRaw)) {
    return NextResponse.json({ error: "Artwork must be a PNG, JPG or WEBP image below 3 MB." }, { status: 400, headers });
  }
  const scheduledAt = scheduledAtInput ? new Date(scheduledAtInput) : new Date();
  if (Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: "The scheduled time is not a valid date." }, { status: 400, headers });
  }
  if (!challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A valid approval challenge and signature are required." }, { status: 400, headers });
  }

  const authorisation = await authoriseSocialStudioAction({
    purpose: "social:post-create",
    payload: { body: postBody, destinations: [...typedDestinations].sort().join(","), scheduledAt: scheduledAt.toISOString() },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, headers);

  const connectionsStore = getSocialConnectionsStore();
  const unavailableDestinations: SocialPlatform[] = [];
  for (const platform of typedDestinations) {
    const connection = await connectionsStore.get(authorisation.walletAddress, platform);
    if (!connection || connection.status !== "connected") unavailableDestinations.push(platform);
  }
  if (unavailableDestinations.length > 0) {
    return NextResponse.json(
      { error: `Connect ${unavailableDestinations.join(" and ")} before approving a post to it.` },
      { status: 409, headers },
    );
  }

  try {
    const store = getSocialScheduledPostsStore();
    // Idempotent approval (issue #380): a retried or double-tapped approval
    // of the same still-pending draft must not create a second post that
    // sends independently — that was the direct cause of a production
    // duplicate-send incident. Rather than a DB constraint (which would
    // require a schema change to the locked social-scheduled-posts-store.ts
    // file, since the client already creates one row per destination), this
    // looks for an identical, still-`scheduled` post created in the last few
    // minutes and replaces it instead of adding another — see
    // lib/server/social-post-duplicate-detection.ts.
    const recentPosts = await store.list(authorisation.walletAddress, 50);
    const duplicate = findDuplicateScheduledPost(
      recentPosts,
      { body: postBody, destinations: typedDestinations },
      Date.now(),
    );
    if (duplicate) {
      await store.cancel(duplicate.id, authorisation.walletAddress);
    }
    const post = await store.create({
      walletAddress: authorisation.walletAddress,
      body: postBody,
      artworkDataUrl: artworkDataUrlRaw || null,
      destinations: typedDestinations,
      scheduledAt,
      approvedByWallet: authorisation.walletAddress,
    });
    return NextResponse.json({ post, replacedPostId: duplicate?.id ?? null }, { status: duplicate ? 200 : 201, headers });
  } catch (error) {
    const unavailable = error instanceof SocialScheduledPostsStoreUnavailableError;
    return NextResponse.json(
      { error: unavailable ? "Social Studio scheduling is not configured on this deployment." : "The post could not be scheduled." },
      { status: unavailable ? 503 : 500, headers },
    );
  }
}
