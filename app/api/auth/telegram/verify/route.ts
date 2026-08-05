import { NextResponse } from "next/server";
import { consumeTelegramOAuthRateLimit, getClientIp } from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import {
  isTelegramAuthFresh,
  isTelegramHashValid,
  parseTelegramLoginPayload,
} from "@/lib/server/telegram-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const isolationResponse = await getServiceIsolationResponse("telegram-oauth");
  if (isolationResponse) return isolationResponse;

  const rate = consumeTelegramOAuthRateLimit(getClientIp(request));
  if (!rate.allowed) {
    return jsonError("Too many Telegram sign-in attempts. Try again later.", 429);
  }

  const botToken = process.env.TELEGRAM_LOGIN_BOT_TOKEN?.trim();
  if (!botToken) {
    return jsonError("Telegram sign-in is not configured on this deployment.", 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("The Telegram sign-in request body was not valid JSON.", 400);
  }

  const payload = parseTelegramLoginPayload(body);
  if (!payload) {
    return jsonError("The Telegram sign-in payload is malformed.", 400);
  }
  if (!isTelegramAuthFresh(payload.auth_date)) {
    return jsonError("The Telegram sign-in has expired. Try connecting again.", 400);
  }
  if (!isTelegramHashValid(payload, botToken)) {
    return jsonError("The Telegram sign-in could not be verified.", 401);
  }
  if (!payload.username) {
    return jsonError(
      "This Telegram account has no public username set. Add one in Telegram's settings and try again.",
      400,
    );
  }

  return NextResponse.json(
    { ok: true, username: payload.username },
    { headers: { "Cache-Control": "no-store" } },
  );
}
