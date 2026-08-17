import {
  SUBSCRIBER_TIER_LABEL,
  type AdminCostFeatureBreakdownRow,
  type AdminCostLedgerItem,
  type AdminCostPeriodSnapshot,
  type AdminCostWalletRow,
  type AdminFixedOperatingCost,
  type AdminOperationsCostSnapshot,
  type AdminSubscriberTier,
} from "@/lib/admin-operations";
import { featureGroupLabel, X_POST_FEATURE_KEY } from "@/lib/ai-feature-keys";
import {
  computeMarginPercent,
  fixedCostForLastMonth,
  monthlyEquivalentUsd,
  previousUtcMonthBounds,
  proratedFixedCostForThisMonthSoFar,
  proratedFixedCostForTodaySoFar,
  utcDayBounds,
  utcMonthBounds,
} from "@/lib/operations-cost-math";
import { getFixedOperatingCostsStore, type FixedOperatingCostsStore } from "@/lib/server/fixed-operating-costs-store";
import { getPostgresPool } from "@/lib/server/postgres";
import { withTimeout } from "@/lib/server/system-health";

const OPERATIONS_COST_TIMEOUT_MS = 6_000;
export const TOP_WALLETS_LIMIT = 10;
export const LEDGER_LIMIT = 30;

type PoolLike = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export type OperationsCostSnapshotDeps = {
  now?: Date;
  databaseUrl?: string;
  getPool?: (databaseUrl: string) => PoolLike;
  fixedOperatingCostsStore?: FixedOperatingCostsStore;
};

function emptyPeriod(): AdminCostPeriodSnapshot {
  return {
    aiCostUsd: 0,
    xCostUsd: 0,
    variableCostUsd: 0,
    fixedCostUsd: 0,
    totalCostUsd: 0,
    revenueUsdCents: 0,
    marginUsd: 0,
    marginPercent: null,
  };
}

function unavailableSnapshot(message: string): AdminOperationsCostSnapshot {
  return {
    status: "unavailable",
    message,
    today: emptyPeriod(),
    thisMonth: emptyPeriod(),
    lastMonth: emptyPeriod(),
    featureBreakdown: [],
    reconciliation: { attributedCostUsd: 0, unattributedCostUsd: 0, topWallets: [], topWalletsLimit: TOP_WALLETS_LIMIT },
    ledger: [],
    fixedCosts: [],
  };
}

function buildPeriod(input: {
  aiCostUsd: number;
  xCostUsd: number;
  fixedCostUsd: number;
  revenueUsdCents: number;
}): AdminCostPeriodSnapshot {
  const variableCostUsd = input.aiCostUsd + input.xCostUsd;
  const totalCostUsd = variableCostUsd + input.fixedCostUsd;
  const revenueUsd = input.revenueUsdCents / 100;
  return {
    aiCostUsd: input.aiCostUsd,
    xCostUsd: input.xCostUsd,
    variableCostUsd,
    fixedCostUsd: input.fixedCostUsd,
    totalCostUsd,
    revenueUsdCents: input.revenueUsdCents,
    marginUsd: revenueUsd - totalCostUsd,
    marginPercent: computeMarginPercent(revenueUsd, totalCostUsd),
  };
}

function planLabel(tier: string | null): string | null {
  if (!tier) return null;
  return SUBSCRIBER_TIER_LABEL[tier as AdminSubscriberTier] ?? tier;
}

export function toFixedOperatingCost(record: {
  id: string;
  name: string;
  amountUsd: number;
  cadence: "monthly" | "annual";
  note: string | null;
  createdAt: string;
  updatedAt: string;
}): AdminFixedOperatingCost {
  return { ...record, monthlyEquivalentUsd: monthlyEquivalentUsd(record.amountUsd, record.cadence) };
}

