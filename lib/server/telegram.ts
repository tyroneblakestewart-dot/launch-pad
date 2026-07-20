export const MAX_TELEGRAM_TEXT_LENGTH = 4096;
export const MAX_TELEGRAM_CAPTION_LENGTH = 1024;
export const MAX_TELEGRAM_ARTWORK_BYTES = 3_000_000;

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type TelegramRequestBody = {
  botToken?: unknown;
  chatId?: unknown;
  text?: unknown;
  artwork?: unknown;
};

export type TelegramApiResponse<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export type ParsedTelegramArtwork = {
  blob: Blob;
  extension: string;
};

export type ValidatedTelegramRequest = {
  botToken: string;
  chatId: string;
  text: string;
  artwork: ParsedTelegramArtwork | null;
};

export type TelegramValidationResult =
  | { ok: true; value: ValidatedTelegramRequest }
  | { ok: false; error: string };

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function isBotToken(value: string): boolean {
  return /^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(value);
}

export function isChatId(value: string): boolean {
  return /^@[A-Za-z0-9_]{5,32}$/.test(value) || /^-?\d{5,24}$/.test(value);
}

export function parseTelegramArtwork(dataUrl: string): ParsedTelegramArtwork | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;

  const mimeType = match[1];
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) return null;

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_TELEGRAM_ARTWORK_BYTES) return null;

  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return { blob: new Blob([buffer], { type: mimeType }), extension };
}

export function validateTelegramRequest(value: unknown): TelegramValidationResult {
  const body = value && typeof value === "object" && !Array.isArray(value)
    ? (value as TelegramRequestBody)
    : {};

  const botToken = typeof body.botToken === "string" ? body.botToken.trim() : "";
  const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const artworkValue = typeof body.artwork === "string" ? body.artwork.trim() : "";

  if (!isBotToken(botToken)) {
    return { ok: false, error: "The BotFather token format is not valid." };
  }
  if (!isChatId(chatId)) {
    return {
      ok: false,
      error: "Use a public channel username such as @channel or a numeric Telegram chat ID.",
    };
  }
  if (!text) {
    return { ok: false, error: "The Telegram post is empty." };
  }
  if (text.length > MAX_TELEGRAM_TEXT_LENGTH) {
    return {
      ok: false,
      error: `Telegram text must be ${MAX_TELEGRAM_TEXT_LENGTH} characters or fewer.`,
    };
  }

  const artwork = artworkValue ? parseTelegramArtwork(artworkValue) : null;
  if (artworkValue && !artwork) {
    return { ok: false, error: "Artwork must be a PNG, JPG or WEBP image below 3 MB." };
  }

  return { ok: true, value: { botToken, chatId, text, artwork } };
}

export async function telegramRequest<T>(
  fetchImpl: FetchLike,
  botToken: string,
  method: string,
  body: BodyInit,
  headers?: HeadersInit,
): Promise<T> {
  const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  let payload: TelegramApiResponse<T>;
  try {
    payload = (await response.json()) as TelegramApiResponse<T>;
  } catch {
    throw new Error(`Telegram returned invalid JSON with HTTP ${response.status}.`);
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.description || `Telegram returned HTTP ${response.status}.`);
  }
  if (payload.result === undefined) {
    throw new Error("Telegram returned no result.");
  }
  return payload.result;
}

export async function sendTelegramText(
  fetchImpl: FetchLike,
  botToken: string,
  chatId: string,
  text: string,
) {
  return telegramRequest<{ message_id: number }>(
    fetchImpl,
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

export async function sendTelegramArtwork(
  fetchImpl: FetchLike,
  botToken: string,
  chatId: string,
  artwork: ParsedTelegramArtwork,
  caption: string,
) {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("photo", artwork.blob, `token-artwork.${artwork.extension}`);
  if (caption) form.set("caption", caption);
  return telegramRequest<{ message_id: number }>(fetchImpl, botToken, "sendPhoto", form);
}
