import { randomBytes } from "node:crypto";
import { buildOAuth1Header } from "@/lib/server/x-oauth1-signing";

// Shared POST /2/tweets call, reused by the dormant outreach bot
// (lib/server/outreach-x-client.ts, a single env-credentialled account) and
// Social Studio's per-user X connections (lib/server/social-x-client.ts,
// issue #335). Both only ever differ in which OAuth 1.0a credential set they
// pass in — the request itself, and every failure mode, is identical.

const X_TWEETS_ENDPOINT = "https://api.twitter.com/2/tweets";

export type XPostCredentials = {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessSecret: string;
};

export type XPostResult =
  | { status: "posted"; xPostId: string }
  | { status: "rate_limited"; message: string }
  | { status: "api_error"; httpStatus: number; message: string }
  | { status: "network_error"; message: string };

export type PostTweetDeps = {
  fetchImpl?: typeof fetch;
  nonce?: string;
  timestamp?: string;
};

/**
 * Posts one tweet via X API v2. Never throws: every failure mode (non-2xx
 * response, 429 rate limit, network error) resolves to a discriminated
 * result so callers can mark their queue item failed and move on, matching
 * this repo's server-module fail-safe contract.
 */
export async function postTweet(body: string, credentials: XPostCredentials, deps: PostTweetDeps = {}): Promise<XPostResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nonce = deps.nonce ?? randomBytes(16).toString("hex");
  const timestamp = deps.timestamp ?? String(Math.floor(Date.now() / 1000));

  try {
    const response = await fetchImpl(X_TWEETS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: buildOAuth1Header({
          method: "POST",
          url: X_TWEETS_ENDPOINT,
          consumerKey: credentials.consumerKey,
          consumerSecret: credentials.consumerSecret,
          token: credentials.accessToken,
          tokenSecret: credentials.accessSecret,
          nonce,
          timestamp,
        }),
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
