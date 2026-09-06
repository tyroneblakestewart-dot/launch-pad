import { NextResponse } from "next/server";
import { hashAccountAction, isAccountActionPurpose } from "@/lib/server/account-link-auth";
import { readAccountSession } from "@/lib/server/account-session";
import { ACCOUNT_ACTION_LIMIT, consumeAccountActionRateLimit, getClientIp, isAccountRequestOriginAllowed } from "@/lib/server/api-protection";
import {
  CHAT_NONCE_TTL_MS,
  buildChatAuthorisationMessage,
  createChatChallenge,
  createChatNonce,
  hashChatNonce,
  normaliseChatWalletAddress,
  normaliseChatWalletChainId,
} from "@/lib/server/chat-auth";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";

// Issues the wallet-signed challenge for binding a wallet to the signed-in
// Google account (phase 1, 6 Sep 2026) — the same challenge shape as
// /api/social/challenge and /api/support/challenge. Requires a live session:
// the payload is bound to that session's account id server-side, never a
// client-supplied one.

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
  if (!account) {
    return NextResponse.json({ error: "Sign in with Google first." }, { status: 401, headers });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const walletAddress = normaliseChatWalletAddress(body?.walletAddress);
  const walletChainId = normaliseChatWalletChainId(body?.walletChainId);
  const purpose = body?.purpose;
  if (!walletAddress || !walletChainId) {
    return NextResponse.json({ error: "A valid EVM wallet address and wallet chain ID are required." }, { status: 400, headers });
  }
  if (!isAccountActionPurpose(purpose)) {
    return NextResponse.json({ error: "A valid action purpose is required." }, { status: 400, headers });
  }

  const nonce = createChatNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHAT_NONCE_TTL_MS);
  const challenge = createChatChallenge({
    nonceHash: hashChatNonce(nonce),
    walletAddress,
    walletChainId,
    purpose,
    contentHash: hashAccountAction(purpose, { accountId: account.id }),
    issuedAt,
    expiresAt,
  });
  const message = buildChatAuthorisationMessage({ ...challenge, nonce });

  return NextResponse.json(
    {
      challengeId: challenge.id,
      walletAddress: challenge.walletAddress,
      walletChainId: challenge.walletChainId,
      nonce,
      message,
      issuedAt: challenge.issuedAt.toISOString(),
      expiresAt: challenge.expiresAt.toISOString(),
    },
    { status: 201, headers },
  );
}
