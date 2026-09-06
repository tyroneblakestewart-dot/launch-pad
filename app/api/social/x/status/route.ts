import { NextResponse } from "next/server";
import {
  SOCIAL_STUDIO_READ_LIMIT,
  consumeSocialStudioReadRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { isXSocialConnectConfigured } from "@/lib/server/social-x-client";

// Lets the Social Studio Setup card ask "is X even configured on this
// deployment?" before a user ever taps Connect X (owner request, 6 Sep 2026 —
// the card goes live). Mirrors GET /api/social/telegram/status: a bare boolean
// derived from X_SOCIAL_CONSUMER_KEY / X_SOCIAL_CONSUMER_SECRET, never the
// keys themselves, so it is safe without wallet auth or an Origin check.

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

  return NextResponse.json({ configured: isXSocialConnectConfigured() }, { status: 200, headers });
}
