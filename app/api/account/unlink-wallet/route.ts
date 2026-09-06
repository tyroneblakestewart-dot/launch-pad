import { NextResponse } from "next/server";
import { readAccountSession } from "@/lib/server/account-session";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { consumeAccountActionRateLimit, getClientIp, isAccountRequestOriginAllowed } from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { UserAccountsStoreUnavailableError, getUserAccountsStore, toAccountSummary } from "@/lib/server/user-accounts-store";

// Removes the wallet binding from the signed-in Google account (phase 1,
// 6 Sep 2026). Session-only: unlinking takes nothing away from the wallet
// itself — its plan, projects and bots are untouched — so no wallet
// signature is needed to undo a link.

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
    await getUserAccountsStore().unlinkWallet(account.id);
    void recordAdminActivityBestEffort({
      kind: "account-wallet-unlinked",
      serviceKey: "google-sign-in",
      message: `Account ${account.id} unlinked wallet ${account.linkedWalletAddress ?? "(none)"}.`,
    });
    return NextResponse.json({ account: toAccountSummary({ ...account, linkedWalletAddress: null, walletLinkedAt: null }) }, { status: 200, headers });
  } catch (error) {
    const unavailable = error instanceof UserAccountsStoreUnavailableError;
    return NextResponse.json({ error: unavailable ? "Account storage is not configured on this deployment." : "The wallet could not be unlinked." }, { status: unavailable ? 503 : 500, headers });
  }
}
