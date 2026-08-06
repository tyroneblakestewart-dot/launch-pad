import { describe, expect, it, vi } from "vitest";
import {
  runSubscriptionLifecycle,
  type SubscriptionQuery,
} from "@/lib/server/subscription-lifecycle";

const NOW = new Date("2026-08-06T09:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
const WALLET_A = "0x1111111111111111111111111111111111111111";
const WALLET_B = "0x2222222222222222222222222222222222222222";
const WALLET_C = "0x3333333333333333333333333333333333333333";

type Statement = { sql: string; params?: unknown[] };

function queryFor(input: {
  subscriptions: Array<Record<string, unknown>>;
  claimReminder?: boolean;
  statements: Statement[];
}): SubscriptionQuery {
  let reminderId = 0;
  return (async (sql: string, params?: unknown[]) => {
    input.statements.push({ sql, params });
    if (sql.includes("INSERT INTO subscription_lifecycle_runs")) {
      return { rows: [{ id: "run-1" }] };
    }
    if (sql.includes("FROM subscriptions") && sql.includes("ORDER BY wallet_address")) {
      return { rows: input.subscriptions };
    }
    if (sql.includes("UPDATE subscriptions")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO subscription_reminder_events")) {
      if (input.claimReminder === false) return { rows: [] };
      reminderId += 1;
      return { rows: [{ id: `reminder-${reminderId}` }] };
    }
    return { rows: [], rowCount: 1 };
  }) as SubscriptionQuery;
}

describe("daily subscription lifecycle runner", () => {
  it("updates lifecycle states and sends day-27/day-32 Telegram reminders once", async () => {
    const statements: Statement[] = [];
    const send = vi.fn(async (_token: string, _chatId: string, _text: string) => ({
      message_id: 900 + send.mock.calls.length,
    }));
    const query = queryFor({
      statements,
      subscriptions: [
        {
          wallet_address: WALLET_A,
          tier: "pro",
          status: "active",
          paid_from: NOW,
          paid_until: new Date(NOW.getTime() + 5 * DAY_MS),
          expires_at: null,
          telegram_chat_id: 101,
        },
        {
          wallet_address: WALLET_B,
          tier: "pro_bundle",
          status: "active",
          paid_from: NOW,
          paid_until: NOW,
          expires_at: null,
          telegram_chat_id: 202,
        },
        {
          wallet_address: WALLET_C,
          tier: "pro",
          status: "active",
          paid_from: NOW,
          paid_until: new Date(NOW.getTime() + 10 * DAY_MS),
          expires_at: null,
          telegram_chat_id: null,
        },
      ],
    });

    const result = await runSubscriptionLifecycle({
      query,
      now: NOW,
      environment: {
        DATABASE_URL: "postgres://example",
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
        HOODLUMS_APP_ORIGIN: "https://hoodlums.dev",
      },
      send,
    });

    expect(result).toEqual({
      subscriptionsChecked: 3,
      statusesUpdated: 2,
      remindersDue: 2,
      remindersSent: 2,
      remindersFailed: 0,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][2]).toContain("Your Pro expires in 5 days — renew now");
    expect(send.mock.calls[0][2]).toContain("https://hoodlums.dev/?renew=pro");
    expect(send.mock.calls[1][2]).toContain(
      "Your Pro Bundle has expired — renew to unlock your features. Your data is safe.",
    );
    expect(
      statements.filter((statement) => statement.sql.includes("subscription-reminder-sent")),
    ).toHaveLength(2);
    expect(
      statements.some((statement) =>
        statement.sql.includes("UPDATE subscription_lifecycle_runs") &&
        statement.sql.includes("status = 'completed'"),
      ),
    ).toBe(true);
  });

  it("does not resend a reminder already claimed by the database uniqueness boundary", async () => {
    const statements: Statement[] = [];
    const send = vi.fn(async () => ({ message_id: 1 }));
    const query = queryFor({
      statements,
      claimReminder: false,
      subscriptions: [{
        wallet_address: WALLET_A,
        tier: "pro",
        status: "expiring",
        paid_from: NOW,
        paid_until: new Date(NOW.getTime() + 2 * DAY_MS),
        expires_at: null,
        telegram_chat_id: 101,
      }],
    });

    const result = await runSubscriptionLifecycle({
      query,
      now: NOW,
      environment: {
        DATABASE_URL: "postgres://example",
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
      },
      send,
    });

    expect(result).toMatchObject({ remindersDue: 1, remindersSent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("retains in-app lifecycle state when Telegram is not linked or configured", async () => {
    const statements: Statement[] = [];
    const send = vi.fn(async () => ({ message_id: 1 }));
    const query = queryFor({
      statements,
      subscriptions: [{
        wallet_address: WALLET_A,
        tier: "pro",
        status: "active",
        paid_from: NOW,
        paid_until: new Date(NOW.getTime() + 4 * DAY_MS),
        expires_at: null,
        telegram_chat_id: null,
      }],
    });

    const result = await runSubscriptionLifecycle({
      query,
      now: NOW,
      environment: { DATABASE_URL: "postgres://example" },
      send,
    });

    expect(result).toMatchObject({
      statusesUpdated: 1,
      remindersDue: 0,
      remindersSent: 0,
    });
    expect(send).not.toHaveBeenCalled();
    expect(
      statements.some((statement) => statement.sql.includes("UPDATE subscriptions")),
    ).toBe(true);
  });

  it("records failed Telegram sends for a later retry instead of failing the whole cron", async () => {
    const statements: Statement[] = [];
    const query = queryFor({
      statements,
      subscriptions: [{
        wallet_address: WALLET_A,
        tier: "pro",
        status: "expiring",
        paid_from: NOW,
        paid_until: new Date(NOW.getTime() + 2 * DAY_MS),
        expires_at: null,
        telegram_chat_id: 101,
      }],
    });

    const result = await runSubscriptionLifecycle({
      query,
      now: NOW,
      environment: {
        DATABASE_URL: "postgres://example",
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
      },
      send: async () => {
        throw new Error("Telegram unavailable");
      },
    });

    expect(result).toMatchObject({ remindersDue: 1, remindersSent: 0, remindersFailed: 1 });
    expect(
      statements.some((statement) =>
        statement.sql.includes("SET status = 'failed'") &&
        statement.params?.includes("Telegram unavailable"),
      ),
    ).toBe(true);
  });
});
