import { NextResponse } from "next/server";
import {
  CHAT_CHALLENGE_LIMIT,
  consumeTokenChatChallengeRateLimit,
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
import { isValidDexAddress } from "@/lib/server/dexscreener";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import type { SupportedChain } from "@/lib/types";

export const runtime = "nodejs";

const TOKEN_CHAT_PURPOSE = "token_chat_post_message";

function isSupportedChain(value: unknown): value is SupportedChain {
  return value === "robinhood" || value === "solana";
}

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin") || "";
  const configured =
    process.env.HOODCHAT_ALLOWED_ORIGIN?.trim() ||
    process.env.PUBLISH_ALLOWED_ORIGIN?.trim() ||
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN?.trim() ||
    new URL(request.url).origin;
  return Boolean(origin && origin === configured);
}

function responseHeaders(rate: ReturnType<typeof consumeTokenChatChallengeRateLimit>) {
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
      { error: "Token chat challenge request origin is not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rate = consumeTokenChatChallengeRateLimit(getClientIp(request));
  const headers = responseHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many token chat challenge requests. Try again later." },
      { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const isolationResponse = await getServiceIsolationResponse("token-chat");
  if (isolationResponse) return isolationResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const walletAddress = normaliseChatWalletAddress(body?.walletAddress);
  const walletChainId = normaliseChatWalletChainId(body?.walletChainId);
  const chain = body?.chain;
  const contractAddress = typeof body?.contractAddress === "string" ? body.contractAddress.trim() : "";
  const messageValidation = validateChatMessageBody(body?.body);

  if (!walletAddress || !walletChainId) {
    return NextResponse.json(
      { error: "A valid EVM wallet address and wallet chain ID are required." },
      { status: 400, headers },
    );
  }
  if (!isSupportedChain(chain) || !isValidDexAddress(contractAddress)) {
    return NextResponse.json({ error: "A valid chain and contract address are required." }, { status: 400, headers });
  }
  if (!messageValidation.valid) {
    return NextResponse.json({ error: messageValidation.reason }, { status: 400, headers });
  }

  const nonce = createChatNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHAT_NONCE_TTL_MS);
  const contentHash = hashChatMessageContent(
    `${chain}:${contractAddress.toLowerCase()}:${messageValidation.body}`,
  );

  const challenge = createChatChallenge({
    nonceHash: hashChatNonce(nonce),
    walletAddress,
    walletChainId,
    purpose: TOKEN_CHAT_PURPOSE,
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
