import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/social/telegram/route";
import {
  MAX_TELEGRAM_ARTWORK_BYTES,
  MAX_TELEGRAM_CAPTION_LENGTH,
  MAX_TELEGRAM_TEXT_LENGTH,
  isBotToken,
  isChatId,
  parseTelegramArtwork,
  sendTelegramArtwork,
  sendTelegramText,
  telegramRequest,
  validateTelegramRequest,
} from "@/lib/server/telegram";

const VALID_TOKEN = `12345:${"A".repeat(20)}`;
const VALID_CHAT = "@hoodlums";
const VALID_ARTWORK = `data:image/png;base64,${Buffer.from("test-image").toString("base64")}`;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/social/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function telegramResponse(messageId: number, status = 200) {
  return new Response(JSON.stringify({ ok: true, result: { message_id: messageId } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Telegram helpers", () => {
  it("validates BotFather token boundaries", () => {
    expect(isBotToken(VALID_TOKEN)).toBe(true);
    expect(isBotToken(`${"1".repeat(15)}:${"a".repeat(20)}`)).toBe(true);
    expect(isBotToken(`1234:${"a".repeat(20)}`)).toBe(false);
    expect(isBotToken(`${"1".repeat(16)}:${"a".repeat(20)}`)).toBe(false);
    expect(isBotToken(`12345:${"a".repeat(19)}`)).toBe(false);
    expect(isBotToken("not-a-token")).toBe(false);
  });

  it("validates public usernames and numeric Telegram chat IDs", () => {
    expect(isChatId("@abcde")).toBe(true);
    expect(isChatId(`@${"a".repeat(32)}`)).toBe(true);
    expect(isChatId("@abcd")).toBe(false);
    expect(isChatId(`@${"a".repeat(33)}`)).toBe(false);
    expect(isChatId("12345")).toBe(true);
    expect(isChatId("-1001234567890")).toBe(true);
    expect(isChatId("1234")).toBe(false);
    expect(isChatId("+12345")).toBe(false);
  });

  it("parses supported artwork types and assigns the correct file extension", () => {
    const encoded = Buffer.from("image-bytes").toString("base64");
    expect(parseTelegramArtwork(`data:image/png;base64,${encoded}`)?.extension).toBe("png");
    expect(parseTelegramArtwork(`data:image/jpeg;base64,${encoded}`)?.extension).toBe("jpg");
    expect(parseTelegramArtwork(`data:image/webp;base64,${encoded}`)?.extension).toBe("webp");
    expect(parseTelegramArtwork(`data:image/gif;base64,${encoded}`)).toBeNull();
    expect(parseTelegramArtwork("data:image/png;base64,")).toBeNull();
    expect(parseTelegramArtwork("not-a-data-url")).toBeNull();
  });

  it("rejects decoded artwork above the 3 MB safety limit", () => {
    const exact = Buffer.alloc(MAX_TELEGRAM_ARTWORK_BYTES, 1).toString("base64");
    const oversized = Buffer.alloc(MAX_TELEGRAM_ARTWORK_BYTES + 1, 1).toString("base64");
    expect(parseTelegramArtwork(`data:image/png;base64,${exact}`)?.blob.size).toBe(
      MAX_TELEGRAM_ARTWORK_BYTES,
    );
    expect(parseTelegramArtwork(`data:image/png;base64,${oversized}`)).toBeNull();
  });

  it("normalizes valid publish data and accepts the maximum text length", () => {
    const text = "x".repeat(MAX_TELEGRAM_TEXT_LENGTH);
    const result = validateTelegramRequest({
      botToken: ` ${VALID_TOKEN} `,
      chatId: ` ${VALID_CHAT} `,
      text: ` ${text} `,
      artwork: ` ${VALID_ARTWORK} `,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.botToken).toBe(VALID_TOKEN);
    expect(result.value.chatId).toBe(VALID_CHAT);
    expect(result.value.text).toBe(text);
    expect(result.value.artwork?.extension).toBe("png");
  });

  it("returns the correct validation error for every invalid field", () => {
    expect(validateTelegramRequest(null)).toEqual({
      ok: false,
      error: "The BotFather token format is not valid.",
    });
    expect(validateTelegramRequest({ botToken: VALID_TOKEN, chatId: "bad", text: "post" })).toEqual({
      ok: false,
      error: "Use a public channel username such as @channel or a numeric Telegram chat ID.",
    });
    expect(validateTelegramRequest({ botToken: VALID_TOKEN, chatId: VALID_CHAT, text: "   " })).toEqual({
      ok: false,
      error: "The Telegram post is empty.",
    });
    expect(
      validateTelegramRequest({
        botToken: VALID_TOKEN,
        chatId: VALID_CHAT,
        text: "x".repeat(MAX_TELEGRAM_TEXT_LENGTH + 1),
      }),
    ).toEqual({
      ok: false,
      error: `Telegram text must be ${MAX_TELEGRAM_TEXT_LENGTH} characters or fewer.`,
    });
    expect(
      validateTelegramRequest({
        botToken: VALID_TOKEN,
        chatId: VALID_CHAT,
        text: "post",
        artwork: "data:image/gif;base64,AAAA",
      }),
    ).toEqual({
      ok: false,
      error: "Artwork must be a PNG, JPG or WEBP image below 3 MB.",
    });
  });

  it("performs a successful Telegram API request with no-store and a timeout signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(telegramResponse(44));
    const result = await telegramRequest<{ message_id: number }>(
      fetchMock,
      VALID_TOKEN,
      "sendMessage",
      "body",
      { "Content-Type": "application/json" },
    );
    expect(result).toEqual({ message_id: 44 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${VALID_TOKEN}/sendMessage`);
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports Telegram error descriptions, HTTP fallbacks, invalid JSON and missing results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, description: "chat not found" }), { status: 400 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 500 }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(telegramRequest(fetchMock, VALID_TOKEN, "sendMessage", "body")).rejects.toThrow(
      "chat not found",
    );
    await expect(telegramRequest(fetchMock, VALID_TOKEN, "sendMessage", "body")).rejects.toThrow(
      "Telegram returned HTTP 500.",
    );
    await expect(telegramRequest(fetchMock, VALID_TOKEN, "sendMessage", "body")).rejects.toThrow(
      "Telegram returned invalid JSON with HTTP 200.",
    );
    await expect(telegramRequest(fetchMock, VALID_TOKEN, "sendMessage", "body")).rejects.toThrow(
      "Telegram returned no result.",
    );
  });

  it("builds text and artwork requests correctly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(telegramResponse(1))
      .mockResolvedValueOnce(telegramResponse(2));

    await sendTelegramText(fetchMock, VALID_TOKEN, VALID_CHAT, "Hello crew");
    const [textUrl, textInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(textUrl).toEndWith("/sendMessage");
    expect(JSON.parse(String(textInit.body))).toEqual({
      chat_id: VALID_CHAT,
      text: "Hello crew",
      disable_web_page_preview: false,
    });
    expect(textInit.headers).toEqual({ "Content-Type": "application/json" });

    const artwork = parseTelegramArtwork(VALID_ARTWORK);
    expect(artwork).not.toBeNull();
    if (!artwork) return;
    await sendTelegramArtwork(fetchMock, VALID_TOKEN, VALID_CHAT, artwork, "Caption");
    const [photoUrl, photoInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(photoUrl).toEndWith("/sendPhoto");
    expect(photoInit.body).toBeInstanceOf(FormData);
    const form = photoInit.body as FormData;
    expect(form.get("chat_id")).toBe(VALID_CHAT);
    expect(form.get("caption")).toBe("Caption");
    const photo = form.get("photo");
    expect(photo).toBeInstanceOf(Blob);
    expect((photo as File).name).toBe("token-artwork.png");
  });
});

describe("POST /api/social/telegram", () => {
  it("rejects invalid JSON with status 400", async () => {
    const response = await POST(makeRequest("{"));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await json(response)).toEqual({
      ok: false,
      error: "The Telegram request body was not valid JSON.",
    });
  });

  it("rejects invalid credentials, chat IDs, text and artwork without network calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const cases: Array<[unknown, string]> = [
      [
        { botToken: "bad", chatId: VALID_CHAT, text: "post" },
        "The BotFather token format is not valid.",
      ],
      [
        { botToken: VALID_TOKEN, chatId: "bad", text: "post" },
        "Use a public channel username such as @channel or a numeric Telegram chat ID.",
      ],
      [
        { botToken: VALID_TOKEN, chatId: VALID_CHAT, text: "" },
        "The Telegram post is empty.",
      ],
      [
        {
          botToken: VALID_TOKEN,
          chatId: VALID_CHAT,
          text: "x".repeat(MAX_TELEGRAM_TEXT_LENGTH + 1),
        },
        `Telegram text must be ${MAX_TELEGRAM_TEXT_LENGTH} characters or fewer.`,
      ],
      [
        {
          botToken: VALID_TOKEN,
          chatId: VALID_CHAT,
          text: "post",
          artwork: "data:image/gif;base64,AAAA",
        },
        "Artwork must be a PNG, JPG or WEBP image below 3 MB.",
      ],
    ];

    for (const [body, error] of cases) {
      const response = await POST(makeRequest(body));
      expect(response.status).toBe(400);
      expect(await json(response)).toEqual({ ok: false, error });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("publishes a text-only post using a fully mocked Telegram response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(telegramResponse(101));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      makeRequest({ botToken: VALID_TOKEN, chatId: VALID_CHAT, text: "Launch update" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await json(response)).toEqual({ ok: true, messageIds: [101] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toEndWith("/sendMessage");
  });

  it("publishes artwork with an exact maximum-length caption in one request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(telegramResponse(202));
    vi.stubGlobal("fetch", fetchMock);
    const caption = "x".repeat(MAX_TELEGRAM_CAPTION_LENGTH);

    const response = await POST(
      makeRequest({
        botToken: VALID_TOKEN,
        chatId: VALID_CHAT,
        text: caption,
        artwork: VALID_ARTWORK,
      }),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true, messageIds: [202] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toEndWith("/sendPhoto");
    const form = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(form.get("caption")).toBe(caption);
  });

  it("splits artwork and text when the caption limit is exceeded", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(telegramResponse(301))
      .mockResolvedValueOnce(telegramResponse(302));
    vi.stubGlobal("fetch", fetchMock);
    const longCaption = "x".repeat(MAX_TELEGRAM_CAPTION_LENGTH + 1);

    const response = await POST(
      makeRequest({
        botToken: VALID_TOKEN,
        chatId: VALID_CHAT,
        text: longCaption,
        artwork: VALID_ARTWORK,
      }),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true, messageIds: [301, 302] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toEndWith("/sendPhoto");
    expect(String(fetchMock.mock.calls[1][0])).toEndWith("/sendMessage");
    const photoForm = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(photoForm.get("caption")).toBeNull();
    const textBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(textBody.text).toBe(longCaption);
  });

  it("returns status 502 with the upstream error and never exposes stored real data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, description: "bot was blocked" }), {
          status: 403,
        }),
      ),
    );

    const response = await POST(
      makeRequest({ botToken: VALID_TOKEN, chatId: VALID_CHAT, text: "Launch update" }),
    );
    expect(response.status).toBe(502);
    expect(await json(response)).toEqual({ ok: false, error: "bot was blocked" });
  });

  it("returns a safe 502 for network exceptions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection reset")));
    const response = await POST(
      makeRequest({ botToken: VALID_TOKEN, chatId: VALID_CHAT, text: "Launch update" }),
    );
    expect(response.status).toBe(502);
    expect(await json(response)).toEqual({ ok: false, error: "connection reset" });
  });
});
