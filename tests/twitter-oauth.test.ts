import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildOAuthResultHtml,
  buildTwitterAuthorizeUrl,
  exchangeTwitterCode,
  fetchTwitterHandle,
  generateCodeChallenge,
  generateCodeVerifier,
  generateOAuthState,
  isOAuthStateValid,
  isValidTwitterHandle,
  parseCookie,
  TWITTER_AUTHORIZE_URL,
  TWITTER_OAUTH_SCOPE,
} from "@/lib/server/twitter-oauth";

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Twitter OAuth PKCE helpers", () => {
  it("generates URL-safe verifiers and states with no padding characters", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(generateOAuthState()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("derives the S256 code challenge from the verifier per RFC 7636", () => {
    const verifier = generateCodeVerifier();
    const expected = createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(generateCodeChallenge(verifier)).toBe(expected);
  });

  it("builds an authorize URL with the required PKCE and scope parameters", () => {
    const url = new URL(
      buildTwitterAuthorizeUrl({
        clientId: "client-123",
        redirectUri: "https://hoodlums.dev/api/auth/twitter/callback",
        state: "state-abc",
        codeChallenge: "challenge-xyz",
      }),
    );
    expect(url.origin + url.pathname).toBe(TWITTER_AUTHORIZE_URL);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://hoodlums.dev/api/auth/twitter/callback",
    );
    expect(url.searchParams.get("scope")).toBe(TWITTER_OAUTH_SCOPE);
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-xyz");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("exchanges a code for an access token using Basic auth and the PKCE verifier", async () => {
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.twitter.com/2/oauth2/token");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
      const body = new URLSearchParams(init?.body as string);
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("code_verifier")).toBe("verifier-value");
      return tokenResponse({ access_token: "token-abc" });
    };

    const token = await exchangeTwitterCode(
      {
        clientId: "id",
        clientSecret: "secret",
        code: "auth-code",
        redirectUri: "https://hoodlums.dev/api/auth/twitter/callback",
        codeVerifier: "verifier-value",
      },
      fetchMock,
    );
    expect(token).toBe("token-abc");
  });

  it("throws when the token exchange responds with a non-2xx status", async () => {
    const fetchMock = async () => tokenResponse({ error: "invalid_grant" }, 400);
    await expect(
      exchangeTwitterCode(
        { clientId: "id", clientSecret: "secret", code: "c", redirectUri: "r", codeVerifier: "v" },
        fetchMock,
      ),
    ).rejects.toThrow(/token exchange failed/i);
  });

  it("throws when the token exchange response has no access_token", async () => {
    const fetchMock = async () => tokenResponse({ token_type: "bearer" });
    await expect(
      exchangeTwitterCode(
        { clientId: "id", clientSecret: "secret", code: "c", redirectUri: "r", codeVerifier: "v" },
        fetchMock,
      ),
    ).rejects.toThrow(/did not return an access token/i);
  });

  it("fetches the authenticated handle with a bearer token", async () => {
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.twitter.com/2/users/me");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer token-abc");
      return tokenResponse({ data: { username: "hoodlums_hq" } });
    };
    expect(await fetchTwitterHandle("token-abc", fetchMock)).toBe("hoodlums_hq");
  });

  it("rejects a user lookup that returns no valid username", async () => {
    const fetchMock = async () => tokenResponse({ data: {} });
    await expect(fetchTwitterHandle("token-abc", fetchMock)).rejects.toThrow(
      /did not return a valid username/i,
    );
  });

  it("rejects a user lookup with a non-2xx status", async () => {
    const fetchMock = async () => tokenResponse({}, 401);
    await expect(fetchTwitterHandle("token-abc", fetchMock)).rejects.toThrow(
      /user lookup failed/i,
    );
  });

  it("validates X handle format at documented boundaries", () => {
    expect(isValidTwitterHandle("hoodlums")).toBe(true);
    expect(isValidTwitterHandle("a".repeat(15))).toBe(true);
    expect(isValidTwitterHandle("a".repeat(16))).toBe(false);
    expect(isValidTwitterHandle("")).toBe(false);
    expect(isValidTwitterHandle("has space")).toBe(false);
    expect(isValidTwitterHandle("has/slash")).toBe(false);
  });

  it("requires matching, non-empty state for CSRF protection", () => {
    expect(isOAuthStateValid("state-abc", "state-abc")).toBe(true);
    expect(isOAuthStateValid("state-abc", "state-different")).toBe(false);
    expect(isOAuthStateValid("state-abc", "short")).toBe(false);
    expect(isOAuthStateValid(null, "state-abc")).toBe(false);
    expect(isOAuthStateValid("state-abc", undefined)).toBe(false);
    expect(isOAuthStateValid(null, null)).toBe(false);
  });

  it("parses a named cookie out of a raw cookie header", () => {
    const header = "hoodlums_tw_oauth_state=abc123; other=value; hoodlums_tw_oauth_verifier=xyz789";
    expect(parseCookie(header, "hoodlums_tw_oauth_state")).toBe("abc123");
    expect(parseCookie(header, "hoodlums_tw_oauth_verifier")).toBe("xyz789");
    expect(parseCookie(header, "missing")).toBeNull();
    expect(parseCookie(null, "hoodlums_tw_oauth_state")).toBeNull();
    expect(parseCookie("", "hoodlums_tw_oauth_state")).toBeNull();
  });

  it("builds a popup result page that posts to the exact origin and never leaks a raw handle into markup unescaped", () => {
    const html = buildOAuthResultHtml("https://hoodlums.dev", {
      ok: true,
      provider: "twitter",
      handle: "</script><script>alert(1)</script>",
    });
    expect(html).toContain("window.opener.postMessage(payload, origin)");
    expect(html).toContain("window.close()");
    expect(html).not.toContain("</script><script>alert(1)</script>");
    expect(html).toContain("\\u003c/script>\\u003cscript>alert(1)\\u003c/script>");
  });

  it("builds a failure result page carrying the error message", () => {
    const html = buildOAuthResultHtml("https://hoodlums.dev", {
      ok: false,
      provider: "twitter",
      error: "X sign-in failed.",
    });
    expect(html).toContain('"ok":false');
    expect(html).toContain("X sign-in failed.");
  });
});
