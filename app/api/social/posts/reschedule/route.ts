import { NextResponse } from "next/server";
import {
  SOCIAL_STUDIO_ACTION_LIMIT,
  consumeSocialStudioActionRateLimit,
  getClientIp,
  isSocialStudioRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { getSocialScheduledPostsStore } from "@/lib/server/social-scheduled-posts-store";
import { authoriseSocialStudioAction, type AuthoriseSocialStudioActionResult } from "@/lib/server/social-studio-action-auth";

// Reschedules an approved-but-not-yet-sent post to a new time (issue #380).
// There was previously no way to do this at all: the datetime picker in the
// "Approved & scheduled" section had nothing to submit to. Implemented as
// cancel-the-old + create-a-new-one, reusing the existing store's cancel()
// and create() exactly as the Cancel button already does — this file never
// touches lib/server/social-scheduled-posts-store.ts or the posting cron.
// The result is a fresh row (a new id) at the new time; the old row is left
// canceled rather than mutated in place, so the change is visible in History
// instead of silently rewriting what was approved.

export const runtime = "nodejs";

function responseHeaders(rate: ReturnType<typeof consumeSocialStudioActionRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(SOCIAL_STUDIO_ACTION_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function authFailureResponse(result: Exclude<AuthoriseSocialStudioActionResult, { status: "ok" }>, headers: Record<string, string>) {
  if (result.status === "expired") return NextResponse.json({ error: "The reschedule challenge expired. Try again." }, { status: 410, headers });
  if (result.status === "replayed") return NextResponse.json({ error: "That reschedule challenge has already been used." }, { status: 409, headers });
  return NextResponse.json({ error: "Wallet authorisation failed." }, { status: 401, headers });
}

export async function POST(request: Request) {
  if (!isSocialStudioRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const rate = consumeSocialStudioActionRateLimit(getClientIp(request));
  const headers = responseHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("social-posting");
  if (isolationResponse) return isolationResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const postId = typeof body?.postId === "string" ? body.postId.trim() : "";
  const scheduledAtInput = typeof body?.scheduledAt === "string" ? body.scheduledAt.trim() : "";
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(postId) || !challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A valid post id, reschedule challenge and signature are required." }, { status: 400, headers });
  }
  const scheduledAt = new Date(scheduledAtInput);
  if (!scheduledAtInput || Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: "The scheduled time is not a valid date." }, { status: 400, headers });
  }

  const authorisation = await authoriseSocialStudioAction({
    purpose: "social:post-reschedule",
    payload: { postId, scheduledAt: scheduledAt.toISOString() },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, headers);

  const store = getSocialScheduledPostsStore();
  const existing = await store.get(postId);
  if (!existing || existing.walletAddress.toLowerCase() !== authorisation.walletAddress.toLowerCase()) {
    return NextResponse.json({ error: "That scheduled post could not be found." }, { status: 404, headers });
  }
  if (existing.status !== "scheduled") {
    return NextResponse.json({ error: "That post has already sent, failed or been canceled." }, { status: 409, headers });
  }

  const cancelResult = await store.cancel(postId, authorisation.walletAddress);
  if (cancelResult.status !== "canceled") {
    return NextResponse.json({ error: "That post could not be rescheduled — it may already be sending." }, { status: 409, headers });
  }

  const post = await store.create({
    walletAddress: authorisation.walletAddress,
    body: existing.body,
    artworkDataUrl: existing.artworkDataUrl,
    destinations: existing.destinations.map((destination) => destination.platform),
    scheduledAt,
    approvedByWallet: authorisation.walletAddress,
  });
  return NextResponse.json({ post, replacedPostId: postId }, { status: 200, headers });
}