export async function getOperationsCostSnapshot(deps: OperationsCostSnapshotDeps = {}): Promise<AdminOperationsCostSnapshot> {
  const now = deps.now ?? new Date();
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    return unavailableSnapshot("DATABASE_URL is not configured.");
  }

  const pool = (deps.getPool ?? ((url: string) => getPostgresPool(url) as unknown as PoolLike))(databaseUrl);
  const fixedCostsStore = deps.fixedOperatingCostsStore ?? getFixedOperatingCostsStore();

  try {
    const todayBounds = utcDayBounds(now);
    const thisMonthBounds = utcMonthBounds(now);
    const lastMonthBounds = previousUtcMonthBounds(now);

    const [
      aiTotalsResult,
      xTotalsResult,
      revenueResult,
      featureRowsResult,
      xFeatureResult,
      fixedCosts,
      attributionResult,
      walletTotalsResult,
      ledgerAiResult,
      ledgerXResult,
    ] = await withTimeout(
        Promise.all([
          pool.query<{ today: string | null; this_month: string | null; last_month: string | null }>(
            `SELECT
               COALESCE(SUM(estimated_cost_usd) FILTER (WHERE occurred_at >= $1), 0)::text AS today,
               COALESCE(SUM(estimated_cost_usd) FILTER (WHERE occurred_at >= $2), 0)::text AS this_month,
               COALESCE(SUM(estimated_cost_usd) FILTER (WHERE occurred_at >= $3 AND occurred_at < $2), 0)::text AS last_month
             FROM ai_operation_costs
             WHERE occurred_at >= $3`,
            [todayBounds.start, thisMonthBounds.start, lastMonthBounds.start],
          ),
          pool.query<{ today: string | null; this_month: string | null; last_month: string | null }>(
            `SELECT
               COALESCE(SUM(cost_usd) FILTER (WHERE sent_at >= $1), 0)::text AS today,
               COALESCE(SUM(cost_usd) FILTER (WHERE sent_at >= $2), 0)::text AS this_month,
               COALESCE(SUM(cost_usd) FILTER (WHERE sent_at >= $3 AND sent_at < $2), 0)::text AS last_month
             FROM social_x_send_costs
             WHERE sent_at >= $3`,
            [todayBounds.start, thisMonthBounds.start, lastMonthBounds.start],
          ),
          pool.query<{ today: string | null; this_month: string | null; last_month: string | null }>(
            `SELECT
               COALESCE(SUM(amount_usd_cents) FILTER (WHERE confirmed_at >= $1), 0)::text AS today,
               COALESCE(SUM(amount_usd_cents) FILTER (WHERE confirmed_at >= $2), 0)::text AS this_month,
               COALESCE(SUM(amount_usd_cents) FILTER (WHERE confirmed_at >= $3 AND confirmed_at < $2), 0)::text AS last_month
             FROM plan_payment_events
             WHERE confirmed_at >= $3`,
            [todayBounds.start, thisMonthBounds.start, lastMonthBounds.start],
          ),
          pool.query<{ feature_key: string; cost_usd: string; operation_count: string }>(
            `SELECT feature_key, COALESCE(SUM(estimated_cost_usd), 0)::text AS cost_usd, COUNT(*)::text AS operation_count
               FROM ai_operation_costs
              WHERE occurred_at >= $1
              GROUP BY feature_key`,
            [thisMonthBounds.start],
          ),
          pool.query<{ cost_usd: string; operation_count: string }>(
            `SELECT COALESCE(SUM(cost_usd), 0)::text AS cost_usd, COUNT(*)::text AS operation_count
               FROM social_x_send_costs
              WHERE sent_at >= $1`,
            [thisMonthBounds.start],
          ),
          fixedCostsStore.list(),
          pool.query<{ attributed_ai_usd: string; unattributed_ai_usd: string }>(
            `SELECT
               COALESCE(SUM(estimated_cost_usd) FILTER (WHERE wallet_address IS NOT NULL), 0)::text AS attributed_ai_usd,
               COALESCE(SUM(estimated_cost_usd) FILTER (WHERE wallet_address IS NULL), 0)::text AS unattributed_ai_usd
               FROM ai_operation_costs
              WHERE occurred_at >= $1`,
            [thisMonthBounds.start],
          ),
          pool.query<{ wallet_address: string; total_usd: string; operation_count: string }>(
            `WITH combined AS (
               SELECT LOWER(wallet_address) AS wallet_address, estimated_cost_usd AS cost_usd
                 FROM ai_operation_costs
                WHERE occurred_at >= $1 AND wallet_address IS NOT NULL
               UNION ALL
               SELECT LOWER(wallet_address) AS wallet_address, cost_usd
                 FROM social_x_send_costs
                WHERE sent_at >= $1
             )
             SELECT wallet_address, SUM(cost_usd)::text AS total_usd, COUNT(*)::text AS operation_count
               FROM combined
              GROUP BY wallet_address
              ORDER BY SUM(cost_usd) DESC
              LIMIT $2`,
            [thisMonthBounds.start, TOP_WALLETS_LIMIT],
          ),
          pool.query<{
            id: string;
            occurred_at: Date | string;
            feature_key: string;
            wallet_address: string | null;
            cost_usd: string;
            model: string | null;
            provider: string | null;
          }>(
            `SELECT id, occurred_at, feature_key, wallet_address, estimated_cost_usd::text AS cost_usd, model, provider
               FROM ai_operation_costs
              ORDER BY occurred_at DESC
              LIMIT $1`,
            [LEDGER_LIMIT],
          ),
          pool.query<{ id: string; sent_at: Date | string; wallet_address: string; cost_usd: string }>(
            `SELECT destination_id::text AS id, sent_at, wallet_address, cost_usd::text AS cost_usd
               FROM social_x_send_costs
              ORDER BY sent_at DESC
              LIMIT $1`,
            [LEDGER_LIMIT],
          ),
        ]),
        OPERATIONS_COST_TIMEOUT_MS,
        "Operations cost snapshot timed out.",
      );

    const aiTotals = aiTotalsResult.rows[0];
    const xTotals = xTotalsResult.rows[0];
    const revenueTotals = revenueResult.rows[0];

    const fixedCostRecords = fixedCosts.map((record) => toFixedOperatingCost(record));
    const monthlyEquivalentTotalUsd = fixedCostRecords.reduce((sum, cost) => sum + cost.monthlyEquivalentUsd, 0);

    const today = buildPeriod({
      aiCostUsd: Number.parseFloat(aiTotals?.today || "0") || 0,
      xCostUsd: Number.parseFloat(xTotals?.today || "0") || 0,
      fixedCostUsd: proratedFixedCostForTodaySoFar(monthlyEquivalentTotalUsd, now),
      revenueUsdCents: Number.parseInt(revenueTotals?.today || "0", 10) || 0,
    });
    const thisMonth = buildPeriod({
      aiCostUsd: Number.parseFloat(aiTotals?.this_month || "0") || 0,
      xCostUsd: Number.parseFloat(xTotals?.this_month || "0") || 0,
      fixedCostUsd: proratedFixedCostForThisMonthSoFar(monthlyEquivalentTotalUsd, now),
      revenueUsdCents: Number.parseInt(revenueTotals?.this_month || "0", 10) || 0,
    });
    const lastMonth = buildPeriod({
      aiCostUsd: Number.parseFloat(aiTotals?.last_month || "0") || 0,
      xCostUsd: Number.parseFloat(xTotals?.last_month || "0") || 0,
      fixedCostUsd: fixedCostForLastMonth(monthlyEquivalentTotalUsd),
      revenueUsdCents: Number.parseInt(revenueTotals?.last_month || "0", 10) || 0,
    });

    const featureBreakdownByLabel = new Map<string, { costUsd: number; operationCount: number }>();
    for (const row of featureRowsResult.rows) {
      const label = featureGroupLabel(row.feature_key);
      const existing = featureBreakdownByLabel.get(label) ?? { costUsd: 0, operationCount: 0 };
      existing.costUsd += Number.parseFloat(row.cost_usd) || 0;
      existing.operationCount += Number.parseInt(row.operation_count, 10) || 0;
      featureBreakdownByLabel.set(label, existing);
    }
    const xFeatureRow = xFeatureResult.rows[0];
    const xFeatureCostUsd = Number.parseFloat(xFeatureRow?.cost_usd || "0") || 0;
    const xFeatureCount = Number.parseInt(xFeatureRow?.operation_count || "0", 10) || 0;
    if (xFeatureCount > 0) {
      const label = featureGroupLabel(X_POST_FEATURE_KEY);
      const existing = featureBreakdownByLabel.get(label) ?? { costUsd: 0, operationCount: 0 };
      existing.costUsd += xFeatureCostUsd;
      existing.operationCount += xFeatureCount;
      featureBreakdownByLabel.set(label, existing);
    }
    const featureBreakdown: AdminCostFeatureBreakdownRow[] = [...featureBreakdownByLabel.entries()]
      .map(([featureLabel, value]) => ({ featureLabel, costUsd: value.costUsd, operationCount: value.operationCount }))
      .sort((a, b) => b.costUsd - a.costUsd);

    const topWalletTotals = walletTotalsResult.rows.map((row) => ({
      walletAddress: row.wallet_address,
      totalUsd: Number.parseFloat(row.total_usd) || 0,
      operationCount: Number.parseInt(row.operation_count, 10) || 0,
    }));
    const topWalletAddresses = topWalletTotals.map((row) => row.walletAddress);

    let tierByWallet = new Map<string, string>();
    let accessSourceByWallet = new Map<string, AdminCostWalletRow["accessSource"]>();
    let revenueByWallet = new Map<string, number>();
    if (topWalletAddresses.length > 0) {
      const [tierResult, accessSourceResult, walletRevenueResult] = await withTimeout(
        Promise.all([
          pool.query<{ wallet_address: string; tier: string }>(
            `SELECT LOWER(wallet_address) AS wallet_address, tier FROM subscriptions WHERE LOWER(wallet_address) = ANY($1)`,
            [topWalletAddresses],
          ),
          pool.query<{ wallet_address: string; access_source: AdminCostWalletRow["accessSource"] }>(
            `SELECT wallet_address, (array_agg(access_source ORDER BY occurred_at DESC))[1] AS access_source
               FROM ai_operation_costs
              WHERE occurred_at >= $1 AND LOWER(wallet_address) = ANY($2)
              GROUP BY wallet_address`,
            [thisMonthBounds.start, topWalletAddresses],
          ),
          pool.query<{ wallet_address: string; usd_cents: string }>(
            `SELECT LOWER(wallet_address) AS wallet_address, COALESCE(SUM(amount_usd_cents), 0)::text AS usd_cents
               FROM plan_payment_events
              WHERE confirmed_at >= $1 AND LOWER(wallet_address) = ANY($2)
              GROUP BY wallet_address`,
            [thisMonthBounds.start, topWalletAddresses],
          ),
        ]),
        OPERATIONS_COST_TIMEOUT_MS,
        "Operations cost wallet reconciliation timed out.",
      );
      tierByWallet = new Map(tierResult.rows.map((row) => [row.wallet_address, row.tier]));
      accessSourceByWallet = new Map(accessSourceResult.rows.map((row) => [row.wallet_address.toLowerCase(), row.access_source]));
      revenueByWallet = new Map(walletRevenueResult.rows.map((row) => [row.wallet_address, Number.parseInt(row.usd_cents, 10) || 0]));
    }

    const topWallets: AdminCostWalletRow[] = topWalletTotals.map((row) => ({
      walletAddress: row.walletAddress,
      variableCostUsd: row.totalUsd,
      operationCount: row.operationCount,
      plan: planLabel(tierByWallet.get(row.walletAddress) ?? null),
      accessSource: accessSourceByWallet.get(row.walletAddress) ?? "unknown",
      revenueUsdCents: revenueByWallet.get(row.walletAddress) ?? 0,
    }));

    const attribution = attributionResult.rows[0];
    // Unattributed spend is AI-only: every X send requires a connected wallet, so social_x_send_costs never has a null wallet.
    // The full attributed total is every wallet's spend this month, not just the bounded top-N table below.
    const attributedCostUsd = (Number.parseFloat(attribution?.attributed_ai_usd || "0") || 0) + (Number.parseFloat(xTotals?.this_month || "0") || 0);
    const unattributedCostUsd = Number.parseFloat(attribution?.unattributed_ai_usd || "0") || 0;

    const ledgerItems: AdminCostLedgerItem[] = [
      ...ledgerAiResult.rows.map((row) => ({
        id: row.id,
        occurredAt: (row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at)).toISOString(),
        featureLabel: featureGroupLabel(row.feature_key),
        walletAddress: row.wallet_address,
        costUsd: Number.parseFloat(row.cost_usd) || 0,
        model: row.model,
        provider: row.provider,
      })),
      ...ledgerXResult.rows.map((row) => ({
        id: row.id,
        occurredAt: (row.sent_at instanceof Date ? row.sent_at : new Date(row.sent_at)).toISOString(),
        featureLabel: featureGroupLabel(X_POST_FEATURE_KEY),
        walletAddress: row.wallet_address,
        costUsd: Number.parseFloat(row.cost_usd) || 0,
        model: null,
        provider: "x",
      })),
    ]
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .slice(0, LEDGER_LIMIT);

    return {
      status: "ready",
      message:
        "Estimates only, from returned usage x configured prices — not the provider invoice. OpenAI/X invoices can differ from rounding, pricing changes, credits, discounts, minimum charges, failed calls without usage, and tax. Reconcile weekly during launch/active testing and at least monthly once stable.",
      today,
      thisMonth,
      lastMonth,
      featureBreakdown,
      reconciliation: {
        attributedCostUsd,
        unattributedCostUsd,
        topWallets,
        topWalletsLimit: TOP_WALLETS_LIMIT,
      },
      ledger: ledgerItems,
      fixedCosts: fixedCostRecords,
    };
  } catch {
    return unavailableSnapshot("Operations cost data could not be loaded. Apply migration 022_operations_costs.sql and try again.");
  }
}
