import { NextResponse } from "next/server";
import { ACCOUNT_ACTION_LIMIT, consumeAccountActionRateLimit, getClientIp } from "@/lib/server/api-protection";
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_STATE_TTL_MS,
  buildGoogleAuthorizeUrl,
  createGoogleOAuthState,
  isGoogleSignInConfigured,
  readGoogleSignInConfig,
  sanitiseReturnTo,
  sealGoogleOAuthState,
} from "@/lib/server/google-sign-in";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";

// Step 1 of Sign in with Google (phase 1, 6 Sep 2026): mint a PKCE verifier
// and anti-CSRF state, seal both in a short-lived encrypted httpOnly cookie,
// and send the browser to Google. A plain GET so the account panel can use a
// normal link/redirect; the cookie's SameSite=Lax is what lets Google's
// cross-site redirect back still carry it.

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rate = consumeAccountActionRateLimit(getClientIp(request));
  const headers = {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(ACCOUNT_ACTION_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("google-sign-in");
  if (isolationResponse) return isolationResponse;

  const config = readGoogleSignInConfig();
  if (!config || !isGoogleSignInConfigured()) {
    return NextResponse.json({ error: "Google sign-in is not configured on this deployment." }, { status: 503, headers });
  }

  const url = new URL(request.url);
  const origin = process.env.HOODLUMS_APP_ORIGIN?.trim() || url.origin;
  const returnTo = sanitiseReturnTo(url.searchParams.get("returnTo"));
  const oauthState = createGoogleOAuthState(returnTo);
  const authorizeUrl = buildGoogleAuthorizeUrl(config, `${origin}${GOOGLE_CALLBACK_PATH}`, oauthState);

  const response = NextResponse.redirect(authorizeUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
  response.cookies.set({
    name: GOOGLE_OAUTH_STATE_COOKIE,
    value: sealGoogleOAuthState(oauthState),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(GOOGLE_OAUTH_STATE_TTL_MS / 1000),
  });
  return response;
}
