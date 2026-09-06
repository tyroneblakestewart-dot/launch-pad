import { NextResponse } from "next/server";
import { ACCOUNT_SESSION_TTL_MS, accountSessionCookieOptions, createAccountSessionToken, hashAccountSessionToken, parseCookieValue } from "@/lib/server/account-session";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { consumeAccountActionRateLimit, getClientIp } from "@/lib/server/api-protection";
import { GOOGLE_CALLBACK_PATH, GOOGLE_OAUTH_STATE_COOKIE, exchangeGoogleCode, isGoogleSignInConfigured, openGoogleOAuthState } from "@/lib/server/google-sign-in";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { UserAccountsStoreUnavailableError, getUserAccountsStore } from "@/lib/server/user-accounts-store";

// Step 2 of Sign in with Google (phase 1, 6 Sep 2026): Google redirects here
// with ?code&state. The state must match the sealed cookie, the code is
// exchanged with the PKCE verifier, the profile is read and the token dropped,
// the account is created or refreshed, a session cookie is set, and the
// browser is sent back into the app with the account panel open. Every
// failure redirects with a reason rather than rendering a raw error page.

export const runtime = "nodejs";

function redirectInto(origin: string, returnTo: string, status: "success" | "error", reason?: string) {
  const url = new URL(returnTo, origin);
  url.searchParams.set("account", "open");
  url.searchParams.set("google", status);
  if (reason) url.searchParams.set("reason", reason);
  const response = NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  response.cookies.set({ name: GOOGLE_OAUTH_STATE_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.HOODLUMS_APP_ORIGIN?.trim() || url.origin;

  const rate = consumeAccountActionRateLimit(getClientIp(request));
  if (!rate.allowed) return redirectInto(origin, "/", "error", "rate_limited");

  const isolationResponse = await getServiceIsolationResponse("google-sign-in");
  if (isolationResponse) return redirectInto(origin, "/", "error", "paused");
  if (!isGoogleSignInConfigured()) return redirectInto(origin, "/", "error", "not_configured");

  const opened = openGoogleOAuthState(parseCookieValue(request.headers.get("cookie"), GOOGLE_OAUTH_STATE_COOKIE));
  if (opened.status !== "ok") return redirectInto(origin, "/", "error", opened.status === "expired" ? "expired" : "state");
  const { state: oauthState } = opened;

  if (url.searchParams.get("error")) return redirectInto(origin, oauthState.returnTo, "error", "denied");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !state || state !== oauthState.state) return redirectInto(origin, oauthState.returnTo, "error", "state");

  const exchanged = await exchangeGoogleCode({ code, codeVerifier: oauthState.codeVerifier, redirectUri: `${origin}${GOOGLE_CALLBACK_PATH}` });
  if (exchanged.status !== "ok") return redirectInto(origin, oauthState.returnTo, "error", exchanged.status);

  try {
    const store = getUserAccountsStore();
    const account = await store.upsertGoogleAccount(exchanged.profile);
    const token = createAccountSessionToken();
    const expiresAt = new Date(Date.now() + ACCOUNT_SESSION_TTL_MS);
    await store.createSession(account.id, hashAccountSessionToken(token), expiresAt);
    void recordAdminActivityBestEffort({
      kind: "account-google-signed-in",
      serviceKey: "google-sign-in",
      message: `Google sign-in for account ${account.id}${account.linkedWalletAddress ? ` (wallet ${account.linkedWalletAddress})` : ""}.`,
    });
    const response = redirectInto(origin, oauthState.returnTo, "success");
    response.cookies.set({ ...accountSessionCookieOptions(expiresAt), value: token });
    return response;
  } catch (error) {
    return redirectInto(origin, oauthState.returnTo, "error", error instanceof UserAccountsStoreUnavailableError ? "storage" : "save_failed");
  }
}
