import { NextResponse } from "next/server";
import {
  CHAT_REPORT_LIMIT,
  consumeTokenChatReportRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { TokenChatStoreUnavailableError, getTokenChatStore } from "@/lib/server/token-chat-store";

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

function responseHeaders(rate: ReturnType<typeof consumeTokenChatReportRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(CHAT_REPORT_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

export async function POST(request: Request) {
  if (!allowedOrigin(request)) {
    return NextResponse.json(
      { error: "Token chat report request origin is not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rate = consumeTokenChatReportRateLimit(getClientIp(request));
  const headers = responseHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many report requests. Try again later." },
      { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const isolationResponse = await getServiceIsolationResponse("token-chat");
  if (isolationResponse) return isolationResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const messageId = typeof body?.messageId === "string" ? body.messageId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) {
    return NextResponse.json({ error: "A valid message ID is required." }, { status: 400, headers });
  }

  try {
    const result = await getTokenChatStore().reportMessage(messageId);
    if (result.status === "not_found") {
      return NextResponse.json({ error: "Message not found." }, { status: 404, headers });
    }
    return NextResponse.json({ reported: true, hidden: result.hidden }, { status: 200, headers });
  } catch (error) {
    const unavailable = error instanceof TokenChatStoreUnavailableError;
    return NextResponse.json(
      {
        error: unavailable
          ? "Token chat is not configured on this deployment."
          : "The report could not be recorded.",
      },
      { status: unavailable ? 503 : 500, headers },
    );
  }
}
