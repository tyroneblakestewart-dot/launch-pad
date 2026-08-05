import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { OAUTH_RESULT_MESSAGE_TYPE } from "@/lib/social-oauth";

// X (Twitter) OAuth 2.0 with PKCE (issue #246). The studio never sees
// TWITTER_CLIENT_SECRET; the confidential-client token exchange happens only
// in app/api/auth/twitter/callback/route.ts.
export const TWITTER_OAUTH_SCOPE = "tweet.read users.read";
export const TWITTER_AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize";
export const TWITTER_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
export const TWITTER_USER_URL = "https://api.twitter.com/2/users/me";

export const TWITTER_OAUTH_STATE_COOKIE = "hoodlums_tw_oauth_state";
export const TWITTER_OAUTH_VERIFIER_COOKIE = "hoodlums_tw_oauth_verifier";
export const TWITTER_OAUTH_COOKIE_MAX_AGE_SECONDS = 600;
export const TWITTER_OAUTH_COOKIE_PATH = "/api/auth/twitter";

const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

function base64UrlEncode(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

export function generateOAuthState(): string {
  return base64UrlEncode(randomBytes(16));
}

export function buildTwitterAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(TWITTER_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", TWITTER_OAUTH_SCOPE);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export type TwitterTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

/** Confidential-client token exchange: Basic auth with client_id:client_secret plus the PKCE verifier. */
export async function exchangeTwitterCode(
  params: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const basic = Buffer.from(`${params.clientId}:${params.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const response = await fetchImpl(TWITTER_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Twitter token exchange failed (HTTP ${response.status}).`);
  }
  const payload = (await response.json()) as TwitterTokenResponse;
  if (!payload.access_token) {
    throw new Error("Twitter token exchange did not return an access token.");
  }
  return payload.access_token;
}

export async function fetchTwitterHandle(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(TWITTER_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Twitter user lookup failed (HTTP ${response.status}).`);
  }
  const payload = (await response.json()) as { data?: { username?: string } };
  const username = payload.data?.username?.trim() ?? "";
  if (!isValidTwitterHandle(username)) {
    throw new Error("Twitter did not return a valid username.");
  }
  return username;
}

export function isValidTwitterHandle(value: string): boolean {
  return HANDLE_PATTERN.test(value);
}

/** Constant-time comparison so the callback's CSRF check does not leak timing information. */
export function isOAuthStateValid(
  cookieState: string | null | undefined,
  queryState: string | null | undefined,
): boolean {
  if (!cookieState || !queryState) return false;
  const left = Buffer.from(cookieState);
  const right = Buffer.from(queryState);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Manual parse of the raw `cookie` request header — matches lib/server/admin-auth.ts's parseAdminSessionCookie. */
export function parseCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const cookieName = part.slice(0, separator).trim();
    if (cookieName !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

export type OAuthPopupResult =
  | { ok: true; provider: "twitter"; handle: string }
  | { ok: false; provider: "twitter"; error: string };

/**
 * The popup opened by the studio's "Connect X" button never renders a
 * document the user reads — it immediately posts the result to the opener
 * (same-origin only) and closes itself. `origin` and `payload` are both
 * server-controlled or pattern-validated (state/handle), never raw user
 * input, but the payload is still JSON-escaped defensively before being
 * embedded in the inline script.
 */
export function buildOAuthResultHtml(origin: string, payload: OAuthPopupResult): string {
  const safeOrigin = JSON.stringify(origin).replace(/</g, "\\u003c");
  const safePayload = JSON.stringify({ type: OAUTH_RESULT_MESSAGE_TYPE, ...payload }).replace(
    /</g,
    "\\u003c",
  );
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Connecting…</title></head>
<body>
<script>
(function () {
  var payload = ${safePayload};
  var origin = ${safeOrigin};
  if (window.opener) {
    window.opener.postMessage(payload, origin);
  }
  window.close();
})();
</script>
<p>You can close this window.</p>
</body>
</html>`;
}
