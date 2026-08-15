import { describe, expect, it } from "vitest";
import {
  buildXAuthorizeUrl,
  exchangeXOAuthVerifier,
  isXSocialConnectConfigured,
  postTweetForUser,
  readXSocialConsumerCredentials,
  requestXOAuthToken,
  verifyXAccessToken,
} from "@/lib/server/social-x-client";

const CONSUMER_ENV = { X_SOCIAL_CONSUMER_KEY: "consumer-key", X_SOCIAL_CONSUMER_SECRET: "consumer-secret" };

describe("readXSocialConsumerCredentials / isXSocialConnectConfigured", () => {
  it("is not configured when either env var is missing — fails closed", () => {
    expect(isXSocialConnectConfigured({})).toBe(false);
    expect(isXSocialConnectConfigured({ X_SOCIAL_CONSUMER_KEY: "only-key" })).toBe(false);
    expect(readXSocialConsumerCredentials({})).toBeNull();
  });

  it("is configured when both are set", () => {
    expect(isXSocialConnectConfigured(CONSUMER_ENV)).toBe(true);
    expect(readXSocialConsumerCredentials(CONSUMER_ENV)).toEqual({ consumerKey: "consumer-key", consumerSecret: "consumer-secret" });
  });
});

describe("requestXOAuthToken", () => {
  it("refuses (never calls fetch) when the platform consumer app is not configured", async () => {
    let called = false;
    const result = await requestXOAuthToken("https://hoodlums.dev/api/social/x/connect/callback", {}, (async () => {
      called = true;
      return new Response(null);
    }) as typeof fetch);
    expect(result).toEqual({ status: "not_configured" });
    expect(called).toBe(false);
  });

  it("parses a successful oauth/request_token response", async () => {
    const fetchImpl = (async () => new Response("oauth_token=rt&oauth_token_secret=rts&oauth_callback_confirmed=true", { status: 200 })) as typeof fetch;
    const result = await requestXOAuthToken("https://hoodlums.dev/api/social/x/connect/callback", CONSUMER_ENV, fetchImpl);
    expect(result).toEqual({ status: "ok", requestToken: "rt", requestSecret: "rts" });
  });

  it("reports api_error when X does not confirm the callback", async () => {
    const fetchImpl = (async () => new Response("oauth_token=rt&oauth_token_secret=rts&oauth_callback_confirmed=false", { status: 200 })) as typeof fetch;
    const result = await requestXOAuthToken("https://hoodlums.dev/api/social/x/connect/callback", CONSUMER_ENV, fetchImpl);
    expect(result.status).toBe("api_error");
  });

  it("reports api_error on a non-2xx response, network_error on a thrown error", async () => {
    const badFetch = (async () => new Response("invalid consumer key", { status: 401 })) as typeof fetch;
    expect((await requestXOAuthToken("https://x", CONSUMER_ENV, badFetch)).status).toBe("api_error");

    const throwingFetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    expect((await requestXOAuthToken("https://x", CONSUMER_ENV, throwingFetch)).status).toBe("network_error");
  });
});

describe("buildXAuthorizeUrl", () => {
  it("builds the X authorize URL with the request token", () => {
    expect(buildXAuthorizeUrl("rt-123")).toBe("https://api.twitter.com/oauth/authorize?oauth_token=rt-123");
  });
});

describe("exchangeXOAuthVerifier", () => {
  it("refuses when the platform consumer app is not configured", async () => {
    const result = await exchangeXOAuthVerifier("rt", "rts", "verifier", {}, (async () => new Response(null)) as typeof fetch);
    expect(result).toEqual({ status: "not_configured" });
  });

  it("parses a successful oauth/access_token response", async () => {
    const fetchImpl = (async () =>
      new Response("oauth_token=at&oauth_token_secret=ats&user_id=42&screen_name=hoodlumsdev", { status: 200 })) as typeof fetch;
    const result = await exchangeXOAuthVerifier("rt", "rts", "verifier", CONSUMER_ENV, fetchImpl);
    expect(result).toEqual({ status: "ok", accessToken: "at", accessSecret: "ats", userId: "42", screenName: "hoodlumsdev" });
  });

  it("reports api_error on a non-2xx response", async () => {
    const fetchImpl = (async () => new Response("invalid verifier", { status: 401 })) as typeof fetch;
    const result = await exchangeXOAuthVerifier("rt", "rts", "bad-verifier", CONSUMER_ENV, fetchImpl);
    expect(result.status).toBe("api_error");
  });
});

describe("postTweetForUser", () => {
  it("refuses (never calls fetch) when the platform consumer app is not configured", async () => {
    let called = false;
    const result = await postTweetForUser(
      "hello",
      { accessToken: "at", accessSecret: "ats" },
      {},
      { fetchImpl: (async () => { called = true; return new Response(null); }) as typeof fetch },
    );
    expect(result).toEqual({ status: "not_configured" });
    expect(called).toBe(false);
  });

  it("posts with the platform consumer app + the connected user's token", async () => {
    let capturedAuth = "";
    const fetchImpl = (async (_url, init) => {
      capturedAuth = (init?.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ data: { id: "999" } }), { status: 201 });
    }) as typeof fetch;
    const result = await postTweetForUser("gm", { accessToken: "user-token", accessSecret: "user-secret" }, CONSUMER_ENV, { fetchImpl });
    expect(result).toEqual({ status: "posted", xPostId: "999" });
    expect(capturedAuth).toContain('oauth_consumer_key="consumer-key"');
    expect(capturedAuth).toContain('oauth_token="user-token"');
  });
});

describe("verifyXAccessToken", () => {
  it("is not_configured when the platform consumer app is unset", async () => {
    const result = await verifyXAccessToken({ accessToken: "a", accessSecret: "b" }, {}, (async () => new Response(null)) as typeof fetch);
    expect(result).toEqual({ status: "not_configured" });
  });

  it("is revoked on 401/403", async () => {
    const fetchImpl = (async () => new Response(null, { status: 401 })) as typeof fetch;
    const result = await verifyXAccessToken({ accessToken: "a", accessSecret: "b" }, CONSUMER_ENV, fetchImpl);
    expect(result).toEqual({ status: "revoked" });
  });

  it("is ok on a 200 response", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    const result = await verifyXAccessToken({ accessToken: "a", accessSecret: "b" }, CONSUMER_ENV, fetchImpl);
    expect(result).toEqual({ status: "ok" });
  });

  it("is unknown_error on other failures, never throws", async () => {
    const throwingFetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const result = await verifyXAccessToken({ accessToken: "a", accessSecret: "b" }, CONSUMER_ENV, throwingFetch);
    expect(result).toEqual({ status: "unknown_error" });
  });
});
