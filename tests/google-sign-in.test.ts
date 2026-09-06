import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_OAUTH_STATE_TTL_MS,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  buildGoogleAuthorizeUrl,
  codeChallengeFor,
  createGoogleOAuthState,
  exchangeGoogleCode,
  isGoogleSignInConfigured,
  openGoogleOAuthState,
  readGoogleSignInConfig,
  sanitiseReturnTo,
  sealGoogleOAuthState,
} from "@/lib/server/google-sign-in";

// Sign in with Google, phase 1 (6 Sep 2026): the pure OAuth/PKCE helpers.

const KEY = randomBytes(32).toString("base64");
const ENV = { GOOGLE_OAUTH_CLIENT_ID: "client-id.apps.googleusercontent.com", GOOGLE_OAUTH_CLIENT_SECRET: "shh", SOCIAL_CREDENTIALS_ENCRYPTION_KEY: KEY };
const CONFIG = { clientId: ENV.GOOGLE_OAUTH_CLIENT_ID, clientSecret: ENV.GOOGLE_OAUTH_CLIENT_SECRET };

describe("readGoogleSignInConfig / isGoogleSignInConfigured", () => {
  it("is dormant until both client values are set, and needs the state-cookie encryption key too", () => {
    expect(readGoogleSignInConfig({})).toBeNull();
    expect(readGoogleSignInConfig({ GOOGLE_OAUTH_CLIENT_ID: "x" })).toBeNull();
    expect(readGoogleSignInConfig({ GOOGLE_OAUTH_CLIENT_ID: " x ", GOOGLE_OAUTH_CLIENT_SECRET: " y " })).toEqual({ clientId: "x", clientSecret: "y" });
    expect(isGoogleSignInConfigured({ GOOGLE_OAUTH_CLIENT_ID: "x", GOOGLE_OAUTH_CLIENT_SECRET: "y" })).toBe(false);
    expect(isGoogleSignInConfigured(ENV)).toBe(true);
  });
});

describe("sanitiseReturnTo", () => {
  it("only honours same-origin paths, never absolute or protocol-relative URLs", () => {
    expect(sanitiseReturnTo("/social?tab=queue")).toBe("/social?tab=queue");
    expect(sanitiseReturnTo("https://evil.example/")).toBe("/");
    expect(sanitiseReturnTo("//evil.example/")).toBe("/");
    expect(sanitiseReturnTo("/ok\r\nLocation: x")).toBe("/");
    expect(sanitiseReturnTo("\\\\evil")).toBe("/");
    expect(sanitiseReturnTo(42)).toBe("/");
    expect(sanitiseReturnTo(undefined)).toBe("/");
    expect(sanitiseReturnTo(`/${"a".repeat(600)}`)).toHaveLength(500);
  });
});

