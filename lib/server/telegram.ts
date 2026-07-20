export const MAX_TELEGRAM_TEXT_LENGTH = 4096;
export const MAX_TELEGRAM_CAPTION_LENGTH = 1024;
export const MAX_TELEGRAM_ARTWORK_BYTES = 3_000_000;

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ParsedArtwork = {
  blob: Blob;
  extension: "png" | "jpg" | "webp";
};

export type TelegramResponse<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export function isBotToken(value: string): boolean {
  return /^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(value);
}

export function isChatId(value: string): boolean {
  return /^@[A-Za-z0-9_]{5,32}$/.test(value) || /^-?\d{5,24}$/.test(value);
}

export function parseArtwork(dataUrl: string): ParsedArtwork | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1];
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) return null;

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_TELEGRAM_ARTWORK_BYTES) {
    return null;
  }

  const extension: ParsedArtwork["extension"] =
    mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return { blob: new Blob([buffer], { type: mimeType }), extension };
}

export async function telegramRequest<T>(
  botToken: string,
  method: string,
  body: BodyInit,
  headers?: HeadersInit,
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
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

export async function sendText(
  botToken: string,
  chatId: string,
  text: string,
  fetchImpl: FetchLike = fetch,
) {
  return telegramRequest<{ message_id: number }>(
    botToken,
    "sendMessage",
    JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: false,
    }),
    { "Content-Type": "application/json" },
    fetchImpl,
  );
}

export async function sendArtwork(
  botToken: string,
  chatId: string,
  artwork: ParsedArtwork,
  caption: string,
  fetchImpl: FetchLike = fetch,
) {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("photo", artwork.blob, `token-artwork.${artwork.extension}`);
  if (caption) form.set("caption", caption);
  return telegramRequest<{ message_id: number }>(
    botToken,
    "sendPhoto",
    form,
    undefined,
    fetchImpl,
  );
}

export async function publishTelegramPost(
  input: {
    botToken: string;
    chatId: string;
    text: string;
    artwork: ParsedArtwork | null;
  },
  fetchImpl: FetchLike = fetch,
): Promise<number[]> {
  const messageIds: number[] = [];

  if (input.artwork && input.text.length <= MAX_TELEGRAM_CAPTION_LENGTH) {
    const result = await sendArtwork(
      input.botToken,
      input.chatId,
      input.artwork,
      input.text,
      fetchImpl,
    );
    messageIds.push(result.message_id);
  } else if (input.artwork) {
    const photoResult = await sendArtwork(
      input.botToken,
      input.chatId,
      input.artwork,
      "",
      fetchImpl,
    );
    const textResult = await sendText(
      input.botToken,
      input.chatId,
      input.text,
      fetchImpl,
    );
    messageIds.push(photoResult.message_id, textResult.message_id);
  } else {
    const result = await sendText(input.botToken, input.chatId, input.text, fetchImpl);
    messageIds.push(result.message_id);
  }

  return messageIds;
}
