import { createHmac, randomBytes } from "node:crypto";

// Shared OAuth 1.0a (HMAC-SHA1) request signing, factored out so both the
// dormant outreach bot (lib/server/outreach-x-client.ts, issue #298 — a
// single fixed env-credentialled account posting POST /2/tweets) and Social
// Studio's per-user X connections (lib/server/social-x-client.ts, issue
// #335 — the 3-legged request_token/authorize/access_token handshake plus
// posting with a connected user's token) sign against the exact same
// algorithm instead of drifting apart.

// RFC 3986 percent-encoding — encodeURIComponent doesn't escape !*'().
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export type OAuth1SignParams = {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  /** Extra oauth_* or request params (e.g. oauth_callback, oauth_verifier) that must be part of the signature base string. */
  extraParams?: Record<string, string>;
  nonce?: string;
  timestamp?: string;
};

/** Builds a ready-to-send `Authorization: OAuth ...` header value. */
export function buildOAuth1Header(params: OAuth1SignParams): string {
  const nonce = params.nonce ?? randomBytes(16).toString("hex");
  const timestamp = params.timestamp ?? String(Math.floor(Date.now() / 1000));

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: params.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_version: "1.0",
    ...(params.token ? { oauth_token: params.token } : {}),
    ...params.extraParams,
  };

  const paramString = Object.keys(oauthParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(oauthParams[key])}`)
    .join("&");
  const baseString = [params.method.toUpperCase(), percentEncode(params.url), percentEncode(paramString)].join("&");
  const signingKey = `${percentEncode(params.consumerSecret)}&${percentEncode(params.tokenSecret ?? "")}`;
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

/** Parses an `application/x-www-form-urlencoded` response body (X's OAuth 1.0a token endpoints, never JSON). */
export function parseFormEncoded(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of body.split("&")) {
    if (!pair) continue;
    const [rawKey, rawValue = ""] = pair.split("=");
    result[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.replace(/\+/g, "%20"));
  }
  return result;
}
