import { NextResponse } from "next/server";
import {
  ROBINHOOD_TRENDING_LIMIT,
  consumeRobinhoodTrendingRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";
import {
  GmgnMarketError,
  getCachedRobinhoodTrending,
} from "@/lib/server/gmgn-market";
import { isRobinhoodTrendingInterval } from "@/lib/robinhood-market";

export const runtime = "nodejs";

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

export async function POST(request: Request) {
  const sharedSecret = process.env.GENERATE_SITE_STYLE_SHARED_SECRET || "";
  const allowedOrigin =
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN || "https://hoodlums.dev";
  const protectionEnabled = Boolean(sharedSecret);

  if (!protectionEnabled && process.env.NODE_ENV !== "test") {
    return NextResponse.json(
      { error: "Market-data access protection is not configured." },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  let rateHeaders: Record<string, string> = {};
  if (protectionEnabled) {
    if (!isGenerateSiteStyleRequestAuthorised(request, sharedSecret, allowedOrigin)) {
      return NextResponse.json(
        { error: "Unauthorised market-data request." },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    const rate = consumeRobinhoodTrendingRateLimit(getClientIp(request));
    rateHeaders = {
      "RateLimit-Limit": String(ROBINHOOD_TRENDING_LIMIT),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1_000)),
    };
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Market-data rate limit exceeded. Try again later." },
        {
          status: 429,
          headers: noStoreHeaders({
            ...rateHeaders,
            "Retry-After": String(rate.retryAfterSeconds),
          }),
        },
      );
    }
  }

  let body: { interval?: unknown };
  try {
    body = (await request.json()) as { interval?: unknown };
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  if (!isRobinhoodTrendingInterval(body.interval)) {
    return NextResponse.json(
      { error: "Interval must be 5m or 1h." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const apiKey = process.env.GMGN_API_KEY || "";
  if (!apiKey.trim()) {
    return NextResponse.json(
      { error: "Robinhood market activity is not configured yet." },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }

  try {
    const result = await getCachedRobinhoodTrending(apiKey, body.interval);
    return NextResponse.json(result, {
      headers: noStoreHeaders(rateHeaders),
    });
  } catch (error) {
    const status = error instanceof GmgnMarketError && error.status === 429 ? 503 : 502;
    return NextResponse.json(
      { error: "Live Robinhood market activity is temporarily unavailable." },
      { status, headers: noStoreHeaders(rateHeaders) },
    );
  }
}
