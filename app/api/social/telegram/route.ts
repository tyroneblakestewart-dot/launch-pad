import { NextResponse } from "next/server";
import {
  MAX_TELEGRAM_TEXT_LENGTH,
  isBotToken,
  isChatId,
  parseArtwork,
  publishTelegramPost,
} from "@/lib/server/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TelegramRequest = {
  botToken?: unknown;
  chatId?: unknown;
  text?: unknown;
  artwork?: unknown;
};

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
  let body: TelegramRequest;
  try {
    body = (await request.json()) as TelegramRequest;
  } catch {
    return jsonError("The Telegram request body was not valid JSON.", 400);
  }

  const botToken = typeof body.botToken === "string" ? body.botToken.trim() : "";
  const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const artworkValue = typeof body.artwork === "string" ? body.artwork.trim() : "";

  if (!isBotToken(botToken)) {
    return jsonError("The BotFather token format is not valid.", 400);
  }
  if (!isChatId(chatId)) {
    return jsonError(
      "Use a public channel username such as @channel or a numeric Telegram chat ID.",
      400,
    );
  }
  if (!text) {
    return jsonError("The Telegram post is empty.", 400);
  }
  if (text.length > MAX_TELEGRAM_TEXT_LENGTH) {
    return jsonError(
      `Telegram text must be ${MAX_TELEGRAM_TEXT_LENGTH} characters or fewer.`,
      400,
    );
  }

  const artwork = artworkValue ? parseArtwork(artworkValue) : null;
  if (artworkValue && !artwork) {
    return jsonError("Artwork must be a PNG, JPG or WEBP image below 3 MB.", 400);
  }

  try {
    const messageIds = await publishTelegramPost({
      botToken,
      chatId,
      text,
      artwork,
    });

    return NextResponse.json(
      { ok: true, messageIds },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram publishing failed.";
    return jsonError(message, 502);
  }
}
