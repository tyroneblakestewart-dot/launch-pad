import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { DEFAULT_BUY_BOT_THRESHOLD_WEI, isBuyBotThresholdPreset } from "@/lib/buy-bot-presets";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import {
  SOCIAL_STUDIO_ACTION_LIMIT,
  SOCIAL_STUDIO_READ_LIMIT,
  consumeSocialStudioActionRateLimit,
  consumeSocialStudioReadRateLimit,
  getClientIp,
  isSocialStudioRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { newestTradeCursor } from "@/lib/server/buy-bot-alerts";
import { resolveBuyBotTradesReader } from "@/lib/server/buy-bot-cron";
import { BuyBotStoreUnavailableError, getBuyBotStore, toBuyBotSummary } from "@/lib/server/buy-bot-store";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { authoriseSocialStudioAction, type AuthoriseSocialStudioActionResult } from "@/lib/server/social-studio-action-auth";
import { authoriseSocialStudioRequest } from "@/lib/server/social-studio-entitlement";
import { isTelegramConnectConfigured, verifyTelegramChannelAdmin } from "@/lib/server/social-telegram-connect";
import { isChatId } from "@/lib/server/telegram";
import { getTokenLaunchesStore } from "@/lib/server/token-launches-store";

// Buy Bot (owner direction, 5 Sep 2026). GET lists a wallet's bots for the
// /social Setup card and Rules row; POST switches the bot on for one token,
// bound to its own Telegram channel. The POST follows
// app/api/social/telegram/connect/route.ts's shape exactly — Origin, per-IP
// action rate limit, service isolation, a wallet-signed challenge bound to
// this exact payload, then a real getChat/getChatMember check that the
// platform bot is an admin in the named channel before anything is stored —
// plus two checks of its own: the wallet must hold the Pro/Pro Bundle
// entitlement every Social Studio route requires, and it must be the wallet
// that launched the token (the recorded token_launches creator), so nobody
// can point a buy announcer for someone else's token at their own channel.
// The bot's cursor starts at the newest trade that exists right now, so the
// first announcement is the first buy AFTER it was switched on — history is
// never replayed into the channel.

export const runtime = "nodejs";

function actionHeaders(rate: ReturnType<typeof consumeSocialStudioActionRateLimit>) {
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

  const isolationResponse = await getServiceIsolationResponse("buy-bot");
  if (isolationResponse) return isolationResponse;

  const walletAddress = new URL(request.url).searchParams.get("walletAddress") || "";
  if (!isAddress(walletAddress)) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400, headers });
  }

  const bots = await getBuyBotStore().listForWallet(walletAddress);
  return NextResponse.json({ bots: bots.map(toBuyBotSummary) }, { status: 200, headers });
}

