import { NextResponse } from "next/server";
import {
  CHAT_POST_LIMIT,
  consumeHoodchatPostRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import {
  hashChatMessageContent,
  hashChatNonce,
  tryConsumeChatChallenge,
  verifyChatSignature,
  type ChatChallengeConsumeResult,
} from "@/lib/server/chat-auth";
import { validateChatMessageBody } from "@/lib/server/chat-moderation";
import {
  HoodchatStoreUnavailableError,
  getHoodchatStore,
  isHoodchatCategory,
  type HoodchatCategory,
} from "@/lib/server/hoodchat-store";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";

export const runtime = "nodejs";

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin") || "";
  const configured =
    process.env.HOODCHAT_ALLOWED_ORIGIN?.trim() ||
    process.env.PUBLISH_ALLOWED_ORIGIN?.trim() ||
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN?.trim() ||
    new URL(request.url).origin;
  return Boolean(origin && origin === configured);
}

function responseHeaders(rate: ReturnType<typeof consumeHoodchatPostRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(CHAT_POST_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function challengeFailureResponse(
  result: Exclude<ChatChallengeConsumeResult, { status: "ok" }>,
  headers: Record<string, string>,
) {
  if (result.status === "nonce_expired") {
    return NextResponse.json(
      { error: "The posting challenge expired. Request a new one." },
      { status: 410, headers },
    );
  }
  if (result.status === "nonce_replayed") {
    return NextResponse.json(
      { error: "That posting challenge has already been used." },
      { status: 409, headers },
    );
  }
  return NextResponse.json({ error: "Wallet posting authorisation failed." }, { status: 401, headers });
}

export async function GET(request: Request) {
  const isolationResponse = await getServiceIsolationResponse("hoodchat");
  if (isolationResponse) return isolationResponse;

  const url = new URL(request.url);
  const categoryParam = url.searchParams.get("category") || "all";
  const category: HoodchatCategory | "all" = categoryParam === "all" || isHoodchatCategory(categoryParam)
    ? (categoryParam as HoodchatCategory | "all")
    : "all";

  try {
    const messages = await getHoodchatStore().listMessages(category);
    return NextResponse.json({ messages }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const unavailable = error instanceof HoodchatStoreUnavailableError;
    return NextResponse.json(
      { error: unavailable ? "Hoodchat is not configured on this deployment." : "The Hoodchat feed could not be loaded." },
      { status: unavailable ? 503 : 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!allowedOrigin(request)) {
    return NextResponse.json(
      { error: "Hoodchat post request origin is not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rate = consumeHoodchatPostRateLimit(getClientIp(request));
  const headers = responseHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many Hoodchat post requests. Try again later." },
      { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const isolationResponse = await getServiceIsolationResponse("hoodchat");
  if (isolationResponse) return isolationResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  const category = body?.category;
  const messageValidation = validateChatMessageBody(body?.body);

  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^[A-Za-z0-9_-]{20,128}$/.test(nonce)) {
    return NextResponse.json({ error: "A valid posting challenge is required." }, { status: 400, headers });
  }
  if (!/^0x[0-9a-f]{130}$/i.test(signature)) {
    return NextResponse.json({ error: "A valid wallet message signature is required." }, { status: 400, headers });
  }
  if (!isHoodchatCategory(category)) {
    return NextResponse.json({ error: "A valid message category is required." }, { status: 400, headers });
  }
  if (!messageValidation.valid) {
    return NextResponse.json({ error: messageValidation.reason }, { status: 400, headers });
  }

  const contentHash = hashChatMessageContent(`${category}:${messageValidation.body}`);
  const consumed = tryConsumeChatChallenge(challengeId, hashChatNonce(nonce), contentHash);
  if (consumed.status !== "ok") return challengeFailureResponse(consumed, headers);

  const validSignature = await verifyChatSignature(consumed.challenge, nonce, signature);
  if (!validSignature) {
    return NextResponse.json({ error: "Wallet posting authorisation failed." }, { status: 401, headers });
  }

  try {
    const result = await getHoodchatStore().insertMessageIfUnderLimit({
      walletAddress: consumed.challenge.walletAddress,
      category,
      body: messageValidation.body,
    });
    if (result.status === "rate_limited") {
      return NextResponse.json(
        { error: "You can post up to 5 Hoodchat messages per hour. Try again later." },
        { status: 429, headers },
      );
    }
    return NextResponse.json({ message: result.message }, { status: 201, headers });
  } catch (error) {
    const unavailable = error instanceof HoodchatStoreUnavailableError;
    return NextResponse.json(
      {
        error: unavailable
          ? "Hoodchat is not configured on this deployment."
          : "The message could not be posted.",
      },
      { status: unavailable ? 503 : 500, headers },
    );
  }
}
