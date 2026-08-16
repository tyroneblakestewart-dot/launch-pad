import { NextResponse } from "next/server";
import { isAddress } from "viem";
import {
  SOCIAL_STUDIO_READ_LIMIT,
  consumeSocialStudioReadRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { getSocialConnectionsStore } from "@/lib/server/social-connections-store";

// Lists a wallet's connection cards (X/Telegram) for the Social Studio
// Queue tab. Read-only, so — like the existing hoodchat/token-chat GET
// routes — it doesn't gate on an Origin header (plain GET requests from the
// same page often omit one) and trusts the walletAddress query param rather
// than requiring a wallet signature; credentials are never returned, only
// connection metadata.

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

  const walletAddress = new URL(request.url).searchParams.get("walletAddress") || "";
  if (!isAddress(walletAddress)) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400, headers });
  }

  const connections = await getSocialConnectionsStore().list(walletAddress);
  return NextResponse.json(
    {
      connections: connections.map((connection) => ({
        platform: connection.platform,
        status: connection.status,
        displayName: connection.displayName,
        externalId: connection.externalId,
        reconnectReason: connection.reconnectReason,
        updatedAt: connection.updatedAt,
      })),
    },
    { status: 200, headers },
  );
}
