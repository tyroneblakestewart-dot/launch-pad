import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/social/telegram/route";
import {
  MAX_TELEGRAM_ARTWORK_BYTES,
  MAX_TELEGRAM_CAPTION_LENGTH,
  MAX_TELEGRAM_TEXT_LENGTH,
  isBotToken,
  isChatId,
  parseArtwork,
  publishTelegramPost,
  sendArtwork,
  sendText,
  telegramRequest,
} from "@/lib/server/telegram";

const BOT_TOKEN = `123456:${"A".repeat(24)}`;
const CHAT_ID = "@hoodlums_test";
const VALID_ARTWORK = `data:image/png;base64,${Buffer.from("fake-image").toString("base64")}`;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/social/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function telegramSuccess(messageId: number): Response {
  return new Response(JSON.stringify({ ok: true, result: { message_id: messageId } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function responseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Telegram server functions", () => {
  it("validates BotFather tokens at the supported boundaries", () => {
    expect(isBotToken(BOT_TOKEN)).toBe(true);
    expect(isBotToken(`12345:${"a".repeat(20)}`)).toBe(true);
    expect(isBotToken(`1234:${"a".repeat(20)}`)).toBe(false);
    expect(isBotToken(`12345:${"a".repeat(19)}`)).toBe(false);
    expect(isBotToken("not-a-token")).toBe(false);
  });

  it("accepts public usernames and numeric chat IDs only", () => {
    expect(isChatId("@hoodlums_test")).toBe(true);
    expect(isChatId("-1001234567890")).toBe(true);
    expect(isChatId("12345")).toBe(true);
    expect(isChatId("@bad")).toBe(false);
    expect(isChatId("https://t.me/hoodlums")).toBe(false);
  });

  it("parses supported artwork and rejects malformed, empty and oversized images", () => {
    const artwork = parseArtwork(VALID_ARTWORK);
    expect(artwork?.extension).toBe("png");
    expect(artwork?.blob.type).toBe("image/png");
    expect(artwork?.blob.size).toBeGreaterThan(0);

    expect(parseArtwork("data:image/gif;base64,AAAA")).toBeNull();
    expect(parseArtwork("data:image/png;base64,")).toBeNull();
    expect(parseArtwork("not-a-data-url")).toBeNull();

    const oversized = `data:image/jpeg;base64,${Buffer.alloc(
      MAX_TELEGRAM_ARTWORK_BYTES + 1,
      1,
    ).toString("base64")}`;
    expect(parseArtwork(oversized)).toBeNull();
  });

  it("returns a Telegram result and sends no-store requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(telegramSuccess(7));
    const result = await telegramRequest<{ message_id: number }>(
      BOT_TOKEN,
      "sendMessage",
      "{}",
      { "Content-Type": "application/json" },
      fetchMock,
    );

    expect(result).toEqual({ message_id: 7 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
  });

  it("throws the Telegram description for HTTP and API-level failures", async () => {
    const httpFailure = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: false, description: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      );
    await expect(
      telegramRequest(BOT_TOKEN, "sendMessage", "{}", undefined, httpFailure),
    ).rejects.toThrow("Forbidden");

    const apiFailure = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: false, description: "Bad Request" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    await expect(
      telegramRequest(BOT_TOKEN, "sendMessage", "{}", undefined, apiFailure),
    ).rejects.toThrow("Bad Request");
  });

  it("builds the text request correctly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(telegramSuccess(11));
    const result = await sendText(BOT_TOKEN, CHAT_ID, "Launch ready", fetchMock);

    expect(result.message_id).toBe(11);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      chat_id: CHAT_ID,
      text: "Launch ready",
      disable_web_page_preview: false,
    });
  });

  it("builds a multipart artwork request with an optional caption", async () => {
    const artwork = parseArtwork(VALID_ARTWORK);
    expect(artwork).not.toBeNull();
    const fetchMock = vi.fn().mockResolvedValue(telegramSuccess(12));

    await sendArtwork(BOT_TOKEN, CHAT_ID, artwork!, "Caption", fetchMock);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("chat_id")).toBe(CHAT_ID);
    expect(form.get("caption")).toBe("Caption");
    expect(form.get("photo")).toBeTruthy();
  });

  it("publishes text, captioned artwork, and split long-caption posts", async () => {
    const noArtworkFetch = vi.fn().mockResolvedValue(telegramSuccess(21));
    await expect(
      publishTelegramPost(
        { botToken: BOT_TOKEN, chatId: CHAT_ID, text: "Text only", artwork: null },
        noArtworkFetch,
      ),
    ).resolves.toEqual([21]);
    expect(String(noArtworkFetch.mock.calls[0][0])).toContain("sendMessage");

    const artwork = parseArtwork(VALID_ARTWORK)!;
    const captionFetch = vi.fn().mockResolvedValue(telegramSuccess(22));
    await expect(
      publishTelegramPost(
        { botToken: BOT_TOKEN, chatId: CHAT_ID, text: "Caption", artwork },
        captionFetch,
      ),
    ).resolves.toEqual([22]);
    expect(String(captionFetch.mock.calls[0][0])).toContain("sendPhoto");

    const splitFetch = vi
      .fn()
      .mockResolvedValueOnce(telegramSuccess(23))
      .mockResolvedValueOnce(telegramSuccess(24));
    await expect(
      publishTelegramPost(
        {
          botToken: BOT_TOKEN,
          chatId: CHAT_ID,
          text: "L".repeat(MAX_TELEGRAM_CAPTION_LENGTH + 1),
          artwork,
        },
        splitFetch,
      ),
    ).resolves.toEqual([23, 24]);
    expect(String(splitFetch.mock.calls[0][0])).toContain("sendPhoto");
    expect(String(splitFetch.mock.calls[1][0])).toContain("sendMessage");
  });
});

