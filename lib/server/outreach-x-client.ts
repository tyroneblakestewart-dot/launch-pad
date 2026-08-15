import { postTweet, type XPostResult } from "@/lib/server/x-tweets-client";

// OAuth 1.0a (HMAC-SHA1) user-context signing for X API v2 POST /2/tweets,
// used only by the dormant outreach bot (issue #298). BUILD DARK: posting is
// hard-gated on all four X_OUTREACH_* credentials being present. Every
// caller must check isOutreachPostingConfigured() first, but postOutreachTweet
// also independently refuses when credentials are missing (defense in
// depth) so no code path can ever reach the network call without them.
//
// X_OUTREACH_* is a deliberately distinct env var prefix from any other
// social integration in this repo (e.g. TELEGRAM_*, X_SOCIAL_*) — this must
// be a wholly separate X developer app/account from the official
// @hoodlumsdev account (policy note for humans; see .env.example). The
// actual POST /2/tweets call is shared with Social Studio's per-user X
// connections via lib/server/x-tweets-client.ts (issue #335) — only the
// credential source differs.

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

export type OutreachPostResult = XPostResult | { status: "not_configured" };

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

  return postTweet(
    body,
    {
      consumerKey: credentials.apiKey,
      consumerSecret: credentials.apiSecret,
      accessToken: credentials.accessToken,
      accessSecret: credentials.accessSecret,
    },
    { fetchImpl: deps.fetchImpl, nonce: deps.nonce, timestamp: deps.timestamp },
  );
}