export async function POST(request: Request) {
  if (!isSocialStudioRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const rate = consumeSocialStudioActionRateLimit(getClientIp(request));
  const headers = actionHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("buy-bot");
  if (isolationResponse) return isolationResponse;

  if (!isTelegramConnectConfigured()) {
    return NextResponse.json({ error: "Telegram is not configured on this deployment (TELEGRAM_BOT_TOKEN unset)." }, { status: 503, headers });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const chainId = Number(typeof body?.chainId === "string" || typeof body?.chainId === "number" ? body.chainId : NaN);
  const tokenAddress = typeof body?.tokenAddress === "string" ? body.tokenAddress.trim() : "";
  const chatId = typeof body?.chatId === "string" ? body.chatId.trim() : "";
  const thresholdWei = typeof body?.thresholdWei === "string" && body.thresholdWei.trim() ? body.thresholdWei.trim() : DEFAULT_BUY_BOT_THRESHOLD_WEI;
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";

  if (!chatId || !challengeId || !nonce || !signature || !tokenAddress) {
    return NextResponse.json({ error: "A token, a channel, a valid Buy Bot challenge and a signature are all required." }, { status: 400, headers });
  }
  if (chainId !== ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL) {
    return NextResponse.json({ error: "The Buy Bot only supports Robinhood Chain Testnet tokens today." }, { status: 400, headers });
  }
  if (!isAddress(tokenAddress)) {
    return NextResponse.json({ error: "A valid token contract address is required." }, { status: 400, headers });
  }
  if (!isChatId(chatId)) {
    return NextResponse.json({ error: "Use a public channel username such as @channel or a numeric chat ID." }, { status: 400, headers });
  }
  if (!isBuyBotThresholdPreset(thresholdWei)) {
    return NextResponse.json({ error: "Pick one of the offered buy thresholds." }, { status: 400, headers });
  }

  const authorisation = await authoriseSocialStudioAction({
    purpose: "social:buy-bot-enable",
    payload: { chainId: String(chainId), tokenAddress, chatId, thresholdWei },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, headers);
  const walletAddress = authorisation.walletAddress;

  const entitlement = await authoriseSocialStudioRequest(walletAddress);
  if (entitlement.status !== "allowed") {
    const status = entitlement.status === "upsell" ? 403 : entitlement.status === "invalid-wallet" ? 400 : 503;
    return NextResponse.json({ error: entitlement.message }, { status, headers });
  }

  let launch;
  try {
    launch = await getTokenLaunchesStore().findByTokenAddress(chainId, tokenAddress);
  } catch {
    return NextResponse.json({ error: "The launch record could not be read right now. Try again." }, { status: 503, headers });
  }
  if (!launch) {
    return NextResponse.json({ error: "This token isn't a recorded Hoodlums launch, so the Buy Bot has no curve to watch." }, { status: 404, headers });
  }
  if (launch.creatorWalletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    return NextResponse.json({ error: "Only the wallet that launched this token can add a Buy Bot for it." }, { status: 403, headers });
  }

  const verification = await verifyTelegramChannelAdmin(chatId);
  if (verification.status === "not_configured") {
    return NextResponse.json({ error: "Telegram is not configured on this deployment." }, { status: 503, headers });
  }
  if (verification.status === "invalid_chat_id") {
    return NextResponse.json({ error: "Use a public channel username such as @channel or a numeric chat ID." }, { status: 400, headers });
  }
  if (verification.status === "chat_not_found") {
    return NextResponse.json({ error: "Telegram could not find that channel." }, { status: 400, headers });
  }
  if (verification.status === "not_admin") {
    return NextResponse.json({ error: verification.message }, { status: 400, headers });
  }
  if (verification.status === "api_error") {
    return NextResponse.json({ error: verification.message }, { status: 502, headers });
  }

  // Seat the cursor at the newest existing trade so nothing before "now" is
  // ever announced. A trade-read failure blocks enabling (502) rather than
  // guessing a cursor that could replay the token's whole history.
  let cursor;
  try {
    cursor = newestTradeCursor(await resolveBuyBotTradesReader()(chainId, launch.curveAddress as `0x${string}`));
  } catch {
    return NextResponse.json({ error: "The token's trades could not be read right now, so the Buy Bot wasn't switched on. Try again in a moment." }, { status: 502, headers });
  }

  try {
    const bot = await getBuyBotStore().upsert({
      walletAddress,
      chainId,
      tokenAddress,
      curveAddress: launch.curveAddress,
      channelDisplayName: verification.displayName,
      channelExternalId: verification.chatId,
      channel: JSON.stringify({ chatId: verification.chatId }),
      thresholdWei,
      cursorBlockNumber: cursor.blockNumber,
      cursorLogIndex: cursor.logIndex,
    });
    await recordAdminActivityBestEffort({
      kind: "buy-bot-enabled",
      serviceKey: "buy-bot",
      message: `Wallet ${walletAddress} switched the Buy Bot on for ${launch.tokenName} (${tokenAddress}) in ${verification.displayName}.`,
    });
    return NextResponse.json({ bot: toBuyBotSummary(bot) }, { status: 200, headers });
  } catch (error) {
    const unavailable = error instanceof BuyBotStoreUnavailableError;
    return NextResponse.json(
      { error: unavailable ? "The Buy Bot is not configured on this deployment." : "The Buy Bot could not be saved." },
      { status: unavailable ? 503 : 500, headers },
    );
  }
}
