import { NextResponse } from "next/server";
import {
  SOCIAL_STUDIO_ACTION_LIMIT,
  consumeSocialStudioActionRateLimit,
  getClientIp,
  isSocialStudioRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { getSocialConnectionsStore } from "@/lib/server/social-connections-store";
import { authoriseSocialStudioAction, type AuthoriseSocialStudioActionResult } from "@/lib/server/social-studio-action-auth";

// "Disconnect Telegram" (issue #335): removes the stored channel binding.
// Wallet-signed via the shared challenge flow, purpose "social:telegram-disconnect".

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
  if (result.status === "expired") return NextResponse.json({ error: "The disconnect challenge expired. Try again." }, { status: 410, headers });
  if (result.status === "replayed") return NextResponse.json({ error: "That disconnect challenge has already been used." }, { status: 409, headers });
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

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  if (!challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A valid disconnect challenge and signature are required." }, { status: 400, headers });
  }

  const authorisation = await authoriseSocialStudioAction({
    purpose: "social:telegram-disconnect",
    payload: { platform: "telegram" },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, headers);

  await getSocialConnectionsStore().delete(authorisation.walletAddress, "telegram");
  await recordAdminActivityBestEffort({
    kind: "social-telegram-disconnected",
    serviceKey: "social-posting",
    message: `Wallet ${authorisation.walletAddress} disconnected Telegram.`,
  });

  return NextResponse.json({ ok: true }, { status: 200, headers });
}
