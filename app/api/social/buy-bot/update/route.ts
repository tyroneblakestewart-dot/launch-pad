import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { isBuyBotThresholdPreset } from "@/lib/buy-bot-presets";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import {
  SOCIAL_STUDIO_ACTION_LIMIT,
  consumeSocialStudioActionRateLimit,
  getClientIp,
  isSocialStudioRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { BuyBotStoreUnavailableError, getBuyBotStore, toBuyBotSummary } from "@/lib/server/buy-bot-store";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { authoriseSocialStudioAction, type AuthoriseSocialStudioActionResult } from "@/lib/server/social-studio-action-auth";

// Changes a Buy Bot's threshold and/or pauses or resumes it (owner direction,
// 5 Sep 2026). Wallet-signed like every other Social Studio action, and the
// store only ever updates the row owned by the signing wallet — a wallet can
// never touch another wallet's bot. Resuming (status "active") also clears
// the failure counter and last error, which is how a user recovers a bot
// that flipped to reconnect_needed after the channel was fixed; re-binding a
// different channel goes through the enable route instead.

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
  const thresholdWei = typeof body?.thresholdWei === "string" ? body.thresholdWei.trim() : "";
  const status = typeof body?.status === "string" ? body.status.trim() : "";
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";

  if (!tokenAddress || !challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A token, a valid Buy Bot challenge and a signature are all required." }, { status: 400, headers });
  }
  if (chainId !== ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL || !isAddress(tokenAddress)) {
    return NextResponse.json({ error: "A valid Robinhood Chain Testnet token address is required." }, { status: 400, headers });
  }
  if (!thresholdWei && !status) {
    return NextResponse.json({ error: "Nothing to change — send a threshold, a status, or both." }, { status: 400, headers });
  }
  if (thresholdWei && !isBuyBotThresholdPreset(thresholdWei)) {
    return NextResponse.json({ error: "Pick one of the offered buy thresholds." }, { status: 400, headers });
  }
  if (status && status !== "active" && status !== "paused") {
    return NextResponse.json({ error: "Status must be active or paused." }, { status: 400, headers });
  }

  const authorisation = await authoriseSocialStudioAction({
    purpose: "social:buy-bot-update",
    payload: { chainId: String(chainId), tokenAddress, thresholdWei, status },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, headers);

  try {
    const bot = await getBuyBotStore().updateSettings(authorisation.walletAddress, chainId, tokenAddress, {
      ...(thresholdWei ? { thresholdWei } : {}),
      ...(status === "active" || status === "paused" ? { status } : {}),
    });
    if (!bot) {
      return NextResponse.json({ error: "No Buy Bot is switched on for this token." }, { status: 404, headers });
    }
    await recordAdminActivityBestEffort({
      kind: "buy-bot-updated",
      serviceKey: "buy-bot",
      message: `Wallet ${authorisation.walletAddress} updated the Buy Bot for ${tokenAddress} (${[thresholdWei ? `threshold ${thresholdWei} wei` : null, status ? `status ${status}` : null].filter(Boolean).join(", ")}).`,
    });
    return NextResponse.json({ bot: toBuyBotSummary(bot) }, { status: 200, headers });
  } catch (error) {
    const unavailable = error instanceof BuyBotStoreUnavailableError;
    return NextResponse.json(
      { error: unavailable ? "The Buy Bot is not configured on this deployment." : "The Buy Bot could not be updated." },
      { status: unavailable ? 503 : 500, headers },
    );
  }
}
