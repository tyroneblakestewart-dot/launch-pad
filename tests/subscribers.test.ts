import { describe, expect, it } from "vitest";
import {
  listSubscribers,
  type SubscribersPaymentQueryRow,
  type SubscribersQueryRow,
} from "@/lib/server/subscribers";

function row(overrides: Partial<SubscribersQueryRow> = {}): SubscribersQueryRow {
  return {
    wallet_address: "0x1111111111111111111111111111111111111111",
    tier: null,
    status: null,
    started_at: null,
    expires_at: null,
    paid_from: null,
    paid_until: null,
    payment_tx_hash: null,
    amount_eth: null,
    last_payment_asset: null,
    last_payment_amount: null,
    telegram_user_id: null,
    telegram_username: null,
    created_at: null,
    slugs: null,
    x_handles: null,
    telegrams: null,
    has_bond_pro_site_payment: false,
    payment_history: null,
    ...overrides,
  };
}

function payment(
  overrides: Partial<SubscribersPaymentQueryRow> = {},
): SubscribersPaymentQueryRow {
  return {
    payment_tx_hash: `0x${"ab".repeat(32)}`,
    plan_id: "pro",
    billing_period: "monthly",
    asset_symbol: "USDT",
    amount_display: "50",
    amount_eth: null,
    amount_usd_cents: 5_000,
    paid_from: "2026-06-01T00:00:00.000Z",
    paid_until: "2026-07-03T00:00:00.000Z",
    confirmed_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("listSubscribers", () => {
  it("is unavailable, not an error, when DATABASE_URL is not configured", async () => {
    const snapshot = await listSubscribers({ databaseUrl: "" });
    expect(snapshot).toMatchObject({ status: "unavailable", rows: [] });
  });

  it("degrades gracefully when lifecycle or bespoke challenge migrations are not applied", async () => {
    const snapshot = await listSubscribers({
      databaseUrl: "postgres://example",
      query: async () => {
        throw new Error(`column "paid_until" does not exist`);
      },
    });
    expect(snapshot).toMatchObject({ status: "unavailable", rows: [] });
    expect(snapshot.message).toContain("014_bespoke_site_challenges.sql");
  });

  it("returns a ready empty snapshot when there are no subscribers", async () => {
    const snapshot = await listSubscribers({
      databaseUrl: "postgres://example",
      query: async () => ({ rows: [] }),
    });
    expect(snapshot).toMatchObject({ status: "ready", rows: [] });
  });

  it("marks a publisher with no subscription row as free tier without bespoke access", async () => {
    const snapshot = await listSubscribers({
      databaseUrl: "postgres://example",
      query: async () => ({
        rows: [row({ slugs: ["my-token"], x_handles: ["@myhandle"], telegrams: [null] })],
      }),
    });
    expect(snapshot.rows[0]).toMatchObject({
      tier: "free",
      status: "free",
      bespokeSiteAccess: false,
      slugs: ["my-token"],
      xHandle: "@myhandle",
      telegram: null,
      telegramLinked: false,
      paymentHistory: [],
    });
  });

  it("keeps permanent one-off paid tiers active with bespoke access when they have no paid_until", async () => {
    const snapshot = await listSubscribers({
      databaseUrl: "postgres://example",
      now: new Date("2030-01-01T00:00:00.000Z"),
      query: async () => ({
        rows: [
          row({
            tier: "bond_pro_site",
            status: "active",
            paid_until: null,
            expires_at: null,
            has_bond_pro_site_payment: true,
            last_payment_asset: "ETH",
            last_payment_amount: "0.001",
          }),
        ],
      }),
    });
    expect(snapshot.rows[0]).toMatchObject({
      tier: "bond_pro_site",
      status: "active",
      bespokeSiteAccess: true,
      paidUntil: null,
      lastPaymentAsset: "ETH",
      lastPaymentAmount: "0.001",
    });
  });

  it("derives active and expiring states from paid_until and grants both higher tiers bespoke access", async () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const active = await listSubscribers({
      databaseUrl: "postgres://example",
      now,
      query: async () => ({
        rows: [
          row({
            tier: "pro",
            status: "expired",
            started_at: "2026-05-01T00:00:00.000Z",
            paid_from: "2026-05-20T00:00:00.000Z",
            paid_until: "2026-07-01T00:00:00.000Z",
            last_payment_asset: "USDT",
            last_payment_amount: "50",
            created_at: "2026-05-20T00:00:00.000Z",
          }),
        ],
      }),
    });
    expect(active.rows[0]).toMatchObject({
      tier: "pro",
      status: "active",
      bespokeSiteAccess: true,
      paidFrom: "2026-05-20T00:00:00.000Z",
      paidUntil: "2026-07-01T00:00:00.000Z",
      lastPaymentAsset: "USDT",
      lastPaymentAmount: "50",
    });

    const expiring = await listSubscribers({
      databaseUrl: "postgres://example",
      now,
      query: async () => ({
        rows: [row({ tier: "pro_bundle", status: "active", paid_until: "2026-06-05T00:00:00.000Z" })],
      }),
    });
    expect(expiring.rows[0]).toMatchObject({
      tier: "pro_bundle",
      status: "expiring",
      bespokeSiteAccess: true,
    });
  });

  it("blocks an expired recurring-only row but preserves permanent access from one-off history", async () => {
    const now = new Date("2026-06-10T00:00:00.000Z");
    const recurringOnly = await listSubscribers({
      databaseUrl: "postgres://example",
      now,
      query: async () => ({
        rows: [
          row({
            tier: "pro",
            status: "active",
            paid_until: "2026-06-01T00:00:00.000Z",
            payment_history: [payment({ paid_until: "2026-06-01T00:00:00.000Z" })],
          }),
        ],
      }),
    });
    expect(recurringOnly.rows[0]).toMatchObject({
      tier: "pro",
      status: "expired",
      bespokeSiteAccess: false,
      paidUntil: "2026-06-01T00:00:00.000Z",
    });
    expect(recurringOnly.rows[0].paymentHistory).toHaveLength(1);

    const withPermanentHistory = await listSubscribers({
      databaseUrl: "postgres://example",
      now,
      query: async () => ({
        rows: [
          row({
            tier: "pro",
            status: "expired",
            paid_until: "2026-06-01T00:00:00.000Z",
            has_bond_pro_site_payment: true,
          }),
        ],
      }),
    });
    expect(withPermanentHistory.rows[0]).toMatchObject({
      status: "expired",
      bespokeSiteAccess: true,
    });
  });

  it("shows linked Telegram identity and complete USDT/upfront payment history", async () => {
    const snapshot = await listSubscribers({
      databaseUrl: "postgres://example",
      query: async () => ({
        rows: [
          row({
            tier: "pro_bundle",
            paid_until: "2027-01-01T00:00:00.000Z",
            telegram_user_id: 12345,
            telegram_username: "hoodlum_user",
            payment_history: [
              payment({
                plan_id: "pro-bundle",
                billing_period: "upfront",
                amount_display: "288",
                amount_usd_cents: 28_800,
                paid_until: "2027-01-01T00:00:00.000Z",
              }),
            ],
          }),
        ],
      }),
    });
    expect(snapshot.rows[0]).toMatchObject({
      bespokeSiteAccess: true,
      telegramLinked: true,
      telegram: "@hoodlum_user",
    });
    expect(snapshot.rows[0].paymentHistory[0]).toMatchObject({
      planId: "pro-bundle",
      billingPeriod: "upfront",
      asset: "USDT",
      amountDisplay: "288",
      amountUsdCents: 28_800,
    });
  });

  it("includes paid wallets without a published site and de-duplicates slugs", async () => {
    const paid = await listSubscribers({
      databaseUrl: "postgres://example",
      query: async () => ({
        rows: [row({ tier: "pro", paid_until: "2027-01-01T00:00:00.000Z", slugs: null })],
      }),
    });
    expect(paid.rows[0]).toMatchObject({
      tier: "pro",
      bespokeSiteAccess: true,
      slugs: [],
    });

    const published = await listSubscribers({
      databaseUrl: "postgres://example",
      query: async () => ({ rows: [row({ slugs: ["zeta", "alpha", "alpha"] })] }),
    });
    expect(published.rows[0].slugs).toEqual(["alpha", "zeta"]);
  });
});
