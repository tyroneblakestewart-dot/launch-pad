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

// Cancels a scheduled-not-yet-sent post (issue #335). Wallet-signed via the
// shared challenge flow, purpose "social:post-cancel", bound to the exact
// post id so a signature can't be replayed to cancel a different post.

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
  if (result.status === "expired") return NextResponse.json({ error: "The cancel challenge expired. Try again." }, { status: 410, headers });
  if (result.status === "replayed") return NextResponse.json({ error: "That cancel challenge has already been used." }, { status: 409, headers });
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
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(postId) || !challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A valid post id, cancel challenge and signature are required." }, { status: 400, headers });
  }

  const authorisation = await authoriseSocialStudioAction({
    purpose: "social:post-cancel",
    payload: { postId },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, headers);

  const result = await getSocialScheduledPostsStore().cancel(postId, authorisation.walletAddress);
  if (result.status === "not_found") {
    return NextResponse.json({ error: "That scheduled post could not be found." }, { status: 404, headers });
  }
  if (result.status === "not_cancelable") {
    return NextResponse.json({ error: "That post has already sent, failed or been canceled." }, { status: 409, headers });
  }

  return NextResponse.json({ ok: true }, { status: 200, headers });
}
