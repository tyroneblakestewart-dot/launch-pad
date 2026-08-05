import { NextResponse } from "next/server";
import { consumeTwitterOAuthRateLimit, getClientIp } from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import {
  TWITTER_OAUTH_COOKIE_PATH,
  TWITTER_OAUTH_STATE_COOKIE,
  TWITTER_OAUTH_VERIFIER_COOKIE,
  buildOAuthResultHtml,
  exchangeTwitterCode,
  fetchTwitterHandle,
  isOAuthStateValid,
  parseCookie,
} from "@/lib/server/twitter-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearOAuthCookies(response: NextResponse) {
  response.cookies.set(TWITTER_OAUTH_STATE_COOKIE, "", { maxAge: 0, path: TWITTER_OAUTH_COOKIE_PATH });
  response.cookies.set(TWITTER_OAUTH_VERIFIER_COOKIE, "", { maxAge: 0, path: TWITTER_OAUTH_COOKIE_PATH });
}

function resultPage(origin: string, ok: boolean, detail: string) {
  const html = ok
    ? buildOAuthResultHtml(origin, { ok: true, provider: "twitter", handle: detail })
    : buildOAuthResultHtml(origin, { ok: false, provider: "twitter", error: detail });
  const response = new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
  clearOAuthCookies(response);
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  const isolationResponse = await getServiceIsolationResponse("twitter-oauth");
  if (isolationResponse) {
    return resultPage(origin, false, "X sign-in is temporarily paused for maintenance.");
  }

  const rate = consumeTwitterOAuthRateLimit(getClientIp(request));
  if (!rate.allowed) {
    return resultPage(origin, false, "Too many X sign-in attempts. Try again later.");
  }

  if (url.searchParams.get("error")) {
    return resultPage(origin, false, "X sign-in was cancelled.");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieHeader = request.headers.get("cookie");
  const cookieState = parseCookie(cookieHeader, TWITTER_OAUTH_STATE_COOKIE);
  const cookieVerifier = parseCookie(cookieHeader, TWITTER_OAUTH_VERIFIER_COOKIE);

  if (!code || !isOAuthStateValid(cookieState, state) || !cookieVerifier) {
    return resultPage(origin, false, "The X sign-in request could not be verified. Try again.");
  }

  const clientId = process.env.TWITTER_CLIENT_ID?.trim();
  const clientSecret = process.env.TWITTER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return resultPage(origin, false, "X sign-in is not configured on this deployment.");
  }

  try {
    const accessToken = await exchangeTwitterCode({
      clientId,
      clientSecret,
      code,
      redirectUri: `${origin}/api/auth/twitter/callback`,
      codeVerifier: cookieVerifier,
    });
    const handle = await fetchTwitterHandle(accessToken);
    return resultPage(origin, true, handle);
  } catch (error) {
    console.error("X sign-in failed.", error instanceof Error ? error.message : error);
    return resultPage(origin, false, "X sign-in failed. Try again in a moment.");
  }
}
