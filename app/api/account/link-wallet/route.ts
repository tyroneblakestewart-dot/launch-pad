import { NextResponse } from "next/server";
import { authoriseAccountAction } from "@/lib/server/account-link-auth";
import { readAccountSession } from "@/lib/server/account-session";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { ACCOUNT_ACTION_LIMIT, consumeAccountActionRateLimit, getClientIp, isAccountRequestOriginAllowed } from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { UserAccountsStoreUnavailableError, getUserAccountsStore, toAccountSummary } from "@/lib/server/user-accounts-store";

// Binds the wallet that signed the challenge to the signed-in Google account
// (phase 1, 6 Sep 2026). The wallet comes from the verified signature, never
// from the request body, and the challenge was bound to this session's
// account id at issuance. One wallet per account, one account per wallet.

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAccountRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const rate = consumeAccountActionRateLimit(getClientIp(request));
  const headers = {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(ACCOUNT_ACTION_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("google-sign-in");
  if (isolationResponse) return isolationResponse;

  const account = await readAccountSession(request);
  if (!account) return NextResponse.json({ error: "Sign in with Google first." }, { status: 401, headers });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  if (!challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A valid link challenge and signature are required." }, { status: 400, headers });
  }

  const authorisation = await authoriseAccountAction({ purpose: "account:link-wallet", payload: { accountId: account.id }, challengeId, nonce, signature });
  if (authorisation.status === "expired") return NextResponse.json({ error: "The link challenge expired. Try again." }, { status: 410, headers });
  if (authorisation.status === "replayed") return NextResponse.json({ error: "That link challenge has already been used." }, { status: 409, headers });
  if (authorisation.status !== "ok") return NextResponse.json({ error: "Wallet authorisation failed." }, { status: 401, headers });

  try {
    const result = await getUserAccountsStore().linkWallet(account.id, authorisation.walletAddress);
    if (result.status === "wallet_taken") {
      return NextResponse.json(
        { error: "That wallet is already linked to a different Google account. Sign in with that account, or unlink it there first.", code: "wallet-taken" },
        { status: 409, headers },
      );
    }
    if (result.status === "account_not_found") return NextResponse.json({ error: "Your account could not be found. Sign in again." }, { status: 401, headers });
    void recordAdminActivityBestEffort({
      kind: "account-wallet-linked",
      serviceKey: "google-sign-in",
      message: `Account ${account.id} linked wallet ${authorisation.walletAddress}.`,
    });
    return NextResponse.json({ account: toAccountSummary(result.account) }, { status: 200, headers });
  } catch (error) {
    const unavailable = error instanceof UserAccountsStoreUnavailableError;
    return NextResponse.json({ error: unavailable ? "Account storage is not configured on this deployment." : "The wallet could not be linked." }, { status: unavailable ? 503 : 500, headers });
  }
}
