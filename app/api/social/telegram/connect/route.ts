import { NextResponse } from "next/server";
import {
  SOCIAL_STUDIO_ACTION_LIMIT,
  consumeSocialStudioActionRateLimit,
  getClientIp,
  isSocialStudioRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { SocialConnectionsStoreUnavailableError, getSocialConnectionsStore } from "@/lib/server/social-connections-store";
import { authoriseSocialStudioAction, type AuthoriseSocialStudioActionResult } from "@/lib/server/social-studio-action-auth";
import { isTelegramConnectConfigured, verifyTelegramChannelAdmin } from "@/lib/server/social-telegram-connect";

// Real Telegram connect flow (issue #335): unlike the old bare chat-ID text
// field, this confirms the platform bot (TELEGRAM_BOT_TOKEN) is actually an
// admin with posting rights in the named channel before ever storing a
// connection, and reports exactly what's missing when it isn't.

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
  if (result.status === "expired") return NextResponse.json({ error: "The connect challenge expired. Try again." }, { status: 410, headers });
  if (result.status === "replayed") return NextResponse.json({ error: "That connect challenge has already been used." }, { status: 409, headers });
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

  const isolationResponse = await getServiceIsolationResponse("social-posting");
  if (isolationResponse) return isolationResponse;

  if (!isTelegramConnectConfigured()) {
    return NextResponse.json({ error: "Telegram is not configured on this deployment (TELEGRAM_BOT_TOKEN unset)." }, { status: 503, headers });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const chatId = typeof body?.chatId === "string" ? body.chatId.trim() : "";
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  if (!chatId || !challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A channel, a valid connect challenge and a signature are all required." }, { status: 400, headers });
  }

  const authorisation = await authoriseSocialStudioAction({
    purpose: "social:telegram-connect",
    payload: { chatId },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, headers);

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

  try {
    const connection = await getSocialConnectionsStore().upsert({
      walletAddress: authorisation.walletAddress,
      platform: "telegram",
      displayName: verification.displayName,
      externalId: verification.chatId,
      credentials: JSON.stringify({ chatId: verification.chatId }),
    });
    await recordAdminActivityBestEffort({
      kind: "social-telegram-connected",
      serviceKey: "social-posting",
      message: `Wallet ${authorisation.walletAddress} connected Telegram (${verification.displayName}).`,
    });
    return NextResponse.json({ connection: { platform: connection.platform, status: connection.status, displayName: connection.displayName } }, { status: 200, headers });
  } catch (error) {
    const unavailable = error instanceof SocialConnectionsStoreUnavailableError;
    return NextResponse.json(
      { error: unavailable ? "Social Studio connections are not configured on this deployment." : "The connection could not be saved." },
      { status: unavailable ? 503 : 500, headers },
    );
  }
}
