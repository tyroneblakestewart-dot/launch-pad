import { NextResponse } from "next/server";
import {
  ADMIN_CHALLENGE_LIMIT,
  consumeAdminChallengeRateLimit,
  getClientIp,
  isAdminRequestOriginAllowed,
} from "@/lib/server/api-protection";
import {
  buildAdminAuthorisationMessage,
  createAdminNonce,
  getAdminWalletAddress,
  hashAdminNonce,
  normaliseAdminWalletAddress,
} from "@/lib/server/admin-auth";
import { createAdminChallenge } from "@/lib/server/admin-session-store";

export const runtime = "nodejs";

function responseHeaders(rate: ReturnType<typeof consumeAdminChallengeRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(ADMIN_CHALLENGE_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

export async function POST(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return NextResponse.json(
        { error: "Admin challenge origin is not allowed." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    const rate = consumeAdminChallengeRateLimit(getClientIp(request));
    const headers = responseHeaders(rate);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many admin login attempts. Try again later." },
        { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const adminWalletAddress = getAdminWalletAddress();
    if (!adminWalletAddress) {
      return NextResponse.json(
        { error: "Wallet admin login is not configured on this deployment." },
        { status: 503, headers },
      );
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const walletAddress = normaliseAdminWalletAddress(body?.walletAddress);
    if (!walletAddress) {
      return NextResponse.json(
        { error: "A valid EVM wallet address is required." },
        { status: 400, headers },
      );
    }
    if (walletAddress !== adminWalletAddress) {
      return NextResponse.json(
        { error: "This wallet is not authorised for admin access." },
        { status: 403, headers },
      );
    }

    const nonce = createAdminNonce();
    const challenge = createAdminChallenge(walletAddress, hashAdminNonce(nonce));
    const message = buildAdminAuthorisationMessage({ ...challenge, nonce });

    return NextResponse.json(
      {
        challengeId: challenge.id,
        walletAddress: challenge.walletAddress,
        nonce,
        message,
        issuedAt: challenge.issuedAt.toISOString(),
        expiresAt: challenge.expiresAt.toISOString(),
      },
      { status: 201, headers },
    );
  } catch (error) {
    console.error("Admin challenge failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json(
      { error: "Admin challenge failed unexpectedly. Try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
