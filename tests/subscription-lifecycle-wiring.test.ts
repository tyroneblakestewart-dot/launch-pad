import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("global subscription lifecycle wiring", () => {
  it("mounts the in-app reminder with the Account chrome every (app) page and the token page carry (round 3: per-page mounts, not one shared layout mount)", async () => {
    const shell = await source("components", "account-overlay-shell.tsx");
    const homePage = await source("app", "(app)", "page.tsx");
    const testnetPage = await source("app", "(app)", "testnet", "page.tsx");
    const tokenLayout = await source("app", "token", "[chain]", "[address]", "layout.tsx");

    expect(shell).toContain("SubscriptionLifecycleBanner");
    expect(homePage).toContain("accountOverlay={<AccountOverlayShell />}");
    expect(testnetPage).toContain("<AccountOverlayShell />");
    expect(tokenLayout).toContain("<AccountOverlayShell />");
  });

  it("shows the exact expiring and expired messages and routes renewal to the shared checkout", async () => {
    const banner = await source("components", "subscription-lifecycle-banner.tsx");
    const css = await source("components", "subscription-lifecycle-banner.module.css");

    expect(banner).toContain("expires in ${access.daysRemaining}");
    expect(banner).toContain("renew now");
    expect(banner).toContain("has expired — renew to unlock your features. Your data is safe.");
    expect(banner).toContain('requestWorkspaceOpen("new", access.plan)');
    expect(banner).toContain('import { storeLaunchPathPreset } from "@/lib/launch-paths"');
    expect(banner).toContain("storeLaunchPathPreset(access.plan)");
    expect(banner).toContain("Renew with stablecoin");
    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("min-height: 44px");
  });

  it("reads current entitlement from one server-side helper and fails closed", async () => {
    const lifecycle = await source("lib", "server", "subscription-lifecycle.ts");
    const route = await source("app", "api", "subscriptions", "status", "route.ts");

    expect(lifecycle).toContain("export async function getSubscriptionAccess");
    expect(lifecycle).toContain("export async function isSubscriptionActive");
    expect(lifecycle).toContain("return (await getSubscriptionAccess(walletAddress, options)).active");
    expect(route).toContain("getSubscriptionAccess");
    expect(route).toContain('headers: { "Cache-Control": "private, no-store" }');
  });

  it("locks billing and stablecoin selection after a hash exists so retry cannot trigger another payment", async () => {
    const checkout = await source("components", "plan-checkout.tsx");

    expect(checkout).toContain("const selectionLocked = busy || Boolean(transactionHash)");
    expect(checkout).toContain("disabled={selectionLocked}");
    expect(checkout).toContain("if (transactionHash && paymentWalletAddress && paymentSignature)");
    expect(checkout).toContain("RETRY VERIFICATION");
  });
});

