import { NextResponse } from "next/server";
import { isAddress } from "viem";
import {
  SOCIAL_STUDIO_ACTION_LIMIT,
  consumeSocialStudioActionRateLimit,
  consumeSocialStudioReadRateLimit,
  getClientIp,
  isSocialStudioRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import {
  SOCIAL_APPROVAL_SESSION_PAYLOAD,
  SOCIAL_APPROVAL_SESSION_PURPOSE,
  SOCIAL_APPROVAL_SESSION_TTL_MS,
  createSocialApprovalSessionToken,
  hashSocialApprovalSessionToken,
  parseSocialApprovalSessionCookie,
  readSocialApprovalSession,
  socialApprovalSessionCookieOptions,
} from "@/lib/server/social-approval-session";
import {
  SocialApprovalSessionStoreUnavailableError,
  getSocialApprovalSessionStore,
} from "@/lib/server/social-approval-session-store";
import { authoriseSocialStudioAction } from "@/lib/server/social-studio-action-auth";

// One wallet signature unlocks post approvals for 24 hours (owner direction,
// 6 Sep 2026: "it shouldn't need a signature every approval"). POST takes the
// shared /api/social/challenge flow's signed proof (purpose
// "social:approval-session"), stores the token's hash and sets the httpOnly
// cookie; GET says whether the cookie is live for a given wallet; DELETE
// locks approvals again. The session authorises POST /api/social/posts for
// that wallet only — every other wallet-signed action is unchanged.

export const runtime = "nodejs";

function noStore(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

function actionHeaders(rate: ReturnType<typeof consumeSocialStudioActionRateLimit>) {
  return noStore({
    "X-RateLimit-Limit": String(SOCIAL_STUDIO_ACTION_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  });
}

export async function GET(request: Request) {
  const rate = consumeSocialStudioReadRateLimit(getClientIp(request));
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: noStore({ "Retry-After": String(rate.retryAfterSeconds) }) });
  }
  const isolationResponse = await getServiceIsolationResponse("social-posting");
  if (isolationResponse) return isolationResponse;

  const walletAddress = new URL(request.url).searchParams.get("walletAddress") || "";
  if (!isAddress(walletAddress)) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400, headers: noStore() });
  }
  const session = await readSocialApprovalSession(request);
  const active = Boolean(session && session.walletAddress.toLowerCase() === walletAddress.toLowerCase());
  return NextResponse.json({ active, expiresAt: active && session ? session.expiresAt : null }, { headers: noStore() });
}

export async function POST(request: Request) {
  if (!isSocialStudioRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers: noStore() });
  }
  const rate = consumeSocialStudioActionRateLimit(getClientIp(request));
  const headers = actionHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }
  const isolationResponse = await getServiceIsolationResponse("social-posting");
  if (isolationResponse) return isolationResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  if (!challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A valid challenge and signature are required." }, { status: 400, headers });
  }

  const authorisation = await authoriseSocialStudioAction({
    purpose: SOCIAL_APPROVAL_SESSION_PURPOSE,
    payload: SOCIAL_APPROVAL_SESSION_PAYLOAD,
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") {
    const message =
      authorisation.status === "expired"
        ? "That signature request expired. Try again."
        : authorisation.status === "replayed"
          ? "That signature was already used. Try again."
          : "The wallet signature could not be verified.";
    return NextResponse.json({ error: message }, { status: 401, headers });
  }

  const token = createSocialApprovalSessionToken();
  const expiresAt = new Date(Date.now() + SOCIAL_APPROVAL_SESSION_TTL_MS);
  try {
    await getSocialApprovalSessionStore().create(authorisation.walletAddress, hashSocialApprovalSessionToken(token), expiresAt);
  } catch (error) {
    const unavailable = error instanceof SocialApprovalSessionStoreUnavailableError;
    if (!unavailable) console.error("Approval session create failed", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: unavailable ? "Approval sessions are not configured on this deployment." : "The approval session could not be started." },
      { status: unavailable ? 503 : 500, headers },
    );
  }

  void recordAdminActivityBestEffort({
    kind: "social-approvals-unlocked",
    serviceKey: "social-posting",
    message: `Post approvals unlocked for 24h (wallet: ${authorisation.walletAddress}).`,
  });

  const response = NextResponse.json({ active: true, expiresAt: expiresAt.toISOString() }, { status: 201, headers });
  response.cookies.set({ ...socialApprovalSessionCookieOptions(expiresAt), value: token });
  return response;
}

export async function DELETE(request: Request) {
  if (!isSocialStudioRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers: noStore() });
  }
  const rate = consumeSocialStudioActionRateLimit(getClientIp(request));
  const headers = actionHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const token = parseSocialApprovalSessionCookie(request.headers.get("cookie"));
  if (token) {
    const session = await readSocialApprovalSession(request);
    try {
      await getSocialApprovalSessionStore().revoke(hashSocialApprovalSessionToken(token));
    } catch (error) {
      console.error("Approval session revoke failed", error instanceof Error ? error.message : error);
    }
    if (session) {
      void recordAdminActivityBestEffort({
        kind: "social-approvals-locked",
        serviceKey: "social-posting",
        message: `Post approvals locked again (wallet: ${session.walletAddress}).`,
      });
    }
  }
  const response = NextResponse.json({ active: false, expiresAt: null }, { headers });
  response.cookies.set({ ...socialApprovalSessionCookieOptions(new Date(0)), value: "" });
  return response;
}
