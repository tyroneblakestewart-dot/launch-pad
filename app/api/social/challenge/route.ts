import { NextResponse } from "next/server";
import {
  SOCIAL_STUDIO_ACTION_LIMIT,
  consumeSocialStudioActionRateLimit,
  getClientIp,
  isSocialStudioRequestOriginAllowed,
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
import { hashSocialStudioAction, isSocialStudioActionPurpose } from "@/lib/server/social-studio-action-auth";

// Issues a wallet-signed challenge for one Social Studio action (connect,
// disconnect, or approve/cancel a scheduled post — issue #335). Generic over
// `purpose`/`payload` so every action shares one challenge route instead of
// duplicating this issuance logic per action, the same way hoodchat and
// token-chat already share lib/server/chat-auth.ts. Each action route is the
// authority on what its payload means — it independently recomputes the
// contentHash from its own validated fields before consuming the challenge.

export const runtime = "nodejs";

function responseHeaders(rate: ReturnType<typeof consumeSocialStudioActionRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(SOCIAL_STUDIO_ACTION_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

export async function POST(request: Request) {
  if (!isSocialStudioRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Social Studio challenge request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const rate = consumeSocialStudioActionRateLimit(getClientIp(request));
  const headers = responseHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many Social Studio action requests. Try again later." },
      { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const isolationResponse = await getServiceIsolationResponse("social-posting");
  if (isolationResponse) return isolationResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const walletAddress = normaliseChatWalletAddress(body?.walletAddress);
  const walletChainId = normaliseChatWalletChainId(body?.walletChainId);
  const purpose = body?.purpose;
  const payload = body?.payload;

  if (!walletAddress || !walletChainId) {
    return NextResponse.json({ error: "A valid EVM wallet address and wallet chain ID are required." }, { status: 400, headers });
  }
  if (!isSocialStudioActionPurpose(purpose)) {
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
  const contentHash = hashSocialStudioAction(purpose, payloadRecord);

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
