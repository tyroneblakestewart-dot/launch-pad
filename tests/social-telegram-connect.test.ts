import { afterEach, describe, expect, it } from "vitest";
import { isTelegramConnectConfigured, resetTelegramBotUserIdCacheForTests, verifyTelegramChannelAdmin } from "@/lib/server/social-telegram-connect";

const ENV = { TELEGRAM_BOT_TOKEN: "12345:test-bot-token-aaaaaaaaaaaaaaaaaaaa" };

function telegramFetch(handlers: Record<string, () => { ok: boolean; result?: unknown; description?: string }>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const href = url.toString();
    const method = href.split("/").pop() || "";
    const handler = handlers[method];
    if (!handler) throw new Error(`Unexpected Telegram method called: ${method}`);
    const payload = handler();
    return new Response(JSON.stringify(payload), { status: payload.ok ? 200 : 400 });
  }) as typeof fetch;
}

afterEach(() => {
  resetTelegramBotUserIdCacheForTests();
});

describe("isTelegramConnectConfigured", () => {
  it("is false when TELEGRAM_BOT_TOKEN is unset — fails closed", () => {
    expect(isTelegramConnectConfigured({})).toBe(false);
  });

  it("is true when TELEGRAM_BOT_TOKEN is set", () => {
    expect(isTelegramConnectConfigured(ENV)).toBe(true);
  });
});

describe("verifyTelegramChannelAdmin", () => {
  it("is not_configured when TELEGRAM_BOT_TOKEN is unset", async () => {
    const result = await verifyTelegramChannelAdmin("@channel", {});
    expect(result).toEqual({ status: "not_configured" });
  });

  it("is invalid_chat_id for a malformed channel value", async () => {
    const result = await verifyTelegramChannelAdmin("not a channel", ENV);
    expect(result).toEqual({ status: "invalid_chat_id" });
  });

  it("is chat_not_found when Telegram can't find the channel", async () => {
    const fetchImpl = telegramFetch({
      getChat: () => ({ ok: false, description: "Bad Request: chat not found" }),
    });
    const result = await verifyTelegramChannelAdmin("@missingchannel", ENV, { fetchImpl });
    expect(result).toEqual({ status: "chat_not_found" });
  });

  it("is not_admin when the bot is a member but not an admin", async () => {
    const fetchImpl = telegramFetch({
      getChat: () => ({ ok: true, result: { id: -100, title: "Hoodlums Announcements", type: "channel" } }),
      getMe: () => ({ ok: true, result: { id: 777 } }),
      getChatMember: () => ({ ok: true, result: { status: "member" } }),
    });
    const result = await verifyTelegramChannelAdmin("@hoodlums", ENV, { fetchImpl, botUsername: "HoodlumsBot" });
    expect(result.status).toBe("not_admin");
    if (result.status === "not_admin") expect(result.message).toContain("@HoodlumsBot");
  });

  it("is ok when the bot is an administrator", async () => {
    const fetchImpl = telegramFetch({
      getChat: () => ({ ok: true, result: { id: -100, title: "Hoodlums Announcements", type: "channel" } }),
      getMe: () => ({ ok: true, result: { id: 777 } }),
      getChatMember: () => ({ ok: true, result: { status: "administrator" } }),
    });
    const result = await verifyTelegramChannelAdmin("@hoodlums", ENV, { fetchImpl });
    expect(result).toEqual({ status: "ok", chatId: "@hoodlums", displayName: "Hoodlums Announcements" });
  });

  it("is ok when the bot is the channel creator", async () => {
    const fetchImpl = telegramFetch({
      getChat: () => ({ ok: true, result: { id: -100, title: "Owned Channel", type: "channel" } }),
      getMe: () => ({ ok: true, result: { id: 777 } }),
      getChatMember: () => ({ ok: true, result: { status: "creator" } }),
    });
    const result = await verifyTelegramChannelAdmin("-1009999", ENV, { fetchImpl });
    expect(result.status).toBe("ok");
  });

  it("is not_admin (not api_error) when getChatMember itself fails, with a helpful message", async () => {
    const fetchImpl = telegramFetch({
      getChat: () => ({ ok: true, result: { id: -100, title: "Hoodlums Announcements", type: "channel" } }),
      getMe: () => ({ ok: true, result: { id: 777 } }),
      getChatMember: () => ({ ok: false, description: "Bad Request: user not found" }),
    });
    const result = await verifyTelegramChannelAdmin("@hoodlums", ENV, { fetchImpl, botUsername: "HoodlumsBot" });
    expect(result.status).toBe("not_admin");
  });
});
