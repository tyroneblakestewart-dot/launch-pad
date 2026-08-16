import { buildOAuth1Header, parseFormEncoded } from "@/lib/server/x-oauth1-signing";
import { postTweet, type XPostResult } from "@/lib/server/x-tweets-client";

// Per-user X connections for Social Studio (issue #335): the 3-legged OAuth
// 1.0a handshake ("Connect X" -> request token -> user authorizes on X ->
// callback exchanges the verifier for an access token) plus posting with a
// connected user's token. Reuses the same signing (x-oauth1-signing.ts) and
// POST /2/tweets call (x-tweets-client.ts) as the outreach bot — only the
// consumer app and the per-user access token/secret differ.
//
// X_SOCIAL_CONSUMER_KEY / X_SOCIAL_CONSUMER_SECRET are a deliberately
// distinct env var pair from X_OUTREACH_* (a separate X developer app: this
// one is a "Sign in with X" / OAuth 1.0a user-context app, not the outreach
// bot's single fixed account). Leaving either unset fails every connect
// attempt closed with a clear "X connections are not configured" state.

const X_REQUEST_TOKEN_ENDPOINT = "https://api.twitter.com/oauth/request_token";
const X_AUTHORIZE_ENDPOINT = "https://api.twitter.com/oauth/authorize";
const X_ACCESS_TOKEN_ENDPOINT = "https://api.twitter.com/oauth/access_token";
const X_VERIFY_CREDENTIALS_ENDPOINT = "https://api.twitter.com/1.1/account/verify_credentials.json";

// Shown once a wallet connects X (issue #342 cost control): scheduled/AI
// draft text is instructed to never include a link (see
// social-draft-pipeline.ts) and the posting cron routes any link-bearing
// post to the free composer instead of the paid API — so the project's link
// needs a home other than the post body. The X connect UI isn't wired up
// yet (see the roadmap notes in CLAUDE.md), so this currently only surfaces
// through the connect-start API response; it's ready for that UI pass.
export const X_BIO_LINK_HINT =
  "Add your project link to your X bio now — scheduled and AI-drafted posts intentionally never include a link (it keeps posting free instead of 13x more expensive), so your bio is where people will find it.";

export type XSocialConsumerCredentials = { consumerKey: string; consumerSecret: string };

export function readXSocialConsumerCredentials(
  env: Record<string, string | undefined> = process.env,
): XSocialConsumerCredentials | null {
  const consumerKey = (env.X_SOCIAL_CONSUMER_KEY || "").trim();
  const consumerSecret = (env.X_SOCIAL_CONSUMER_SECRET || "").trim();
  if (!consumerKey || !consumerSecret) return null;
  return { consumerKey, consumerSecret };
}

export function isXSocialConnectConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return readXSocialConsumerCredentials(env) !== null;
}

export type XUserAccessCredentials = { accessToken: string; accessSecret: string };

export type PostTweetForUserDeps = { fetchImpl?: typeof fetch; nonce?: string; timestamp?: string };

/** Posts as a connected Social Studio user, using the platform consumer app + that user's stored access token/secret. */
export async function postTweetForUser(
  body: string,
  userCredentials: XUserAccessCredentials,
  env: Record<string, string | undefined> = process.env,
  deps: PostTweetForUserDeps = {},
): Promise<XPostResult | { status: "not_configured" }> {
  const consumer = readXSocialConsumerCredentials(env);
  if (!consumer) return { status: "not_configured" };
  return postTweet(
    body,
    { consumerKey: consumer.consumerKey, consumerSecret: consumer.consumerSecret, ...userCredentials },
    deps,
  );
}

export type FetchLike = typeof fetch;

export type RequestXOAuthTokenResult =
  | { status: "ok"; requestToken: string; requestSecret: string }
  | { status: "not_configured" }
  | { status: "api_error"; message: string }
  | { status: "network_error"; message: string };

