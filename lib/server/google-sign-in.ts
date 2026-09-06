import { createHash, randomBytes } from "node:crypto";
import { decryptSocialCredentials, encryptSocialCredentials, isSocialCredentialsEncryptionConfigured } from "@/lib/server/social-credentials-crypto";

// Sign in with Google (OAuth 2.0 authorization code + PKCE), phase 1 (owner
// direction, 6 Sep 2026). Deliberately minimal: the flow asks Google for the
// `openid email profile` scopes only, exchanges the code once, reads the
// userinfo endpoint (id, email, verified flag, name) and then DROPS the
// access token — nothing Google-issued is ever stored, so there is nothing to
// leak or refresh. The PKCE verifier and the anti-CSRF state ride in one
// short-lived encrypted httpOnly cookie between start and callback (the
// round trip leaves this process, and an OAuth 2.0 client needs no durable
// request-token table the way the X OAuth 1.0a flow did). Dormant until
// GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are set.

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
export const GOOGLE_OAUTH_STATE_COOKIE = "hoodlums_google_oauth";
export const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const GOOGLE_CALLBACK_PATH = "/api/account/google/callback";

export type GoogleSignInConfig = { clientId: string; clientSecret: string };

export function readGoogleSignInConfig(env: Record<string, string | undefined> = process.env): GoogleSignInConfig | null {
  const clientId = (env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = (env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Configured only when the Google client AND the at-rest encryption key (used for the state cookie) both exist. */
export function isGoogleSignInConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return readGoogleSignInConfig(env) !== null && isSocialCredentialsEncryptionConfigured(env);
}

export function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type GoogleOAuthState = { state: string; codeVerifier: string; nonce: string; issuedAt: number; returnTo: string };

export function createGoogleOAuthState(returnTo: string, now = Date.now()): GoogleOAuthState {
  return {
    state: base64Url(randomBytes(24)),
    codeVerifier: base64Url(randomBytes(48)),
    nonce: base64Url(randomBytes(16)),
    issuedAt: now,
    returnTo,
  };
}

export function codeChallengeFor(codeVerifier: string): string {
  return base64Url(createHash("sha256").update(codeVerifier, "ascii").digest());
}

/** Only same-origin paths are honoured as a return target — never an absolute URL, so the callback can't be turned into an open redirect. */
export function sanitiseReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/";
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || /[\r\n\\]/.test(trimmed)) return "/";
  return trimmed.slice(0, 500);
}

export function buildGoogleAuthorizeUrl(config: GoogleSignInConfig, redirectUri: string, oauthState: GoogleOAuthState): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", oauthState.state);
  url.searchParams.set("nonce", oauthState.nonce);
  url.searchParams.set("code_challenge", codeChallengeFor(oauthState.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/** Encrypts the state for the cookie. Throws if the encryption key is missing — callers gate on isGoogleSignInConfigured first. */
export function sealGoogleOAuthState(oauthState: GoogleOAuthState, env: Record<string, string | undefined> = process.env): string {
  return encryptSocialCredentials(JSON.stringify(oauthState), env);
}

export type OpenGoogleOAuthStateResult = { status: "ok"; state: GoogleOAuthState } | { status: "invalid" } | { status: "expired" };

export function openGoogleOAuthState(
  sealed: string | null | undefined,
  now = Date.now(),
  env: Record<string, string | undefined> = process.env,
): OpenGoogleOAuthStateResult {
  if (!sealed) return { status: "invalid" };
  const decrypted = decryptSocialCredentials(sealed, env);
  if (decrypted.status !== "ok") return { status: "invalid" };
  let parsed: Partial<GoogleOAuthState>;
  try {
    parsed = JSON.parse(decrypted.plaintext) as Partial<GoogleOAuthState>;
  } catch {
    return { status: "invalid" };
  }
  if (
    typeof parsed.state !== "string" ||
    typeof parsed.codeVerifier !== "string" ||
    typeof parsed.nonce !== "string" ||
    typeof parsed.issuedAt !== "number"
  ) {
    return { status: "invalid" };
  }
  if (now - parsed.issuedAt > GOOGLE_OAUTH_STATE_TTL_MS || parsed.issuedAt > now + 60_000) return { status: "expired" };
  return {
    status: "ok",
    state: { state: parsed.state, codeVerifier: parsed.codeVerifier, nonce: parsed.nonce, issuedAt: parsed.issuedAt, returnTo: sanitiseReturnTo(parsed.returnTo) },
  };
}

export type GoogleProfile = { googleSub: string; email: string; emailVerified: boolean; displayName: string };

export type ExchangeGoogleCodeResult =
  | { status: "ok"; profile: GoogleProfile }
  | { status: "not_configured" }
  | { status: "exchange_failed"; message: string }
  | { status: "profile_failed"; message: string }
  | { status: "unverified_email" };

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Exchanges the authorization code (with the PKCE verifier) for an access
 * token, reads the profile, and forgets the token. Never throws.
 */
export async function exchangeGoogleCode(
  input: { code: string; codeVerifier: string; redirectUri: string },
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<ExchangeGoogleCodeResult> {
  const config = readGoogleSignInConfig(env);
  if (!config) return { status: "not_configured" };

  let accessToken = "";
  try {
    const response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
        code_verifier: input.codeVerifier,
      }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => ({}))) as { access_token?: unknown; error?: unknown; error_description?: unknown };
    if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token) {
      const detail = typeof payload.error_description === "string" ? payload.error_description : typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
      return { status: "exchange_failed", message: detail.slice(0, 200) };
    }
    accessToken = payload.access_token;
  } catch (error) {
    return { status: "exchange_failed", message: (error instanceof Error ? error.message : "Token exchange failed.").slice(0, 200) };
  }

  try {
    const response = await fetchImpl(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => ({}))) as { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown };
    if (!response.ok || typeof payload.sub !== "string" || !payload.sub || typeof payload.email !== "string" || !payload.email) {
      return { status: "profile_failed", message: `HTTP ${response.status}` };
    }
    if (payload.email_verified !== true) return { status: "unverified_email" };
    return {
      status: "ok",
      profile: {
        googleSub: payload.sub.slice(0, 64),
        email: payload.email.trim().toLowerCase().slice(0, 320),
        emailVerified: true,
        displayName: typeof payload.name === "string" ? payload.name.trim().slice(0, 200) : "",
      },
    };
  } catch (error) {
    return { status: "profile_failed", message: (error instanceof Error ? error.message : "Profile read failed.").slice(0, 200) };
  }
}
