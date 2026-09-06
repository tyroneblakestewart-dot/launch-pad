import { NextResponse } from "next/server";
import { ACCOUNT_SESSION_COOKIE, readAccountSession } from "@/lib/server/account-session";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { consumeAccountActionRateLimit, getClientIp, isAccountRequestOriginAllowed } from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { UserAccountsStoreUnavailableError, getUserAccountsStore } from "@/lib/server/user-accounts-store";

// Deletes the signed-in Google account outright (phase 1, 6 Sep 2026) — the
// email on file, the wallet link and every session. The wallet and
// everything keyed on it are untouched; the account was only ever a linked
// credential. This is what makes "your email is deletable" true.

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAccountRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const rate = consumeAccountActionRateLimit(getClientIp(request));
  const headers = { "Cache-Control": "no-store" };
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }
  const isolationResponse = await getServiceIsolationResponse("google-sign-in");
  if (isolationResponse) return isolationResponse;

  const account = await readAccountSession(request);
  if (!account) return NextResponse.json({ error: "Sign in with Google first." }, { status: 401, headers });

  try {
    await getUserAccountsStore().deleteAccount(account.id);
    void recordAdminActivityBestEffort({ kind: "account-deleted", serviceKey: "google-sign-in", message: `Account ${account.id} deleted by its owner.` });
    const response = NextResponse.json({ ok: true }, { status: 200, headers });
    response.cookies.set({ name: ACCOUNT_SESSION_COOKIE, value: "", path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    const unavailable = error instanceof UserAccountsStoreUnavailableError;
    return NextResponse.json({ error: unavailable ? "Account storage is not configured on this deployment." : "The account could not be deleted." }, { status: unavailable ? 503 : 500, headers });
  }
}
