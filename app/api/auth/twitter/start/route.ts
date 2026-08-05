import { NextResponse } from "next/server";
import { consumeTwitterOAuthRateLimit, getClientIp } from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import {
  TWITTER_OAUTH_COOKIE_MAX_AGE_SECONDS,
  TWITTER_OAUTH_COOKIE_PATH,
  TWITTER_OAUTH_STATE_COOKIE,
  TWITTER_OAUTH_VERIFIER_COOKIE,
  buildOAuthResultHtml,
  buildTwitterAuthorizeUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateOAuthState,
} from "@/lib/server/twitter-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * This route is opened as a popup window (never fetched), so every failure
 * path still returns the same postMessage-and-close HTML the callback uses
 * rather than a bare error status the popup would just sit on.
 */
function errorPage(origin: string, message: string) {
  return new NextResponse(buildOAuthResultHtml(origin, { ok: false, provider: "twitter", error: message }), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;

  const isolationResponse = await getServiceIsolationResponse("twitter-oauth");
  if (isolationResponse) {
    return errorPage(origin, "X sign-in is temporarily paused for maintenance.");
  }

  const rate = consumeTwitterOAuthRateLimit(getClientIp(request));
  if (!rate.allowed) {
    return errorPage(origin, "Too many X sign-in attempts. Try again later.");
  }

  const clientId = process.env.TWITTER_CLIENT_ID?.trim();
  if (!clientId) {
    return errorPage(origin, "X sign-in is not configured on this deployment.");
  }

  const state = generateOAuthState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const redirectUri = `${origin}/api/auth/twitter/callback`;
  const authorizeUrl = buildTwitterAuthorizeUrl({ clientId, redirectUri, state, codeChallenge });

  const response = NextResponse.redirect(authorizeUrl);
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: TWITTER_OAUTH_COOKIE_MAX_AGE_SECONDS,
    path: TWITTER_OAUTH_COOKIE_PATH,
  };
  response.cookies.set(TWITTER_OAUTH_STATE_COOKIE, state, cookieOptions);
  response.cookies.set(TWITTER_OAUTH_VERIFIER_COOKIE, codeVerifier, cookieOptions);
  return response;
}
