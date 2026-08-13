import { createHmac, randomBytes } from "node:crypto";

// OAuth 1.0a (HMAC-SHA1) user-context signing for X API v2 POST /2/tweets,
// used only by the dormant outreach bot (issue #298). BUILD DARK: posting is
// hard-gated on all four X_OUTREACH_* credentials being present. Every
// caller must check isOutreachPostingConfigured() first, but postOutreachTweet
// also independently refuses when credentials are missing (defense in
// depth) so no code path can ever reach the network call without them.
//
// X_OUTREACH_* is a deliberately distinct env var prefix from any other
// social integration in this repo (e.g. TELEGRAM_*) — this must be a wholly
// separate X developer app/account from the official @hoodlumsdev account
// (policy note for humans; see .env.example).

const X_TWEETS_ENDPOINT = "https://api.twitter.com/2/tweets";

export type OutreachXCredentials = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
};

/** Reads all four X_OUTREACH_* env vars; returns null unless every one is present. */
export function readOutreachXCredentials(
  env: Record<string, string | undefined> = process.env,
): OutreachXCredentials | null {
  const apiKey = (env.X_OUTREACH_API_KEY || "").trim();
  const apiSecret = (env.X_OUTREACH_API_SECRET || "").trim();
  const accessToken = (env.X_OUTREACH_ACCESS_TOKEN || "").trim();
  const accessSecret = (env.X_OUTREACH_ACCESS_SECRET || "").trim();
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  return { apiKey, apiSecret, accessToken, accessSecret };
}

/**
 * The single source of truth for "can we post at all". Must be checked
 * first everywhere posting could happen (cron drafting is unaffected — this
 * only gates the actual API call).
 */
export function isOutreachPostingConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return readOutreachXCredentials(env) !== null;
}

// RFC 3986 percent-encoding — encodeURIComponent doesn't escape !*'().
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuthHeader(
  method: string,
  url: string,
  credentials: OutreachXCredentials,
  nonce: string,
  timestamp: string,
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };

  const paramString = Object.keys(oauthParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(oauthParams[key])}`)
    .join("&");
  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join("&");
  const signingKey = `${percentEncode(credentials.apiSecret)}&${percentEncode(credentials.accessSecret)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  const headerParams: Record<string, string> = { ...oauthParams, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(headerParams)
      .sort()
      .map((key) => `${percentEncode(key)}="${percentEncode(headerParams[key])}"`)
      .join(", ")
  );
}

export type OutreachPostResult =
  | { status: "posted"; xPostId: string }
  | { status: "not_configured" }
  | { status: "rate_limited"; message: string }
  | { status: "api_error"; httpStatus: number; message: string }
  | { status: "network_error"; message: string };

export type PostOutreachTweetDeps = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  nonce?: string;
  timestamp?: string;
};

/**
 * Posts one tweet via X API v2. Never throws: every failure mode (missing
 * credentials, non-2xx response, 429 rate limit, network error) resolves to
 * a discriminated result so callers can mark the queue item failed and move
 * on, matching this repo's server-module fail-safe contract.
 */
export async function postOutreachTweet(body: string, deps: PostOutreachTweetDeps = {}): Promise<OutreachPostResult> {
  const env = deps.env ?? process.env;
  const credentials = readOutreachXCredentials(env);
  if (!credentials) return { status: "not_configured" };

  const fetchImpl = deps.fetchImpl ?? fetch;
  const nonce = deps.nonce ?? randomBytes(16).toString("hex");
  const timestamp = deps.timestamp ?? String(Math.floor(Date.now() / 1000));

  try {
    const response = await fetchImpl(X_TWEETS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: buildOAuthHeader("POST", X_TWEETS_ENDPOINT, credentials, nonce, timestamp),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: body }),
    });

    if (response.status === 429) {
      return { status: "rate_limited", message: "X API rate limit reached (429)." };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        status: "api_error",
        httpStatus: response.status,
        message: text.slice(0, 500) || `X API returned HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json().catch(() => null)) as { data?: { id?: unknown } } | null;
    const xPostId = payload?.data?.id;
    if (typeof xPostId !== "string" || !xPostId) {
      return { status: "api_error", httpStatus: response.status, message: "X API response did not include a post id." };
    }
    return { status: "posted", xPostId };
  } catch (error) {
    return {
      status: "network_error",
      message: error instanceof Error ? error.message.slice(0, 500) : "Network error posting to X.",
    };
  }
}
