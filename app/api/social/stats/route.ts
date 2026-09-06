import { NextResponse } from "next/server";
import { isAddress } from "viem";
import {
  SOCIAL_STUDIO_READ_LIMIT,
  consumeSocialStudioReadRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { getSocialStats } from "@/lib/server/social-stats";

// Read-only figures for the Queue tab's private "How it's going" panel
// (lib/server/social-stats.ts). Like GET /api/social/connections it trusts
// the walletAddress query param and returns nothing secret — a holder count
// is public on the token page already, and a channel member count is
// visible to anyone in that channel.

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

  const url = new URL(request.url);
  const walletAddress = url.searchParams.get("walletAddress") || "";
  const tokenAddress = (url.searchParams.get("tokenAddress") || "").trim();
  if (!isAddress(walletAddress)) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400, headers });
  }
  if (tokenAddress && !isAddress(tokenAddress)) {
    return NextResponse.json({ error: "A valid token address is required." }, { status: 400, headers });
  }

  const stats = await getSocialStats(walletAddress, tokenAddress);
  return NextResponse.json(stats, { status: 200, headers });
}
