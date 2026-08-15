import { describe, expect, it } from "vitest";
import { buildOAuth1Header, parseFormEncoded, percentEncode } from "@/lib/server/x-oauth1-signing";

describe("percentEncode", () => {
  it("escapes RFC 3986 reserved characters that encodeURIComponent leaves alone", () => {
    expect(percentEncode("!*'()")).toBe("%21%2A%27%28%29");
  });

  it("leaves unreserved characters untouched", () => {
    expect(percentEncode("abcXYZ012-._~")).toBe("abcXYZ012-._~");
  });
});

describe("buildOAuth1Header", () => {
  it("produces a well-formed OAuth 1.0a header with a token when one is supplied", () => {
    const header = buildOAuth1Header({
      method: "POST",
      url: "https://api.twitter.com/2/tweets",
      consumerKey: "ck",
      consumerSecret: "cs",
      token: "tok",
      tokenSecret: "ts",
      nonce: "fixed-nonce",
      timestamp: "1700000000",
    });
    expect(header).toMatch(/^OAuth /);
    expect(header).toContain('oauth_consumer_key="ck"');
    expect(header).toContain('oauth_token="tok"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain('oauth_nonce="fixed-nonce"');
    expect(header).toContain('oauth_timestamp="1700000000"');
    expect(header).toContain("oauth_signature=");
  });

  it("omits oauth_token when no token is supplied (the request-token step)", () => {
    const header = buildOAuth1Header({
      method: "POST",
      url: "https://api.twitter.com/oauth/request_token",
      consumerKey: "ck",
      consumerSecret: "cs",
      extraParams: { oauth_callback: "https://hoodlums.dev/api/social/x/connect/callback" },
      nonce: "fixed-nonce",
      timestamp: "1700000000",
    });
    expect(header).not.toContain("oauth_token=");
    expect(header).toContain("oauth_callback=");
  });

  it("produces a deterministic signature for fixed inputs (regression guard)", () => {
    const params = {
      method: "GET",
      url: "https://api.twitter.com/1.1/account/verify_credentials.json",
      consumerKey: "ck",
      consumerSecret: "cs",
      token: "tok",
      tokenSecret: "ts",
      nonce: "n",
      timestamp: "1",
    };
    expect(buildOAuth1Header(params)).toBe(buildOAuth1Header(params));
  });

  it("changes the signature when any signed input changes", () => {
    const base = {
      method: "GET",
      url: "https://api.twitter.com/1.1/account/verify_credentials.json",
      consumerKey: "ck",
      consumerSecret: "cs",
      token: "tok",
      tokenSecret: "ts",
      nonce: "n",
      timestamp: "1",
    };
    expect(buildOAuth1Header(base)).not.toBe(buildOAuth1Header({ ...base, tokenSecret: "different" }));
  });
});

describe("parseFormEncoded", () => {
  it("parses X's oauth/request_token and oauth/access_token response bodies", () => {
    expect(parseFormEncoded("oauth_token=abc&oauth_token_secret=def&oauth_callback_confirmed=true")).toEqual({
      oauth_token: "abc",
      oauth_token_secret: "def",
      oauth_callback_confirmed: "true",
    });
  });

  it("URL-decodes keys and values, including '+' as a space", () => {
    expect(parseFormEncoded("screen_name=hood+lums&note=a%20b")).toEqual({ screen_name: "hood lums", note: "a b" });
  });

  it("returns an empty object for an empty body", () => {
    expect(parseFormEncoded("")).toEqual({});
  });
});