/** Step 1 of 3-legged OAuth: obtains a short-lived request token bound to callbackUrl. */
export async function requestXOAuthToken(
  callbackUrl: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<RequestXOAuthTokenResult> {
  const consumer = readXSocialConsumerCredentials(env);
  if (!consumer) return { status: "not_configured" };

  try {
    const response = await fetchImpl(X_REQUEST_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: buildOAuth1Header({
          method: "POST",
          url: X_REQUEST_TOKEN_ENDPOINT,
          consumerKey: consumer.consumerKey,
          consumerSecret: consumer.consumerSecret,
          extraParams: { oauth_callback: callbackUrl },
        }),
      },
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      return { status: "api_error", message: text.slice(0, 500) || `X returned HTTP ${response.status}.` };
    }
    const parsed = parseFormEncoded(text);
    if (parsed.oauth_callback_confirmed !== "true" || !parsed.oauth_token || !parsed.oauth_token_secret) {
      return { status: "api_error", message: "X did not confirm the OAuth callback." };
    }
    return { status: "ok", requestToken: parsed.oauth_token, requestSecret: parsed.oauth_token_secret };
  } catch (error) {
    return { status: "network_error", message: error instanceof Error ? error.message.slice(0, 500) : "Network error." };
  }
}

/** Step 2: the URL the browser redirects to so the user can approve access on X. */
export function buildXAuthorizeUrl(requestToken: string): string {
  return `${X_AUTHORIZE_ENDPOINT}?oauth_token=${encodeURIComponent(requestToken)}`;
}

export type ExchangeXOAuthVerifierResult =
  | { status: "ok"; accessToken: string; accessSecret: string; userId: string; screenName: string }
  | { status: "not_configured" }
  | { status: "api_error"; message: string }
  | { status: "network_error"; message: string };

/** Step 3: exchanges the request token + the verifier X returned on redirect for a durable access token. */
export async function exchangeXOAuthVerifier(
  requestToken: string,
  requestSecret: string,
  verifier: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<ExchangeXOAuthVerifierResult> {
  const consumer = readXSocialConsumerCredentials(env);
  if (!consumer) return { status: "not_configured" };

  try {
    const response = await fetchImpl(X_ACCESS_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: buildOAuth1Header({
          method: "POST",
          url: X_ACCESS_TOKEN_ENDPOINT,
          consumerKey: consumer.consumerKey,
          consumerSecret: consumer.consumerSecret,
          token: requestToken,
          tokenSecret: requestSecret,
          extraParams: { oauth_verifier: verifier },
        }),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `oauth_verifier=${encodeURIComponent(verifier)}`,
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      return { status: "api_error", message: text.slice(0, 500) || `X returned HTTP ${response.status}.` };
    }
    const parsed = parseFormEncoded(text);
    if (!parsed.oauth_token || !parsed.oauth_token_secret) {
      return { status: "api_error", message: "X did not return an access token." };
    }
    return {
      status: "ok",
      accessToken: parsed.oauth_token,
      accessSecret: parsed.oauth_token_secret,
      userId: parsed.user_id || "",
      screenName: parsed.screen_name || "",
    };
  } catch (error) {
    return { status: "network_error", message: error instanceof Error ? error.message.slice(0, 500) : "Network error." };
  }
}

export type VerifyXAccessTokenResult =
  | { status: "ok" }
  | { status: "revoked" }
  | { status: "not_configured" }
  | { status: "unknown_error" };

/**
 * Cheaply confirms a stored user access token is still valid (GET, no
 * tweet spent). Used by the posting cron to distinguish "this token was
 * revoked, pause and ask the user to reconnect" from a transient API/network
 * error that should just retry with backoff.
 */
export async function verifyXAccessToken(
  userCredentials: XUserAccessCredentials,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<VerifyXAccessTokenResult> {
  const consumer = readXSocialConsumerCredentials(env);
  if (!consumer) return { status: "not_configured" };

  try {
    const response = await fetchImpl(X_VERIFY_CREDENTIALS_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: buildOAuth1Header({
          method: "GET",
          url: X_VERIFY_CREDENTIALS_ENDPOINT,
          consumerKey: consumer.consumerKey,
          consumerSecret: consumer.consumerSecret,
          token: userCredentials.accessToken,
          tokenSecret: userCredentials.accessSecret,
        }),
      },
    });
    if (response.status === 401 || response.status === 403) return { status: "revoked" };
    if (!response.ok) return { status: "unknown_error" };
    return { status: "ok" };
  } catch {
    return { status: "unknown_error" };
  }
}
