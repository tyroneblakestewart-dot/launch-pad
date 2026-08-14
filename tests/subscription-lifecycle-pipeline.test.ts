import { describe, expect, it } from "vitest";
import { buildSubscriptionLifecyclePipeline } from "@/lib/server/subscription-lifecycle-pipeline";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const TABLES = [
  "plan_payment_events",
  "subscription_lifecycle_runs",
  "subscription_reminder_events",
  "telegram_link_codes",
];

const PAYMENT_TOKENS = JSON.stringify([
  {
    symbol: "USDG",
    contractAddress: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    decimals: 6,
    enabled: true,
    note: "Paxos-issued Global Dollar",
  },
  {
    symbol: "USDT",
    contractAddress: null,
    decimals: null,
    enabled: false,
    note: "Disabled: no canonical liquid USDT verified on Robinhood Chain",
  },
]);

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: "postgres://example",
    CRON_SECRET: "cron-secret",
    HOODLUMS_TREASURY_ADDRESS: "0x1111111111111111111111111111111111111111",
    HOODLUMS_PAYMENT_RPC_URL: "https://rpc.mainnet.chain.robinhood.com",
    HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI: "1",
    HOODLUMS_PAYMENT_TOKENS_JSON: PAYMENT_TOKENS,
    TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
    TELEGRAM_BOT_USERNAME: "HoodlumsBot",
    TELEGRAM_WEBHOOK_SECRET: "telegram-secret",
    ...overrides,
  };
}

function getPool(options: {
  runStatus?: "completed" | "running" | "failed";
  reminderStatus?: "sent" | "failed";
  missingTables?: string[];
  entitlementFailure?: boolean;
  challengeStoreMissing?: boolean;
} = {}) {
  return () => ({
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
    query: async (sql: string) => {
      if (sql.includes("table_name = 'subscriptions'")) {
        return { rows: [{ table_name: "subscriptions" }] };
      }
      if (sql.includes("COUNT(*)::int AS count FROM subscriptions")) {
        return { rows: [{ count: 3 }] };
      }
      if (sql.includes("AS has_bond_pro_site_payment")) {
        if (options.entitlementFailure) {
          throw new Error("plan payment history unavailable");
        }
        return {
          rows: [{
            tier: null,
            paid_until: null,
            expires_at: null,
            challenge_store_ready: !options.challengeStoreMissing,
            has_bond_pro_site_payment: false,
          }],
        };
      }
      if (sql.includes("table_name = ANY")) {
        const missing = new Set(options.missingTables || []);
        return { rows: TABLES.filter((table) => !missing.has(table)).map((table_name) => ({ table_name })) };
      }
      if (sql.includes("FROM subscription_lifecycle_runs")) {
        return {
          rows: [{
            started_at: "2026-08-06T09:00:00.000Z",
            completed_at: "2026-08-06T09:01:00.000Z",
            status: options.runStatus || "completed",
            subscriptions_checked: 3,
            statuses_updated: 1,
            reminders_due: 1,
            reminders_sent: options.runStatus === "failed" ? 0 : 1,
            reminders_failed: options.runStatus === "failed" ? 1 : 0,
            error_message: options.runStatus === "failed" ? "Telegram database unavailable" : null,
          }],
        };
      }
      if (sql.includes("FROM subscription_reminder_events")) {
        return {
          rows: [{
            reminder_kind: "five_days",
            status: options.reminderStatus || "sent",
            wallet_address: "0x3333333333333333333333333333333333333333",
            attempted_at: "2026-08-06T09:00:30.000Z",
            sent_at: options.reminderStatus === "failed" ? null : "2026-08-06T09:00:31.000Z",
            error_message: options.reminderStatus === "failed" ? "Telegram unavailable" : null,
          }],
        };
      }
      return { rows: [] };
    },
  });
}

