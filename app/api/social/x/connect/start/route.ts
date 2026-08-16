import { NextResponse } from "next/server";
import {
  SOCIAL_STUDIO_ACTION_LIMIT,
  consumeSocialStudioActionRateLimit,
  getClientIp,
  isSocialStudioRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { SocialConnectionsStoreUnavailableError, getSocialConnectionsStore } from "@/lib/server/social-connections-store";
import { authoriseSocialStudioAction, type AuthoriseSocialStudioActionResult } from "@/lib/server/social-studio-action-auth";
import { X_BIO_LINK_HINT, buildXAuthorizeUrl, isXSocialConnectConfigured, requestXOAuthToken } from "@/lib/server/social-x-client";

// Step 1 of Social Studio's X 3-legged OAuth connect flow (issue #335):
// verify the wallet's signed intent to connect, request a short-lived X
// OAuth token bound to our callback, and stash it durably (the round trip
// leaves this process entirely — see social_x_oauth_requests). Step 2 is X's
// own authorize page; step 3 is app/api/social/x/connect/callback.

export const runtime = "nodejs";

const REQUEST_TOKEN_TTL_MS = 10 * 60 * 1000;

function responseHeaders(rate: ReturnType<typeof consumeSocialStudioActionRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(SOCIAL_STUDIO_ACTION_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function authFailureResponse(result: Exclude<AuthoriseSocialStudioActionResult, { status: "ok" }>, headers: Record<string, string>) {
  if (result.status === "expired") return NextResponse.json({ error: "The connect challenge expired. Try again." }, { status: 410, headers });
  if (result.status === "replayed") return NextResponse.json({ error: "That connect challenge has already been used." }, { status: 409, headers });
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

  if (!isXSocialConnectConfigured()) {
    return NextResponse.json({ error: "X connections are not configured on this deployment." }, { status: 503, headers });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  if (!challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A valid connect challenge and signature are required." }, { status: 400, headers });
  }

  const authorisation = await authoriseSocialStudioAction({
    purpose: "social:x-connect",
    payload: { platform: "x" },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, headers);

  const origin = process.env.HOODLUMS_APP_ORIGIN?.trim() || new URL(request.url).origin;
  const callbackUrl = `${origin}/api/social/x/connect/callback`;

  const tokenResult = await requestXOAuthToken(callbackUrl);
  if (tokenResult.status !== "ok") {
    const message = tokenResult.status === "not_configured" ? "X connections are not configured on this deployment." : tokenResult.message;
    return NextResponse.json({ error: message }, { status: tokenResult.status === "not_configured" ? 503 : 502, headers });
  }

  try {
    await getSocialConnectionsStore().createXOAuthRequest({
      walletAddress: authorisation.walletAddress,
      requestToken: tokenResult.requestToken,
      requestSecret: tokenResult.requestSecret,
      expiresAt: new Date(Date.now() + REQUEST_TOKEN_TTL_MS),
    });
  } catch (error) {
    const unavailable = error instanceof SocialConnectionsStoreUnavailableError;
    return NextResponse.json(
      { error: unavailable ? "Social Studio connections are not configured on this deployment." : "The connect request could not be started." },
      { status: unavailable ? 503 : 500, headers },
    );
  }

  return NextResponse.json({ authorizeUrl: buildXAuthorizeUrl(tokenResult.requestToken), bioLinkHint: X_BIO_LINK_HINT }, { status: 200, headers });
}
