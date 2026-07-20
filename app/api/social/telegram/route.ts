import { NextResponse } from "next/server";
import {
  MAX_TELEGRAM_CAPTION_LENGTH,
  sendTelegramArtwork,
  sendTelegramText,
  validateTelegramRequest,
} from "@/lib/server/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { ok: false, error },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError("The Telegram request body was not valid JSON.", 400);
  }

  const validation = validateTelegramRequest(rawBody);
  if (!validation.ok) return jsonError(validation.error, 400);

  const { botToken, chatId, text, artwork } = validation.value;

  try {
    const messageIds: number[] = [];

    if (artwork && text.length <= MAX_TELEGRAM_CAPTION_LENGTH) {
      const result = await sendTelegramArtwork(fetch, botToken, chatId, artwork, text);
      messageIds.push(result.message_id);
    } else if (artwork) {
      const photoResult = await sendTelegramArtwork(fetch, botToken, chatId, artwork, "");
      const textResult = await sendTelegramText(fetch, botToken, chatId, text);
      messageIds.push(photoResult.message_id, textResult.message_id);
    } else {
      const result = await sendTelegramText(fetch, botToken, chatId, text);
      messageIds.push(result.message_id);
    }

    return NextResponse.json(
      { ok: true, messageIds },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram publishing failed.";
    return jsonError(message, 502);
  }
}
