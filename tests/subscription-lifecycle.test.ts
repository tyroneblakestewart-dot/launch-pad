import { describe, expect, it } from "vitest";
import {
  calculateSubscriptionWindow,
  dueSubscriptionReminder,
  subscriptionDaysRemaining,
  subscriptionPurchaseDefinition,
  subscriptionStatusAt,
} from "@/lib/subscription-lifecycle";
import {
  getSubscriptionAccess,
  isSubscriptionActive,
  type SubscriptionQuery,
} from "@/lib/server/subscription-lifecycle";

const WALLET = "0x1111111111111111111111111111111111111111";
const DAY_MS = 24 * 60 * 60 * 1_000;

describe("subscription purchase catalogue", () => {
  it("uses the approved USDT prices and manual access windows", () => {
    expect(subscriptionPurchaseDefinition("pro", "monthly")).toEqual({
      plan: "pro",
      billingPeriod: "monthly",
      usdCents: 5_000,
      windowDays: 32,
    });
    expect(subscriptionPurchaseDefinition("pro", "upfront")).toMatchObject({
      usdCents: 12_000,
      windowDays: 96,
    });
    expect(subscriptionPurchaseDefinition("pro-bundle", "monthly")).toMatchObject({
      usdCents: 12_000,
      windowDays: 32,
    });
    expect(subscriptionPurchaseDefinition("pro-bundle", "upfront")).toMatchObject({
      usdCents: 28_800,
      windowDays: 96,
    });
  });
});

describe("manual renewal windows", () => {
  const now = new Date("2026-08-06T09:00:00.000Z");

  it("starts a fresh monthly window from payment time when no active window remains", () => {
    const fresh = calculateSubscriptionWindow({
      now,
      currentPaidUntil: null,
      billingPeriod: "monthly",
    });
    expect(fresh.paidFrom.toISOString()).toBe("2026-08-06T09:00:00.000Z");
    expect(fresh.paidUntil.toISOString()).toBe("2026-09-07T09:00:00.000Z");
    expect(fresh.windowDays).toBe(32);

    const expired = calculateSubscriptionWindow({
      now,
      currentPaidUntil: new Date("2026-08-01T09:00:00.000Z"),
      billingPeriod: "monthly",
    });
    expect(expired.paidFrom.toISOString()).toBe(now.toISOString());
    expect(expired.paidUntil.toISOString()).toBe("2026-09-07T09:00:00.000Z");
  });

  it("extends an early renewal from the existing paid_until", () => {
    const renewal = calculateSubscriptionWindow({
      now,
      currentPaidUntil: new Date("2026-08-20T09:00:00.000Z"),
      billingPeriod: "monthly",
    });
    expect(renewal.paidFrom.toISOString()).toBe("2026-08-20T09:00:00.000Z");
    expect(renewal.paidUntil.toISOString()).toBe("2026-09-21T09:00:00.000Z");
  });

  it("grants 96 days for the 3-month upfront payment", () => {
    const upfront = calculateSubscriptionWindow({
      now,
      currentPaidUntil: null,
      billingPeriod: "upfront",
    });
    expect(upfront.windowDays).toBe(96);
    expect(upfront.paidUntil.toISOString()).toBe("2026-11-10T09:00:00.000Z");
  });
});

describe("lifecycle states and reminders", () => {
  const now = new Date("2026-08-06T09:00:00.000Z");

  it("derives active, expiring and expired from paid_until", () => {
    expect(subscriptionStatusAt(new Date(now.getTime() + 6 * DAY_MS), now)).toBe("active");
    expect(subscriptionStatusAt(new Date(now.getTime() + 5 * DAY_MS), now)).toBe("expiring");
    expect(subscriptionStatusAt(new Date(now.getTime() + DAY_MS), now)).toBe("expiring");
    expect(subscriptionStatusAt(now, now)).toBe("expired");
    expect(subscriptionStatusAt(new Date(now.getTime() - 1), now)).toBe("expired");
    expect(subscriptionStatusAt(null, now)).toBe("expired");
  });

  it("reports whole days remaining for the in-app banner", () => {
    expect(subscriptionDaysRemaining(new Date(now.getTime() + 5 * DAY_MS), now)).toBe(5);
    expect(subscriptionDaysRemaining(new Date(now.getTime() + 4.2 * DAY_MS), now)).toBe(5);
    expect(subscriptionDaysRemaining(now, now)).toBe(0);
  });

  it("schedules reminders at day 27, day 30 and expiry without losing failed retries", () => {
    expect(dueSubscriptionReminder(new Date(now.getTime() + 6 * DAY_MS), now)).toBeNull();
    expect(dueSubscriptionReminder(new Date(now.getTime() + 5 * DAY_MS), now)).toBe("five_days");
    expect(dueSubscriptionReminder(new Date(now.getTime() + 4 * DAY_MS), now)).toBe("five_days");
    expect(dueSubscriptionReminder(new Date(now.getTime() + 2 * DAY_MS), now)).toBe("two_days");
    expect(dueSubscriptionReminder(new Date(now.getTime() + DAY_MS), now)).toBe("two_days");
    expect(dueSubscriptionReminder(now, now)).toBe("expiry");
    expect(dueSubscriptionReminder(new Date(now.getTime() - DAY_MS), now)).toBe("expiry");
  });
});

describe("server-side entitlement source", () => {
  it("returns an active entitlement only from the durable paid_until value", async () => {
    const now = new Date("2026-08-06T09:00:00.000Z");
    const query = (async () => ({
      rows: [{
        wallet_address: WALLET,
        tier: "pro",
        paid_from: "2026-08-01T09:00:00.000Z",
        paid_until: "2026-09-02T09:00:00.000Z",
        expires_at: null,
        telegram_chat_id: 12345,
      }],
    })) as SubscriptionQuery;

    await expect(getSubscriptionAccess(WALLET, { query, now })).resolves.toMatchObject({
      walletAddress: WALLET,
      plan: "pro",
      status: "active",
      active: true,
      paidFrom: "2026-08-01T09:00:00.000Z",
      paidUntil: "2026-09-02T09:00:00.000Z",
      telegramLinked: true,
    });
    await expect(isSubscriptionActive(WALLET, { query, now })).resolves.toBe(true);
  });

  it("fails closed for expired, unknown, invalid or unavailable wallets", async () => {
    const now = new Date("2026-08-06T09:00:00.000Z");
    const expiredQuery = (async () => ({
      rows: [{
        wallet_address: WALLET,
        tier: "pro_bundle",
        paid_from: "2026-06-01T00:00:00.000Z",
        paid_until: "2026-07-03T00:00:00.000Z",
        expires_at: null,
        telegram_chat_id: null,
      }],
    })) as SubscriptionQuery;
    await expect(isSubscriptionActive(WALLET, { query: expiredQuery, now })).resolves.toBe(false);
    await expect(isSubscriptionActive("not-a-wallet", { query: expiredQuery, now })).resolves.toBe(false);

    const unavailable = (async () => {
      throw new Error("database unavailable");
    }) as SubscriptionQuery;
    await expect(
      isSubscriptionActive(WALLET, { now, query: unavailable }),
    ).resolves.toBe(false);
  });
});
