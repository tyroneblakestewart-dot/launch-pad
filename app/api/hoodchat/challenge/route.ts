import { NextResponse } from "next/server";
import {
  CHAT_CHALLENGE_LIMIT,
  consumeHoodchatChallengeRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import {
  CHAT_NONCE_TTL_MS,
  buildChatAuthorisationMessage,
  createChatChallenge,
  createChatNonce,
  hashChatMessageContent,
  hashChatNonce,
  normaliseChatWalletAddress,
  normaliseChatWalletChainId,
} from "@/lib/server/chat-auth";
import { validateChatMessageBody } from "@/lib/server/chat-moderation";
import { isHoodchatCategory } from "@/lib/server/hoodchat-store";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";

export const runtime = "nodejs";

const HOODCHAT_PURPOSE = "hoodchat_post_message";

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin") || "";
  const configured =
    process.env.HOODCHAT_ALLOWED_ORIGIN?.trim() ||
    process.env.PUBLISH_ALLOWED_ORIGIN?.trim() ||
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN?.trim() ||
    new URL(request.url).origin;
  return Boolean(origin && origin === configured);
}

function responseHeaders(rate: ReturnType<typeof consumeHoodchatChallengeRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(CHAT_CHALLENGE_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

export async function POST(request: Request) {
  if (!allowedOrigin(request)) {
    return NextResponse.json(
      { error: "Hoodchat challenge request origin is not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rate = consumeHoodchatChallengeRateLimit(getClientIp(request));
  const headers = responseHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many Hoodchat challenge requests. Try again later." },
      { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const isolationResponse = await getServiceIsolationResponse("hoodchat");
  if (isolationResponse) return isolationResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const walletAddress = normaliseChatWalletAddress(body?.walletAddress);
  const walletChainId = normaliseChatWalletChainId(body?.walletChainId);
  const category = body?.category;
  const messageValidation = validateChatMessageBody(body?.body);

  if (!walletAddress || !walletChainId) {
    return NextResponse.json(
      { error: "A valid EVM wallet address and wallet chain ID are required." },
      { status: 400, headers },
    );
  }
  if (!isHoodchatCategory(category)) {
    return NextResponse.json({ error: "A valid message category is required." }, { status: 400, headers });
  }
  if (!messageValidation.valid) {
    return NextResponse.json({ error: messageValidation.reason }, { status: 400, headers });
  }

  const nonce = createChatNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHAT_NONCE_TTL_MS);
  const contentHash = hashChatMessageContent(`${category}:${messageValidation.body}`);

  const challenge = createChatChallenge({
    nonceHash: hashChatNonce(nonce),
    walletAddress,
    walletChainId,
    purpose: HOODCHAT_PURPOSE,
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
      contentHash: challenge.contentHash,
      nonce,
      message,
      issuedAt: challenge.issuedAt.toISOString(),
      expiresAt: challenge.expiresAt.toISOString(),
    },
    { status: 201, headers },
  );
}
