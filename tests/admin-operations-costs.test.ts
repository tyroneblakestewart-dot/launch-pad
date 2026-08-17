import { describe, expect, it, vi } from "vitest";
import { getOperationsCostSnapshot, toFixedOperatingCost, TOP_WALLETS_LIMIT } from "@/lib/server/admin-operations-costs";
import { createMemoryFixedOperatingCostsStore } from "@/lib/server/fixed-operating-costs-store";

const NOW = new Date("2026-03-15T12:00:00.000Z"); // 31-day month, exactly 14.5 days elapsed

function createFakePool(responses: Array<[match: string, rows: unknown[]]>) {
  return {
    query: vi.fn(async (text: string) => {
      const found = responses.find(([match]) => text.includes(match));
      if (!found) throw new Error(`No fake response configured for query: ${text.slice(0, 120)}`);
      return { rows: found[1] };
    }),
  };
}

describe("getOperationsCostSnapshot", () => {
  it("is unavailable with a clear message when DATABASE_URL is not configured", async () => {
    const snapshot = await getOperationsCostSnapshot({ databaseUrl: "" });
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.message).toContain("DATABASE_URL");
  });

  it("is unavailable (never throws) when the underlying tables cannot be read", async () => {
    const pool = { query: vi.fn(async () => Promise.reject(new Error(`relation "ai_operation_costs" does not exist`))) };
    const snapshot = await getOperationsCostSnapshot({
      databaseUrl: "postgres://test",
      now: NOW,
      getPool: () => pool,
      fixedOperatingCostsStore: createMemoryFixedOperatingCostsStore(),
    });
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.message).toContain("022_operations_costs.sql");
  });

  it("assembles periods, feature breakdown, reconciliation and the ledger end to end", async () => {
    const fixedCostsStore = createMemoryFixedOperatingCostsStore();
    await fixedCostsStore.create(
      { name: "Vercel hosting", amountUsd: 31, cadence: "monthly", note: null },
      new Date("2026-01-01T00:00:00.000Z"),
    );

    const pool = createFakePool([
      ["COALESCE(SUM(estimated_cost_usd) FILTER (WHERE occurred_at >= $1), 0)::text AS today", [{ today: "1", this_month: "10", last_month: "5" }]],
      ["COALESCE(SUM(cost_usd) FILTER (WHERE sent_at >= $1), 0)::text AS today", [{ today: "0.5", this_month: "2", last_month: "1" }]],
      ["COALESCE(SUM(amount_usd_cents) FILTER (WHERE confirmed_at >= $1), 0)::text AS today", [{ today: "1000", this_month: "5000", last_month: "3000" }]],
      [
        "GROUP BY feature_key",
        [
          { feature_key: "bespoke-site.full-page", cost_usd: "8", operation_count: "4" },
          { feature_key: "social.draft", cost_usd: "2", operation_count: "6" },
        ],
      ],
      ["COALESCE(SUM(cost_usd), 0)::text AS cost_usd, COUNT(*)::text AS operation_count", [{ cost_usd: "2", operation_count: "3" }]],
      ["attributed_ai_usd", [{ attributed_ai_usd: "9", unattributed_ai_usd: "1" }]],
      ["WITH combined AS", [{ wallet_address: "0xabc", total_usd: "9", operation_count: "5" }]],
      [
        "SELECT id, occurred_at, feature_key, wallet_address, estimated_cost_usd::text AS cost_usd, model, provider",
        [
          {
            id: "id1",
            occurred_at: new Date("2026-03-15T11:00:00.000Z"),
            feature_key: "bespoke-site.full-page",
            wallet_address: "0xabc",
            cost_usd: "0.5",
            model: "gpt-5-mini",
            provider: "openai",
          },
        ],
      ],
      [
        "SELECT destination_id::text AS id, sent_at, wallet_address, cost_usd::text AS cost_usd",
        [{ id: "dest1", sent_at: new Date("2026-03-15T10:00:00.000Z"), wallet_address: "0xabc", cost_usd: "0.015" }],
      ],
      [
        "FROM subscriptions",
        [{ wallet_address: "0xabc", tier: "pro", paid_until: "2026-04-01T00:00:00.000Z", expires_at: null }],
      ],
      ["FROM test_access_wallets", []],
      ["COALESCE(SUM(amount_usd_cents), 0)::text AS usd_cents", [{ wallet_address: "0xabc", usd_cents: "5000" }]],
    ]);

    const snapshot = await getOperationsCostSnapshot({
      databaseUrl: "postgres://test",
      now: NOW,
      getPool: () => pool,
      fixedOperatingCostsStore: fixedCostsStore,
    });

    expect(snapshot.status).toBe("ready");

    // Today: AI $1 + X $0.5 variable, fixed prorated to exactly $0.50 (half a day of $31/31-day-month).
    expect(snapshot.today).toMatchObject({ aiCostUsd: 1, xCostUsd: 0.5, variableCostUsd: 1.5, fixedCostUsd: 0.5, totalCostUsd: 2 });
    expect(snapshot.today.revenueUsdCents).toBe(1000);
    expect(snapshot.today.marginUsd).toBeCloseTo(8, 10);
    expect(snapshot.today.marginPercent).toBeCloseTo(80, 6);

    // This month: AI $10 + X $2 variable, fixed prorated to exactly $14.50 (14.5 / 31 days elapsed).
    expect(snapshot.thisMonth).toMatchObject({ aiCostUsd: 10, xCostUsd: 2, variableCostUsd: 12 });
    expect(snapshot.thisMonth.fixedCostUsd).toBeCloseTo(14.5, 10);
    expect(snapshot.thisMonth.totalCostUsd).toBeCloseTo(26.5, 10);
    expect(snapshot.thisMonth.revenueUsdCents).toBe(5000);
    expect(snapshot.thisMonth.marginUsd).toBeCloseTo(23.5, 10);

    // Last month: full unprorated monthly-equivalent fixed cost.
    expect(snapshot.lastMonth).toMatchObject({ aiCostUsd: 5, xCostUsd: 1, variableCostUsd: 6, fixedCostUsd: 31, totalCostUsd: 37 });
    expect(snapshot.lastMonth.marginUsd).toBeCloseTo(-7, 10);

    expect(snapshot.featureBreakdown).toEqual([
      { featureLabel: "Bespoke site generation", costUsd: 8, operationCount: 4 },
      { featureLabel: "Social draft", costUsd: 2, operationCount: 6 },
      { featureLabel: "X post", costUsd: 2, operationCount: 3 },
    ]);

    expect(snapshot.reconciliation.attributedCostUsd).toBeCloseTo(11, 10); // 9 attributed AI + 2 X this month
    expect(snapshot.reconciliation.unattributedCostUsd).toBe(1);
    expect(snapshot.reconciliation.topWalletsLimit).toBe(TOP_WALLETS_LIMIT);
    expect(snapshot.reconciliation.topWallets).toEqual([
      { walletAddress: "0xabc", variableCostUsd: 9, operationCount: 5, plan: "Pro", accessSource: "paid", revenueUsdCents: 5000 },
    ]);

    expect(snapshot.ledger).toHaveLength(2);
    expect(snapshot.ledger[0]).toMatchObject({ id: "id1", featureLabel: "Bespoke site generation", walletAddress: "0xabc", costUsd: 0.5 });
    expect(snapshot.ledger[1]).toMatchObject({ id: "dest1", featureLabel: "X post", walletAddress: "0xabc", costUsd: 0.015, provider: "x" });

    expect(snapshot.fixedCosts).toHaveLength(1);
    expect(snapshot.fixedCosts[0]).toMatchObject({ name: "Vercel hosting", amountUsd: 31, cadence: "monthly", monthlyEquivalentUsd: 31 });
  });

  it("skips the wallet-detail queries entirely when there are no top wallets this month", async () => {
    const pool = createFakePool([
      ["COALESCE(SUM(estimated_cost_usd) FILTER (WHERE occurred_at >= $1), 0)::text AS today", [{ today: "0", this_month: "0", last_month: "0" }]],
      ["COALESCE(SUM(cost_usd) FILTER (WHERE sent_at >= $1), 0)::text AS today", [{ today: "0", this_month: "0", last_month: "0" }]],
      ["COALESCE(SUM(amount_usd_cents) FILTER (WHERE confirmed_at >= $1), 0)::text AS today", [{ today: "0", this_month: "0", last_month: "0" }]],
      ["GROUP BY feature_key", []],
      ["COALESCE(SUM(cost_usd), 0)::text AS cost_usd, COUNT(*)::text AS operation_count", [{ cost_usd: "0", operation_count: "0" }]],
      ["attributed_ai_usd", [{ attributed_ai_usd: "0", unattributed_ai_usd: "0" }]],
      ["WITH combined AS", []],
      ["SELECT id, occurred_at, feature_key, wallet_address, estimated_cost_usd::text AS cost_usd, model, provider", []],
      ["SELECT destination_id::text AS id, sent_at, wallet_address, cost_usd::text AS cost_usd", []],
    ]);

    const snapshot = await getOperationsCostSnapshot({
      databaseUrl: "postgres://test",
      now: NOW,
      getPool: () => pool,
      fixedOperatingCostsStore: createMemoryFixedOperatingCostsStore(),
    });

    expect(snapshot.status).toBe("ready");
    expect(snapshot.reconciliation.topWallets).toEqual([]);
  });

  it("shows an X-only active test-allowlist wallet as Test access with $0 verified revenue, never derived from historical AI-row access_source (issue #368 correction pass)", async () => {
    const pool = createFakePool([
      ["COALESCE(SUM(estimated_cost_usd) FILTER (WHERE occurred_at >= $1), 0)::text AS today", [{ today: "0", this_month: "0", last_month: "0" }]],
      ["COALESCE(SUM(cost_usd) FILTER (WHERE sent_at >= $1), 0)::text AS today", [{ today: "0.03", this_month: "0.03", last_month: "0" }]],
      ["COALESCE(SUM(amount_usd_cents) FILTER (WHERE confirmed_at >= $1), 0)::text AS today", [{ today: "0", this_month: "0", last_month: "0" }]],
      ["GROUP BY feature_key", []],
      ["COALESCE(SUM(cost_usd), 0)::text AS cost_usd, COUNT(*)::text AS operation_count", [{ cost_usd: "0.03", operation_count: "2" }]],
      ["attributed_ai_usd", [{ attributed_ai_usd: "0", unattributed_ai_usd: "0" }]],
      ["WITH combined AS", [{ wallet_address: "0xdef", total_usd: "0.03", operation_count: "2" }]],
      ["SELECT id, occurred_at, feature_key, wallet_address, estimated_cost_usd::text AS cost_usd, model, provider", []],
      ["SELECT destination_id::text AS id, sent_at, wallet_address, cost_usd::text AS cost_usd", []],
      ["FROM subscriptions", []],
      ["FROM test_access_wallets", [{ wallet_address: "0xdef" }]],
      ["COALESCE(SUM(amount_usd_cents), 0)::text AS usd_cents", []],
    ]);

    const snapshot = await getOperationsCostSnapshot({
      databaseUrl: "postgres://test",
      now: NOW,
      getPool: () => pool,
      fixedOperatingCostsStore: createMemoryFixedOperatingCostsStore(),
    });

    expect(snapshot.reconciliation.topWallets).toEqual([
      { walletAddress: "0xdef", variableCostUsd: 0.03, operationCount: 2, plan: null, accessSource: "test-allowlist", revenueUsdCents: 0 },
    ]);
  });

  it("never presents an expired recurring subscription as a currently active plan", async () => {
    const pool = createFakePool([
      ["COALESCE(SUM(estimated_cost_usd) FILTER (WHERE occurred_at >= $1), 0)::text AS today", [{ today: "1", this_month: "1", last_month: "0" }]],
      ["COALESCE(SUM(cost_usd) FILTER (WHERE sent_at >= $1), 0)::text AS today", [{ today: "0", this_month: "0", last_month: "0" }]],
      ["COALESCE(SUM(amount_usd_cents) FILTER (WHERE confirmed_at >= $1), 0)::text AS today", [{ today: "0", this_month: "0", last_month: "0" }]],
      ["GROUP BY feature_key", []],
      ["COALESCE(SUM(cost_usd), 0)::text AS cost_usd, COUNT(*)::text AS operation_count", [{ cost_usd: "0", operation_count: "0" }]],
      ["attributed_ai_usd", [{ attributed_ai_usd: "1", unattributed_ai_usd: "0" }]],
      ["WITH combined AS", [{ wallet_address: "0xexp", total_usd: "1", operation_count: "1" }]],
      [
        "SELECT id, occurred_at, feature_key, wallet_address, estimated_cost_usd::text AS cost_usd, model, provider",
        [
          {
            id: "id2",
            occurred_at: new Date("2026-03-15T09:00:00.000Z"),
            feature_key: "bespoke-site.full-page",
            wallet_address: "0xexp",
            cost_usd: "1",
            model: "gpt-5-mini",
            provider: "openai",
          },
        ],
      ],
      ["SELECT destination_id::text AS id, sent_at, wallet_address, cost_usd::text AS cost_usd", []],
      // Subscription lapsed well before NOW (2026-03-15) — an expired recurring tier.
      ["FROM subscriptions", [{ wallet_address: "0xexp", tier: "pro", paid_until: "2026-01-01T00:00:00.000Z", expires_at: null }]],
      ["FROM test_access_wallets", []],
      ["COALESCE(SUM(amount_usd_cents), 0)::text AS usd_cents", []],
    ]);

    const snapshot = await getOperationsCostSnapshot({
      databaseUrl: "postgres://test",
      now: NOW,
      getPool: () => pool,
      fixedOperatingCostsStore: createMemoryFixedOperatingCostsStore(),
    });

    expect(snapshot.reconciliation.topWallets).toEqual([
      { walletAddress: "0xexp", variableCostUsd: 1, operationCount: 1, plan: null, accessSource: "unknown", revenueUsdCents: 0 },
    ]);
  });
});

describe("toFixedOperatingCost", () => {
  it("computes the monthly equivalent for an annual entry", () => {
    const record = toFixedOperatingCost({
      id: "1",
      name: "Domain renewal",
      amountUsd: 120,
      cadence: "annual",
      note: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(record.monthlyEquivalentUsd).toBeCloseTo(10, 10);
  });
});
