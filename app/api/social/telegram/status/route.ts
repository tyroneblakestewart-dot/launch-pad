import { NextResponse } from "next/server";
import {
  SOCIAL_STUDIO_READ_LIMIT,
  consumeSocialStudioReadRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { isTelegramConnectConfigured } from "@/lib/server/social-telegram-connect";

// Lets the Social Studio Setup card ask "is Telegram even configured on this
// deployment?" before a user ever tries to connect a channel (issue #340) —
// previously the card always presented Telegram as a ready "Server bot",
// even when TELEGRAM_BOT_TOKEN was unset, and the only way to discover that
// was a failed send. Returns a bare boolean; never the token itself, so this
// is safe to expose without wallet auth or an Origin check, the same as the
// read-only GET /api/social/connections route.

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rate = consumeSocialStudioReadRateLimit(getClientIp(request));
  const headers = {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(SOCIAL_STUDIO_READ_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("social-posting");
  if (isolationResponse) return isolationResponse;

  return NextResponse.json({ configured: isTelegramConnectConfigured() }, { status: 200, headers });
}
