import { NextResponse } from "next/server";
import { ACCOUNT_SESSION_COOKIE, hashAccountSessionToken, parseAccountSessionCookie } from "@/lib/server/account-session";
import { consumeAccountActionRateLimit, getClientIp, isAccountRequestOriginAllowed } from "@/lib/server/api-protection";
import { getUserAccountsStore } from "@/lib/server/user-accounts-store";

// Signs the Google session out on this browser (phase 1, 6 Sep 2026): the
// stored session row is removed and the cookie cleared. Wallet state in the
// browser is untouched — the wallet was never part of the session.

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAccountRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const rate = consumeAccountActionRateLimit(getClientIp(request));
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const token = parseAccountSessionCookie(request.headers.get("cookie"));
  if (token) {
    try {
      await getUserAccountsStore().destroySession(hashAccountSessionToken(token));
    } catch {
      // The cookie is cleared regardless; an orphaned row expires on its own.
    }
  }
  const response = NextResponse.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  response.cookies.set({ name: ACCOUNT_SESSION_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}
