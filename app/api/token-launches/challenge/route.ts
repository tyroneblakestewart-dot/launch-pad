import { NextResponse } from "next/server";
import {
  TOKEN_LAUNCH_ACTION_LIMIT,
  consumeTokenLaunchActionRateLimit,
  getClientIp,
  isTokenLaunchRequestOriginAllowed,
} from "@/lib/server/api-protection";
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
import { hashTokenLaunchAction, isTokenLaunchActionPurpose } from "@/lib/server/token-launch-auth";

// Issues a wallet-signed challenge for recording a token launch (Milestone A,
// issue #409 Part 2) — the same generic shape as POST /api/support/challenge
// and POST /api/social/challenge, scoped to its own "token-launches"
// service-isolation key so pausing it can never affect Support or Social
// Studio.

export const runtime = "nodejs";

function responseHeaders(rate: ReturnType<typeof consumeTokenLaunchActionRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(TOKEN_LAUNCH_ACTION_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

export async function POST(request: Request) {
  if (!isTokenLaunchRequestOriginAllowed(request)) {
    return NextResponse.json(
      { error: "Token launch challenge request origin is not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rate = consumeTokenLaunchActionRateLimit(getClientIp(request));
  const headers = responseHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many token launch requests. Try again later." },
      { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const isolationResponse = await getServiceIsolationResponse("token-launches");
  if (isolationResponse) return isolationResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const walletAddress = normaliseChatWalletAddress(body?.walletAddress);
  const walletChainId = normaliseChatWalletChainId(body?.walletChainId);
  const purpose = body?.purpose;
  const payload = body?.payload;

  if (!walletAddress || !walletChainId) {
    return NextResponse.json({ error: "A valid EVM wallet address and wallet chain ID are required." }, { status: 400, headers });
  }
  if (!isTokenLaunchActionPurpose(purpose)) {
    return NextResponse.json({ error: "A valid action purpose is required." }, { status: 400, headers });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "A valid action payload is required." }, { status: 400, headers });
  }
  const payloadRecord: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value !== "string") {
      return NextResponse.json({ error: "Action payload values must be strings." }, { status: 400, headers });
    }
    payloadRecord[key] = value;
  }

  const nonce = createChatNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHAT_NONCE_TTL_MS);
  const contentHash = hashTokenLaunchAction(purpose, payloadRecord);

  const challenge = createChatChallenge({
    nonceHash: hashChatNonce(nonce),
    walletAddress,
    walletChainId,
    purpose,
    contentHash,
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
