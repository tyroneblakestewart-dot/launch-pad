import { describe, expect, it, vi } from "vitest";
import {
  consumeTelegramLinkCode,
  createSubscriptionTelegramLink,
  handleSubscriptionTelegramUpdate,
  isTelegramWebhookAuthorised,
  type TelegramLinkDatabaseClient,
} from "@/lib/server/subscription-telegram";

const WALLET = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-08-06T09:00:00.000Z");

function clientFor(options: { codeExists: boolean; subscriptionExists?: boolean }) {
  const statements: Array<{ sql: string; params?: unknown[] }> = [];
  let released = false;
  const client: TelegramLinkDatabaseClient = {
    query: (async (sql: string, params?: unknown[]) => {
      statements.push({ sql, params });
      if (sql.includes("FROM telegram_link_codes")) {
        return { rows: options.codeExists ? [{ wallet_address: WALLET }] : [] };
      }
      if (sql.includes("UPDATE subscriptions")) {
        return { rows: [], rowCount: options.subscriptionExists === false ? 0 : 1 };
      }
      return { rows: [], rowCount: 1 };
    }) as TelegramLinkDatabaseClient["query"],
    release() {
      released = true;
    },
  };
  return { client, statements, wasReleased: () => released };
}

describe("Telegram webhook authentication", () => {
  it("requires Telegram's secret-token header and fails closed when unset", () => {
    const authorised = new Request("https://hoodlums.dev/api/telegram/subscription-webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "correct-secret" },
    });
    expect(
      isTelegramWebhookAuthorised(authorised, {
        TELEGRAM_WEBHOOK_SECRET: "correct-secret",
      }),
    ).toBe(true);
    expect(
      isTelegramWebhookAuthorised(authorised, {
        TELEGRAM_WEBHOOK_SECRET: "wrong-secret",
      }),
    ).toBe(false);
    expect(isTelegramWebhookAuthorised(authorised, {})).toBe(false);
  });
});

describe("one-time Telegram link creation", () => {
  it("stores a short-lived wallet code and returns a bot deep link", async () => {
    const statements: Array<{ sql: string; params?: unknown[] }> = [];
    const link = await createSubscriptionTelegramLink({
      walletAddress: WALLET,
      now: NOW,
      environment: {
        DATABASE_URL: "postgres://example",
        TELEGRAM_BOT_USERNAME: "HoodlumsReminderBot",
      },
      makeCode: () => "link_test_code",
      query: async (sql, params) => {
        statements.push({ sql, params });
        return { rows: [] };
      },
    });

    expect(link).toBe("https://t.me/HoodlumsReminderBot?start=link_test_code");
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain("INSERT INTO telegram_link_codes");
    expect(statements[0].params?.[0]).toBe("link_test_code");
    expect(statements[0].params?.[1]).toBe(WALLET);
    expect((statements[0].params?.[2] as Date).toISOString()).toBe(
      "2026-08-06T09:30:00.000Z",
    );
  });

  it("does not expose a link when bot or database configuration is absent", async () => {
    await expect(
      createSubscriptionTelegramLink({
        walletAddress: WALLET,
        environment: {},
      }),
    ).resolves.toBeNull();
  });
});

describe("Telegram link consumption", () => {
  it("consumes the code once and ties Telegram identity to the paid wallet", async () => {
    const fixture = clientFor({ codeExists: true });
    const result = await consumeTelegramLinkCode({
      code: "link_test_code",
      telegramUserId: 123456,
      telegramChatId: 654321,
      telegramUsername: "crew_member",
      now: NOW,
      connect: async () => fixture.client,
    });

    expect(result).toEqual({ linked: true, walletAddress: WALLET });
    expect(
      fixture.statements.some((statement) =>
        statement.sql.includes("UPDATE subscriptions") &&
        statement.params?.includes(123456) &&
        statement.params?.includes(654321),
      ),
    ).toBe(true);
    expect(
      fixture.statements.some((statement) =>
        statement.sql.includes("UPDATE telegram_link_codes SET used_at"),
      ),
    ).toBe(true);
    expect(
      fixture.statements.some((statement) => statement.sql === "COMMIT"),
    ).toBe(true);
    expect(fixture.wasReleased()).toBe(true);
  });

  it("rejects invalid, expired, used or non-subscriber codes without linking", async () => {
    const missing = clientFor({ codeExists: false });
    await expect(
      consumeTelegramLinkCode({
        code: "link_test_code",
        telegramUserId: 1,
        telegramChatId: 2,
        now: NOW,
        connect: async () => missing.client,
      }),
    ).resolves.toEqual({ linked: false, walletAddress: null });
    expect(
      missing.statements.some((statement) => statement.sql.includes("UPDATE subscriptions")),
    ).toBe(false);

    const noSubscription = clientFor({ codeExists: true, subscriptionExists: false });
    await expect(
      consumeTelegramLinkCode({
        code: "link_test_code",
        telegramUserId: 1,
        telegramChatId: 2,
        now: NOW,
        connect: async () => noSubscription.client,
      }),
    ).resolves.toEqual({ linked: false, walletAddress: null });
    expect(
      noSubscription.statements.some((statement) => statement.sql === "ROLLBACK"),
    ).toBe(true);
  });

  it("handles the Telegram /start update and sends a confirmation", async () => {
    const fixture = clientFor({ codeExists: true });
    const send = vi.fn(async () => ({ message_id: 77 }));
    const result = await handleSubscriptionTelegramUpdate(
      {
        message: {
          text: "/start link_test_code",
          chat: { id: 654321 },
          from: { id: 123456, username: "crew_member" },
        },
      },
      {
        botToken: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
        now: NOW,
        connect: async () => fixture.client,
        send,
      },
    );

    expect(result).toEqual({ handled: true, linked: true });
    expect(send).toHaveBeenCalledWith(
      "123456:abcdefghijklmnopqrstuvwxyzABCDE",
      "654321",
      expect.stringContaining("Telegram renewal reminders are linked"),
    );
  });
});
