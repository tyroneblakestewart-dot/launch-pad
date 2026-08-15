import { isChatId, telegramRequest } from "@/lib/server/telegram";

// Telegram "real connect flow" for Social Studio (issue #335): confirms the
// platform bot (TELEGRAM_BOT_TOKEN) actually has posting rights in the
// channel the user names, instead of trusting a bare text field. Scheduled
// sends still go through lib/server/telegram.ts's existing publish path —
// this module only answers "can the bot post here right now".

export function isTelegramConnectConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean((env.TELEGRAM_BOT_TOKEN || "").trim());
}

type TelegramChat = { id: number; title?: string; username?: string; type: string };
type TelegramChatMember = { status: string };

export type VerifyTelegramChannelResult =
  | { status: "ok"; chatId: string; displayName: string }
  | { status: "not_configured" }
  | { status: "invalid_chat_id" }
  | { status: "chat_not_found" }
  | { status: "not_admin"; message: string }
  | { status: "api_error"; message: string };

export type VerifyTelegramChannelDeps = {
  fetchImpl?: Parameters<typeof telegramRequest>[4];
  botUsername?: string;
};

/**
 * Verifies the platform bot is an admin with posting rights in the given
 * channel before a connection is ever stored. Never throws — every failure
 * mode resolves to a discriminated result so the connect route can show
 * exactly what's missing (e.g. "add @HoodlumsBot as an admin first").
 */
export async function verifyTelegramChannelAdmin(
  chatIdInput: string,
  env: Record<string, string | undefined> = process.env,
  deps: VerifyTelegramChannelDeps = {},
): Promise<VerifyTelegramChannelResult> {
  const botToken = (env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!botToken) return { status: "not_configured" };

  const chatId = chatIdInput.trim();
  if (!isChatId(chatId)) return { status: "invalid_chat_id" };

  let chat: TelegramChat;
  try {
    chat = await telegramRequest<TelegramChat>(
      botToken,
      "getChat",
      JSON.stringify({ chat_id: chatId }),
      { "Content-Type": "application/json" },
      deps.fetchImpl,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/chat not found/i.test(message)) return { status: "chat_not_found" };
    return { status: "api_error", message: message.slice(0, 500) || "Could not reach Telegram." };
  }

  const botUsername = (deps.botUsername ?? env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  let member: TelegramChatMember;
  try {
    member = await telegramRequest<TelegramChatMember>(
      botToken,
      "getChatMember",
      JSON.stringify({ chat_id: chatId, user_id: await resolveBotUserId(botToken, deps.fetchImpl) }),
      { "Content-Type": "application/json" },
      deps.fetchImpl,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not check the bot's membership.";
    return {
      status: "not_admin",
      message: botUsername
        ? `Add @${botUsername} as an admin with posting rights first. (${message.slice(0, 200)})`
        : `Add the Hoodlums Telegram bot as an admin with posting rights first. (${message.slice(0, 200)})`,
    };
  }

  const isAdmin = member.status === "administrator" || member.status === "creator";
  if (!isAdmin) {
    return {
      status: "not_admin",
      message: botUsername
        ? `Add @${botUsername} as an admin with posting rights first.`
        : "Add the Hoodlums Telegram bot as an admin with posting rights first.",
    };
  }

  const displayName = chat.title || chat.username || chatId;
  return { status: "ok", chatId, displayName };
}

let cachedBotUserId: number | null = null;
let cachedBotToken = "";

async function resolveBotUserId(botToken: string, fetchImpl?: Parameters<typeof telegramRequest>[4]): Promise<number> {
  if (cachedBotUserId !== null && cachedBotToken === botToken) return cachedBotUserId;
  const me = await telegramRequest<{ id: number }>(botToken, "getMe", JSON.stringify({}), { "Content-Type": "application/json" }, fetchImpl);
  cachedBotUserId = me.id;
  cachedBotToken = botToken;
  return me.id;
}

export function resetTelegramBotUserIdCacheForTests(): void {
  cachedBotUserId = null;
  cachedBotToken = "";
}