describe("Subscribers and renewals System Health pipeline", () => {
  it("reports enabled payments, lifecycle services and the bespoke gate as healthy", async () => {
    const pipeline = await buildSubscriptionLifecyclePipeline({
      databaseUrl: "postgres://example",
      environment: environment(),
      now: NOW,
      getPool: getPool(),
    });

    expect(pipeline.label).toBe("Plan payments, subscribers and renewals");
    const configuration = pipeline.stages.find((item) => item.id === "lifecycle-configuration");
    expect(configuration).toMatchObject({ status: "green" });
    expect(configuration?.message).toContain("Bond + Pro Site native payment");
    expect(configuration?.message).toContain("USDG stablecoin payments");
    expect(configuration?.message).toContain("Disabled token(s): USDT");
    expect(pipeline.stages.find((item) => item.id === "lifecycle-tables")).toMatchObject({
      status: "green",
    });
    expect(pipeline.stages.find((item) => item.id === "bespoke-site-entitlement")).toMatchObject({
      status: "green",
    });
    expect(pipeline.stages.find((item) => item.id === "last-lifecycle-run")).toMatchObject({
      status: "green",
    });
    expect(pipeline.stages.find((item) => item.id === "last-renewal-reminder")).toMatchObject({
      status: "green",
    });
  });

  it("fails health when required cron configuration is missing", async () => {
    const pipeline = await buildSubscriptionLifecyclePipeline({
      databaseUrl: "postgres://example",
      environment: environment({ CRON_SECRET: undefined }),
      now: NOW,
      getPool: getPool(),
    });

    const configuration = pipeline.stages.find((item) => item.id === "lifecycle-configuration");
    expect(configuration).toMatchObject({ status: "red" });
    expect(configuration?.message).toContain("CRON_SECRET");
  });

  it("fails health when the Bond + Pro Site native amount is missing", async () => {
    const pipeline = await buildSubscriptionLifecyclePipeline({
      databaseUrl: "postgres://example",
      environment: environment({ HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI: undefined }),
      now: NOW,
      getPool: getPool(),
    });

    const configuration = pipeline.stages.find((item) => item.id === "lifecycle-configuration");
    expect(configuration).toMatchObject({ status: "red" });
    expect(configuration?.message).toContain("HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI");
  });

  it("fails health when the stablecoin catalog has no enabled token", async () => {
    const pipeline = await buildSubscriptionLifecyclePipeline({
      databaseUrl: "postgres://example",
      environment: environment({
        HOODLUMS_PAYMENT_TOKENS_JSON: JSON.stringify([
          {
            symbol: "USDT",
            contractAddress: null,
            decimals: null,
            enabled: false,
            note: "Not verified",
          },
        ]),
      }),
      now: NOW,
      getPool: getPool(),
    });

    const configuration = pipeline.stages.find((item) => item.id === "lifecycle-configuration");
    expect(configuration).toMatchObject({ status: "red" });
    expect(configuration?.message).toContain("At least one payment token must be enabled");
  });

  it("turns the bespoke entitlement stage red when its server query fails", async () => {
    const pipeline = await buildSubscriptionLifecyclePipeline({
      databaseUrl: "postgres://example",
      environment: environment(),
      now: NOW,
      getPool: getPool({ entitlementFailure: true }),
    });

    expect(pipeline.stages.find((item) => item.id === "bespoke-site-entitlement")).toMatchObject({
      status: "red",
    });
  });

  it("turns the bespoke entitlement stage red when the single-use challenge migration is missing", async () => {
    const pipeline = await buildSubscriptionLifecyclePipeline({
      databaseUrl: "postgres://example",
      environment: environment(),
      now: NOW,
      getPool: getPool({ challengeStoreMissing: true }),
    });

    expect(pipeline.stages.find((item) => item.id === "bespoke-site-entitlement")).toMatchObject({
      status: "red",
    });
  });

  it("keeps Telegram optional but clearly amber when in-app reminders are the only channel", async () => {
    const pipeline = await buildSubscriptionLifecyclePipeline({
      databaseUrl: "postgres://example",
      environment: environment({
        TELEGRAM_BOT_TOKEN: undefined,
        TELEGRAM_BOT_USERNAME: undefined,
        TELEGRAM_WEBHOOK_SECRET: undefined,
      }),
      now: NOW,
      getPool: getPool(),
    });

    const configuration = pipeline.stages.find((item) => item.id === "lifecycle-configuration");
    expect(configuration).toMatchObject({ status: "amber" });
    expect(configuration?.message).toContain("In-app reminders remain available");
  });

  it("surfaces missing migration tables and failed cron/reminder outcomes", async () => {
    const pipeline = await buildSubscriptionLifecyclePipeline({
      databaseUrl: "postgres://example",
      environment: environment(),
      now: NOW,
      getPool: getPool({
        runStatus: "failed",
        reminderStatus: "failed",
        missingTables: ["subscription_reminder_events"],
      }),
    });

    expect(pipeline.stages.find((item) => item.id === "lifecycle-tables")).toMatchObject({
      status: "red",
    });
    expect(pipeline.stages.find((item) => item.id === "last-lifecycle-run")).toMatchObject({
      status: "red",
    });
    expect(pipeline.stages.find((item) => item.id === "last-renewal-reminder")).toMatchObject({
      status: "amber",
    });
  });
});