describe("scheduled reminders and Telegram integration", () => {
  it("keeps the authenticated lifecycle, outreach, and social-posting cron schedules", async () => {
    const vercel = JSON.parse(await source("vercel.json")) as {
      crons?: Array<{ path: string; schedule: string }>;
      functions?: Record<string, { maxDuration?: number }>;
    };
    const route = await source("app", "api", "cron", "subscription-lifecycle", "route.ts");

    expect(vercel.crons).toEqual([
      { path: "/api/cron/subscription-lifecycle", schedule: "0 9 * * *" },
      { path: "/api/cron/outreach", schedule: "*/30 * * * *" },
      { path: "/api/cron/social-posting", schedule: "* * * * *" },
    ]);
    expect(vercel.functions?.["app/api/cron/subscription-lifecycle/route.ts"]?.maxDuration).toBe(60);
    expect(route).toContain("process.env.CRON_SECRET");
    expect(route).toContain("`Bearer ${secret}`");
    expect(route).toContain("runSubscriptionLifecycle");
  });

  it("offers Telegram linking only after successful payment and protects the webhook", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const webhook = await source("app", "api", "telegram", "subscription-webhook", "route.ts");
    const telegram = await source("lib", "server", "subscription-telegram.ts");

    expect(checkout).toContain("Link Telegram for renewal reminders");
    expect(checkout).toContain("verification.telegramLinkUrl");
    expect(webhook).toContain("isTelegramWebhookAuthorised");
    expect(telegram).toContain("x-telegram-bot-api-secret-token");
    expect(telegram).toContain("TELEGRAM_WEBHOOK_SECRET");
    expect(telegram).toContain("telegram_link_codes");
    expect(telegram).toContain("used_at IS NULL");
  });

  it("exposes reminder-run outcomes in the Subscribers System Health drill-down", async () => {
    const route = await source("app", "api", "admin", "health", "pipeline", "route.ts");
    const pipeline = await source("lib", "server", "subscription-lifecycle-pipeline.ts");

    expect(route).toContain('service === "subscribers"');
    expect(route).toContain("buildSubscriptionLifecyclePipeline");
    expect(pipeline).toContain("subscription_lifecycle_runs");
    expect(pipeline).toContain("subscription_reminder_events");
    expect(pipeline).toContain("Last daily lifecycle run");
    expect(pipeline).toContain("Last Telegram renewal reminder");
    expect(pipeline).toContain("011_plan_payments.sql");
    expect(pipeline).toContain("getConfiguredPaymentTokens");
  });
});

describe("data retention and admin standing rule", () => {
  it("keeps every migration prefix unique and preserves the legacy plan-payment dependency order", async () => {
    const migrations = (await readdir(path.join(ROOT, "db", "migrations")))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const prefixes = migrations.map((file) => file.match(/^(\d{3})_/)?.[1]);
    const runner = await source("scripts", "migrate-database.mjs");

    expect(migrations.filter((file) => file.startsWith("008_"))).toEqual([
      "008_hoodchat.sql",
    ]);
    expect(migrations.filter((file) => file.startsWith("009_"))).toEqual([
      "009_token_chat.sql",
    ]);
    expect(migrations.filter((file) => file.startsWith("010_"))).toEqual([
      "010_subscription_lifecycle.sql",
    ]);
    expect(migrations.filter((file) => file.startsWith("011_"))).toEqual([
      "011_plan_payments.sql",
    ]);
    expect(migrations).not.toContain("008_plan_payments.sql");
    expect(prefixes.every(Boolean)).toBe(true);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(runner).toContain("Duplicate migration prefix");
    expect(runner).toContain('"011_plan_payments.sql"');
    expect(runner).toContain('legacyFilename: "008_plan_payments.sql"');
    expect(runner).toContain("order: 8.5");
    expect(runner).toContain("hoodlums_schema_migrations");
    expect(runner).toContain("to_regclass('public.plan_payment_events')");
    expect(runner).toContain("remapped_from");
  });

  it("extends the existing schema without deleting expired subscriber data", async () => {
    const migration = await source("db", "migrations", "010_subscription_lifecycle.sql");

    expect(migration).toContain("paid_from TIMESTAMPTZ");
    expect(migration).toContain("paid_until TIMESTAMPTZ");
    expect(migration).toContain("subscription_lifecycle_runs");
    expect(migration).toContain("subscription_reminder_events");
    expect(migration).toContain("telegram_link_codes");
    expect(migration).not.toMatch(/DELETE\s+FROM\s+subscriptions/i);
    expect(migration).not.toMatch(/DROP\s+TABLE\s+subscriptions/i);
  });

  it("shows lifecycle state and token-aware payment history in Subscribers and Money", async () => {
    const subscribers = await source("components", "admin-subscribers-section.tsx");
    const money = await source("components", "admin-money-section.tsx");
    const server = await source("lib", "server", "admin-operations.ts");

    expect(subscribers).toContain("Payment history");
    expect(subscribers).toContain("expired · data retained");
    expect(money).toContain("payment.amountDisplay");
    expect(money).toContain("payment.asset");
    expect(server).toContain("asset_symbol");
    expect(server).toContain("paid_from");
    expect(server).toContain("011_plan_payments.sql");
  });
});