describe("buildGoogleAuthorizeUrl", () => {
  it("asks for openid email profile only, with PKCE S256 and the state/nonce, and never carries the client secret", () => {
    const oauthState = createGoogleOAuthState("/social");
    const url = new URL(buildGoogleAuthorizeUrl(CONFIG, `https://hoodlums.dev${GOOGLE_CALLBACK_PATH}`, oauthState));
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTHORIZE_URL);
    expect(url.searchParams.get("client_id")).toBe(CONFIG.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe("https://hoodlums.dev/api/account/google/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe(oauthState.state);
    expect(url.searchParams.get("nonce")).toBe(oauthState.nonce);
    expect(url.searchParams.get("code_challenge")).toBe(codeChallengeFor(oauthState.codeVerifier));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.toString()).not.toContain(CONFIG.clientSecret);
    expect(url.toString()).not.toContain(oauthState.codeVerifier);
  });

  it("derives the code challenge as base64url(sha256(verifier)) per RFC 7636", () => {
    // RFC 7636 appendix B test vector.
    expect(codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("sealGoogleOAuthState / openGoogleOAuthState", () => {
  it("round-trips through the encrypted cookie and sanitises the return target on the way out", () => {
    const oauthState = createGoogleOAuthState("https://evil.example/steal", 1_000_000);
    const sealed = sealGoogleOAuthState(oauthState, ENV);
    expect(sealed).not.toContain(oauthState.codeVerifier);
    const opened = openGoogleOAuthState(sealed, 1_000_000 + 5_000, ENV);
    expect(opened.status).toBe("ok");
    if (opened.status !== "ok") return;
    expect(opened.state.state).toBe(oauthState.state);
    expect(opened.state.codeVerifier).toBe(oauthState.codeVerifier);
    expect(opened.state.returnTo).toBe("/");
  });

  it("expires after the ten-minute TTL and rejects a cookie from the future", () => {
    const oauthState = createGoogleOAuthState("/", 1_000_000);
    const sealed = sealGoogleOAuthState(oauthState, ENV);
    expect(openGoogleOAuthState(sealed, 1_000_000 + GOOGLE_OAUTH_STATE_TTL_MS + 1, ENV).status).toBe("expired");
    expect(openGoogleOAuthState(sealed, 1_000_000 - 120_000, ENV).status).toBe("expired");
  });

  it("treats a missing, tampered, wrong-key or malformed cookie as invalid rather than throwing", () => {
    const oauthState = createGoogleOAuthState("/", 1_000_000);
    const sealed = sealGoogleOAuthState(oauthState, ENV);
    expect(openGoogleOAuthState(null, 1_000_000, ENV).status).toBe("invalid");
    expect(openGoogleOAuthState("", 1_000_000, ENV).status).toBe("invalid");
    const [iv, tag, ciphertext] = sealed.split(":");
    const flipped = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
    expect(openGoogleOAuthState(`${iv}:${tag}:${flipped}`, 1_000_000, ENV).status).toBe("invalid");
    expect(openGoogleOAuthState("not-a-sealed-value", 1_000_000, ENV).status).toBe("invalid");
    expect(openGoogleOAuthState(sealed, 1_000_000, { SOCIAL_CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString("base64") }).status).toBe("invalid");
    expect(openGoogleOAuthState(sealed, 1_000_000, {}).status).toBe("invalid");
  });

  it("throws when sealing without the encryption key (callers gate on isGoogleSignInConfigured)", () => {
    expect(() => sealGoogleOAuthState(createGoogleOAuthState("/"), {})).toThrow();
  });
});

describe("exchangeGoogleCode", () => {
  const input = { code: "auth-code", codeVerifier: "verifier", redirectUri: "https://hoodlums.dev/api/account/google/callback" };

  function fetchSequence(responses: Array<{ status: number; body: unknown }>) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const next = responses.shift() ?? { status: 500, body: {} };
      return new Response(JSON.stringify(next.body), { status: next.status, headers: { "Content-Type": "application/json" } });
    });
    return { fetchImpl, calls };
  }

  it("is not_configured without a client and never calls Google", async () => {
    const { fetchImpl } = fetchSequence([]);
    expect(await exchangeGoogleCode(input, {}, fetchImpl)).toEqual({ status: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the code with the PKCE verifier, reads userinfo with the token, and returns the profile", async () => {
    const { fetchImpl, calls } = fetchSequence([
      { status: 200, body: { access_token: "ya29.token" } },
      { status: 200, body: { sub: "1234567890", email: "Person@Example.com ", email_verified: true, name: "Person" } },
    ]);
    const result = await exchangeGoogleCode(input, ENV, fetchImpl);
    expect(result).toEqual({
      status: "ok",
      profile: { googleSub: "1234567890", email: "person@example.com", emailVerified: true, displayName: "Person" },
    });
    expect(calls[0].url).toBe(GOOGLE_TOKEN_URL);
    const form = new URLSearchParams(String(calls[0].init?.body));
    expect(form.get("code")).toBe("auth-code");
    expect(form.get("code_verifier")).toBe("verifier");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("redirect_uri")).toBe(input.redirectUri);
    expect(form.get("client_secret")).toBe(ENV.GOOGLE_OAUTH_CLIENT_SECRET);
    expect(calls[1].url).toBe(GOOGLE_USERINFO_URL);
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe("Bearer ya29.token");
  });

  it("reports a failed token exchange with Google's own description, truncated", async () => {
    const { fetchImpl } = fetchSequence([{ status: 400, body: { error: "invalid_grant", error_description: "Bad code" } }]);
    expect(await exchangeGoogleCode(input, ENV, fetchImpl)).toEqual({ status: "exchange_failed", message: "Bad code" });
  });

  it("reports a failed or incomplete profile read", async () => {
    const { fetchImpl } = fetchSequence([{ status: 200, body: { access_token: "t" } }, { status: 200, body: { sub: "1" } }]);
    expect(await exchangeGoogleCode(input, ENV, fetchImpl)).toEqual({ status: "profile_failed", message: "HTTP 200" });
  });

  it("refuses an unverified email", async () => {
    const { fetchImpl } = fetchSequence([
      { status: 200, body: { access_token: "t" } },
      { status: 200, body: { sub: "1", email: "a@b.c", email_verified: false } },
    ]);
    expect(await exchangeGoogleCode(input, ENV, fetchImpl)).toEqual({ status: "unverified_email" });
  });

  it("never throws when the network fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await exchangeGoogleCode(input, ENV, fetchImpl)).toEqual({ status: "exchange_failed", message: "ECONNRESET" });
  });
});
