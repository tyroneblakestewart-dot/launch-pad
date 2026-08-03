import { describe, expect, it } from "vitest";
import { listSubscribers, type SubscribersQueryRow } from "@/lib/server/subscribers";

function row(overrides: Partial<SubscribersQueryRow> = {}): SubscribersQueryRow {
  return {
    wallet_address: "0x1111111111111111111111111111111111111111",
    tier: null,
    status: null,
    started_at: null,
    expires_at: null,
    payment_tx_hash: null,
    amount_eth: null,
    created_at: null,
    slugs: null,
    x_handles: null,
    telegrams: null,
    ...overrides,
  };
}

describe("listSubscribers", () => {
  it("is unavailable, not an error, when DATABASE_URL is not configured", async () => {
    const snapshot = await listSubscribers({ databaseUrl: "" });
    expect(snapshot).toMatchObject({ status: "unavailable", rows: [] });
  });

  it("degrades gracefully instead of throwing when the query fails (e.g. subscriptions table missing)", async () => {
    const snapshot = await listSubscribers({
      databaseUrl: "postgres://example",
      query: async () => {
        throw new Error(`relation "subscriptions" does not exist`);
      },
    });
    expect(snapshot).toMatchObject({ status: "unavailable", rows: [] });
    expect(snapshot.message).toContain("007_subscriptions.sql");
  });

  it("reports 'No subscribers yet' as a ready, empty snapshot when both tables are empty", async () => {
    const snapshot = await listSubscribers({
      databaseUrl: "postgres://example",
      query: async () => ({ rows: [] }),
    });
    expect(snapshot).toMatchObject({ status: "ready", rows: [] });
  });

  it("marks a wallet with no subscription row as free tier, even if it published a site", async () => {
    const snapshot = await listSubscribers({
      databaseUrl: "postgres://example",
      query: async () => ({
        rows: [row({ slugs: ["my-token"], x_handles: ["@myhandle"], telegrams: [null] })],
      }),
    });
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({
      tier: "free",
      status: "free",
      slugs: ["my-token"],
      xHandle: "@myhandle",
      telegram: null,
    });
  });

  it("reports an active paid subscription that has not expired yet", async () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const snapshot = await listSubscribers({
      databaseUrl: "postgres://example",
      now,
      query: async () => ({
        rows: [
          row({
            tier: "pro",
            status: "active",
            started_at: "2026-01-01T00:00:00.000Z",
            expires_at: "2026-12-01T00:00:00.000Z",
            amount_eth: "0.5",
            created_at: "2026-01-01T00:00:00.000Z",
          }),
        ],
      }),
    });
    expect(snapshot.rows[0]).toMatchObject({
      tier: "pro",
      status: "active",
      lastPaymentAmountEth: "0.5",
    });
  });

  it("derives 'expired' from the expiry date even if the stored status column says active — the source of truth is the date", async () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const snapshot = await listSubscribers({
      databaseUrl: "postgres://example",
      now,
      query: async () => ({
        rows: [
          row({
            tier: "bond_pro_site",
            status: "active",
            started_at: "2025-01-01T00:00:00.000Z",
            expires_at: "2026-01-01T00:00:00.000Z",
          }),
        ],
      }),
    });
    expect(snapshot.rows[0]).toMatchObject({ tier: "bond_pro_site", status: "expired" });
  });

  it("includes subscribers who have paid but not published a site", async () => {
    const snapshot = await listSubscribers({
      databaseUrl: "postgres://example",
      query: async () => ({
        rows: [row({ tier: "bond", status: "active", started_at: "2026-01-01T00:00:00.000Z", slugs: null })],
      }),
    });
    expect(snapshot.rows[0]).toMatchObject({ tier: "bond", slugs: [] });
  });

  it("de-duplicates and sorts multiple slugs for a wallet with more than one published site", async () => {
    const snapshot = await listSubscribers({
      databaseUrl: "postgres://example",
      query: async () => ({
        rows: [row({ slugs: ["zeta", "alpha", "alpha"] })],
      }),
    });
    expect(snapshot.rows[0].slugs).toEqual(["alpha", "zeta"]);
  });
});
