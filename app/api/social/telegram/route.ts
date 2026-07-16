import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT_LENGTH = 4096;
const MAX_CAPTION_LENGTH = 1024;
const MAX_ARTWORK_BYTES = 3_000_000;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type TelegramRequest = {
  botToken?: unknown;
  chatId?: unknown;
  text?: unknown;
  artwork?: unknown;
};

type TelegramResponse<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
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

function isBotToken(value: string): boolean {
  return /^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(value);
}

function isChatId(value: string): boolean {
  return /^@[A-Za-z0-9_]{5,32}$/.test(value) || /^-?\d{5,24}$/.test(value);
}

async function telegramRequest<T>(
  botToken: string,
  method: string,
  body: BodyInit,
  headers?: HeadersInit,
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json()) as TelegramResponse<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description || `Telegram returned HTTP ${response.status}.`);
  }
  return payload.result as T;
}

function parseArtwork(dataUrl: string): { blob: Blob; extension: string } | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1];
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) return null;

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_ARTWORK_BYTES) return null;

  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return { blob: new Blob([buffer], { type: mimeType }), extension };
}

async function sendText(botToken: string, chatId: string, text: string) {
  return telegramRequest<{ message_id: number }>(
    botToken,
    "sendMessage",
    JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: false,
    }),
    { "Content-Type": "application/json" },
  );
}

async function sendArtwork(
  botToken: string,
  chatId: string,
  artwork: { blob: Blob; extension: string },
  caption: string,
) {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("photo", artwork.blob, `token-artwork.${artwork.extension}`);
  if (caption) form.set("caption", caption);
  return telegramRequest<{ message_id: number }>(botToken, "sendPhoto", form);
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
    return jsonError("Use a public channel username such as @channel or a numeric Telegram chat ID.", 400);
  }
  if (!text) {
    return jsonError("The Telegram post is empty.", 400);
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return jsonError(`Telegram text must be ${MAX_TEXT_LENGTH} characters or fewer.`, 400);
  }

  try {
    const artwork = artworkValue ? parseArtwork(artworkValue) : null;
    const messageIds: number[] = [];

    if (artworkValue && !artwork) {
      return jsonError("Artwork must be a PNG, JPG or WEBP image below 3 MB.", 400);
    }

    if (artwork && text.length <= MAX_CAPTION_LENGTH) {
      const result = await sendArtwork(botToken, chatId, artwork, text);
      messageIds.push(result.message_id);
    } else if (artwork) {
      const photoResult = await sendArtwork(botToken, chatId, artwork, "");
      const textResult = await sendText(botToken, chatId, text);
      messageIds.push(photoResult.message_id, textResult.message_id);
    } else {
      const result = await sendText(botToken, chatId, text);
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