describe("POST /api/social/telegram", () => {
  it("rejects invalid JSON", async () => {
    const request = new Request("http://localhost/api/social/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toEqual({
      ok: false,
      error: "The Telegram request body was not valid JSON.",
    });
  });

  it("rejects missing or invalid Telegram credentials", async () => {
    const missingToken = await POST(makeRequest({ chatId: CHAT_ID, text: "Hello" }));
    expect(missingToken.status).toBe(400);
    expect((await responseJson<{ error: string }>(missingToken)).error).toContain("BotFather");

    const invalidChat = await POST(
      makeRequest({ botToken: BOT_TOKEN, chatId: "bad", text: "Hello" }),
    );
    expect(invalidChat.status).toBe(400);
    expect((await responseJson<{ error: string }>(invalidChat)).error).toContain("chat ID");
  });

  it("rejects empty and over-limit posts", async () => {
    const empty = await POST(makeRequest({ botToken: BOT_TOKEN, chatId: CHAT_ID, text: "  " }));
    expect(empty.status).toBe(400);
    expect((await responseJson<{ error: string }>(empty)).error).toContain("empty");

    const tooLong = await POST(
      makeRequest({
        botToken: BOT_TOKEN,
        chatId: CHAT_ID,
        text: "x".repeat(MAX_TELEGRAM_TEXT_LENGTH + 1),
      }),
    );
    expect(tooLong.status).toBe(400);
    expect((await responseJson<{ error: string }>(tooLong)).error).toContain("4096");
  });

  it("rejects malformed or oversized artwork", async () => {
    const malformed = await POST(
      makeRequest({
        botToken: BOT_TOKEN,
        chatId: CHAT_ID,
        text: "Hello",
        artwork: "data:image/gif;base64,AAAA",
      }),
    );
    expect(malformed.status).toBe(400);

    const oversized = `data:image/png;base64,${Buffer.alloc(
      MAX_TELEGRAM_ARTWORK_BYTES + 1,
      1,
    ).toString("base64")}`;
    const tooLarge = await POST(
      makeRequest({ botToken: BOT_TOKEN, chatId: CHAT_ID, text: "Hello", artwork: oversized }),
    );
    expect(tooLarge.status).toBe(400);
  });

  it("publishes a valid text-only post", async () => {
    const fetchMock = vi.fn().mockResolvedValue(telegramSuccess(31));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      makeRequest({ botToken: BOT_TOKEN, chatId: CHAT_ID, text: "  Launch ready  " }),
    );
    const body = await responseJson<{ ok: boolean; messageIds: number[] }>(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({ ok: true, messageIds: [31] });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).text).toBe("Launch ready");
  });

  it("publishes artwork as a caption when the post fits Telegram's caption limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(telegramSuccess(32));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      makeRequest({
        botToken: BOT_TOKEN,
        chatId: CHAT_ID,
        text: "Artwork launch",
        artwork: VALID_ARTWORK,
      }),
    );

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({ ok: true, messageIds: [32] });
    expect(String(fetchMock.mock.calls[0][0])).toContain("sendPhoto");
  });

  it("splits artwork and text when the caption is too long", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(telegramSuccess(33))
      .mockResolvedValueOnce(telegramSuccess(34));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      makeRequest({
        botToken: BOT_TOKEN,
        chatId: CHAT_ID,
        text: "L".repeat(MAX_TELEGRAM_CAPTION_LENGTH + 1),
        artwork: VALID_ARTWORK,
      }),
    );

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({ ok: true, messageIds: [33, 34] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 502 when Telegram rejects or cannot receive the post", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, description: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const rejected = await POST(
      makeRequest({ botToken: BOT_TOKEN, chatId: CHAT_ID, text: "Hello" }),
    );
    expect(rejected.status).toBe(502);
    expect((await responseJson<{ error: string }>(rejected)).error).toBe("Forbidden");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const unavailable = await POST(
      makeRequest({ botToken: BOT_TOKEN, chatId: CHAT_ID, text: "Hello" }),
    );
    expect(unavailable.status).toBe(502);
    expect((await responseJson<{ error: string }>(unavailable)).error).toBe("network down");
  });
});
