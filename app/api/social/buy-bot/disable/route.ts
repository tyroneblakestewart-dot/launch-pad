import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import {
  SOCIAL_STUDIO_ACTION_LIMIT,
  consumeSocialStudioActionRateLimit,
  getClientIp,
  isSocialStudioRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { BuyBotStoreUnavailableError, getBuyBotStore } from "@/lib/server/buy-bot-store";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { authoriseSocialStudioAction, type AuthoriseSocialStudioActionResult } from "@/lib/server/social-studio-action-auth";

// Removes a Buy Bot from its channel (owner direction, 5 Sep 2026) — deletes
// the wallet's own row for that token, channel binding included. Mirrors
// app/api/social/telegram/disconnect/route.ts.

export const runtime = "nodejs";

function responseHeaders(rate: ReturnType<typeof consumeSocialStudioActionRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(SOCIAL_STUDIO_ACTION_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function authFailureResponse(result: Exclude<AuthoriseSocialStudioActionResult, { status: "ok" }>, headers: Record<string, string>) {
  if (result.status === "expired") return NextResponse.json({ error: "The Buy Bot challenge expired. Try again." }, { status: 410, headers });
  if (result.status === "replayed") return NextResponse.json({ error: "That Buy Bot challenge has already been used." }, { status: 409, headers });
  return NextResponse.json({ error: "Wallet authorisation failed." }, { status: 401, headers });
}

export async function POST(request: Request) {
  if (!isSocialStudioRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const rate = consumeSocialStudioActionRateLimit(getClientIp(request));
  const headers = responseHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("buy-bot");
  if (isolationResponse) return isolationResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const chainId = Number(typeof body?.chainId === "string" || typeof body?.chainId === "number" ? body.chainId : NaN);
  const tokenAddress = typeof body?.tokenAddress === "string" ? body.tokenAddress.trim() : "";
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";

  if (!tokenAddress || !challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A token, a valid Buy Bot challenge and a signature are all required." }, { status: 400, headers });
  }
  if (chainId !== ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL || !isAddress(tokenAddress)) {
    return NextResponse.json({ error: "A valid Robinhood Chain Testnet token address is required." }, { status: 400, headers });
  }

  const authorisation = await authoriseSocialStudioAction({
    purpose: "social:buy-bot-disable",
    payload: { chainId: String(chainId), tokenAddress },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, headers);

  try {
    await getBuyBotStore().delete(authorisation.walletAddress, chainId, tokenAddress);
  } catch (error) {
    const unavailable = error instanceof BuyBotStoreUnavailableError;
    return NextResponse.json(
      { error: unavailable ? "The Buy Bot is not configured on this deployment." : "The Buy Bot could not be removed." },
      { status: unavailable ? 503 : 500, headers },
    );
  }
  await recordAdminActivityBestEffort({
    kind: "buy-bot-disabled",
    serviceKey: "buy-bot",
    message: `Wallet ${authorisation.walletAddress} removed the Buy Bot for ${tokenAddress}.`,
  });

  return NextResponse.json({ ok: true }, { status: 200, headers });
}
