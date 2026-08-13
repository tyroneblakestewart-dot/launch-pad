import { describe, expect, it } from "vitest";
import {
  isOutreachPostingConfigured,
  postOutreachTweet,
  readOutreachXCredentials,
} from "@/lib/server/outreach-x-client";

const FULL_CREDS = {
  X_OUTREACH_API_KEY: "key",
  X_OUTREACH_API_SECRET: "secret",
  X_OUTREACH_ACCESS_TOKEN: "token",
  X_OUTREACH_ACCESS_SECRET: "access-secret",
};

describe("isOutreachPostingConfigured / readOutreachXCredentials", () => {
  it("is false (dormant) when any of the four X_OUTREACH_* vars is missing", () => {
    expect(isOutreachPostingConfigured({})).toBe(false);
    for (const missing of Object.keys(FULL_CREDS)) {
      const env = { ...FULL_CREDS, [missing]: "" };
      expect(isOutreachPostingConfigured(env)).toBe(false);
      expect(readOutreachXCredentials(env)).toBeNull();
    }
  });

  it("is true only once all four are present", () => {
    expect(isOutreachPostingConfigured(FULL_CREDS)).toBe(true);
    expect(readOutreachXCredentials(FULL_CREDS)).toEqual({
      apiKey: "key",
      apiSecret: "secret",
      accessToken: "token",
      accessSecret: "access-secret",
    });
  });
});

describe("postOutreachTweet", () => {
  it("refuses internally (never throws, never calls fetch) when credentials are missing — defense in depth", async () => {
    let fetchCalled = false;
    const result = await postOutreachTweet("hello", {
      env: {},
      fetchImpl: (async () => {
        fetchCalled = true;
        return new Response(null);
      }) as typeof fetch,
    });
    expect(result).toEqual({ status: "not_configured" });
    expect(fetchCalled).toBe(false);
  });

  it("signs the request with an OAuth 1.0a Authorization header and posts the body as JSON", async () => {
    let capturedUrl: string | URL | Request | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ data: { id: "12345" } }), { status: 201 });
    }) as typeof fetch;

    const result = await postOutreachTweet("congrats $DOGGO @hoodlumsdev", { env: FULL_CREDS, fetchImpl });

    expect(result).toEqual({ status: "posted", xPostId: "12345" });
    expect(capturedUrl).toBe("https://api.twitter.com/2/tweets");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^OAuth /);
    expect(headers.Authorization).toContain('oauth_consumer_key="key"');
    expect(headers.Authorization).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(headers.Authorization).toContain("oauth_signature=");
    expect(JSON.parse(capturedInit?.body as string)).toEqual({ text: "congrats $DOGGO @hoodlumsdev" });
  });

  it("marks a 429 response as rate_limited without throwing", async () => {
    const fetchImpl = (async () => new Response(null, { status: 429 })) as typeof fetch;
    const result = await postOutreachTweet("hi", { env: FULL_CREDS, fetchImpl });
    expect(result.status).toBe("rate_limited");
  });

  it("marks a non-2xx response as api_error with the status and body, without throwing", async () => {
    const fetchImpl = (async () => new Response("bad request details", { status: 400 })) as typeof fetch;
    const result = await postOutreachTweet("hi", { env: FULL_CREDS, fetchImpl });
    expect(result).toMatchObject({ status: "api_error", httpStatus: 400 });
    if (result.status === "api_error") expect(result.message).toContain("bad request details");
  });

  it("marks a network failure as network_error without throwing", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const result = await postOutreachTweet("hi", { env: FULL_CREDS, fetchImpl });
    expect(result).toMatchObject({ status: "network_error", message: "network down" });
  });

  it("marks a malformed success response (missing post id) as api_error without throwing", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({}), { status: 200 })) as typeof fetch;
    const result = await postOutreachTweet("hi", { env: FULL_CREDS, fetchImpl });
    expect(result.status).toBe("api_error");
  });
});
