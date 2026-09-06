import { NextResponse } from "next/server";
import { readAccountSession } from "@/lib/server/account-session";
import { ACCOUNT_READ_LIMIT, consumeAccountReadRateLimit, getClientIp } from "@/lib/server/api-protection";
import { isGoogleSignInConfigured } from "@/lib/server/google-sign-in";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { toAccountSummary } from "@/lib/server/user-accounts-store";

// Who is signed in, for the account panel (phase 1, 6 Sep 2026). Read-only;
// returns whether Google sign-in is even configured so the panel can keep
// the row honest, and the account summary (email, linked wallet) when a
// session cookie is live. Never the Google id, never a token.

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rate = consumeAccountReadRateLimit(getClientIp(request));
  const headers = {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(ACCOUNT_READ_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("google-sign-in");
  if (isolationResponse) return isolationResponse;

  const account = await readAccountSession(request);
  return NextResponse.json(
    { configured: isGoogleSignInConfigured(), account: account ? toAccountSummary(account) : null },
    { status: 200, headers },
  );
}
