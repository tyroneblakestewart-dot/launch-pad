import { createPublicClient, formatEther, http } from "viem";
import {
  type AdminHealthCheck,
  type AdminMoneySnapshot,
  type AdminOperationsCostSnapshot,
  type AdminOperationsIssue,
  type AdminOperationsSnapshot,
  type AdminRevenueEvent,
  type AdminServiceKey,
  type AdminSiteStats,
} from "@/lib/admin-operations";
import {
  ROBINHOOD_TESTNET,
  ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
} from "@/lib/chains";
import {
  getFactoryAddress,
  HOODLUMS_TOKEN_FACTORY_ABI,
} from "@/lib/factory-config";
import { getAdminOperationsStore } from "@/lib/server/admin-operations-store";
import { getOperationsCostSnapshot } from "@/lib/server/admin-operations-costs";
import { getPostgresPool } from "@/lib/server/postgres";
import { getSystemHealth } from "@/lib/server/system-health";

const OPERATIONS_TIMEOUT_MS = 6_000;

const EMPTY_COST_PERIOD = {
  aiCostUsd: 0,
  xCostUsd: 0,
  variableCostUsd: 0,
  fixedCostUsd: 0,
  totalCostUsd: 0,
  revenueUsdCents: 0,
  marginUsd: 0,
  marginPercent: null as number | null,
};

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(timeoutMessage)),
      OPERATIONS_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getSiteStats(): Promise<AdminSiteStats> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) {
    return {
      status: "unavailable",
      total: 0,
      live: 0,
      draft: 0,
      message: "DATABASE_URL is not configured.",
    };
  }

  try {
    const result = await withTimeout(
      getPostgresPool(databaseUrl).query<{
        total: number | string;
        live: number | string;
        draft: number | string;
      }>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE visibility = 'live')::int AS live,
           COUNT(*) FILTER (WHERE visibility = 'draft')::int AS draft
         FROM published_sites`,
      ),
      "Published-site statistics timed out.",
    );
    const row = result.rows[0];
    return {
      status: "ready",
      total: Number(row?.total || 0),
      live: Number(row?.live || 0),
      draft: Number(row?.draft || 0),
      message: "Live counts from Postgres.",
    };
  } catch {
    return {
      status: "unavailable",
      total: 0,
      live: 0,
      draft: 0,
      message: "Published-site statistics could not be loaded.",
    };
  }
}

async function getActiveAdminSessionCount(): Promise<number | null> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return null;
  try {
    const result = await withTimeout(
      getPostgresPool(databaseUrl).query<{ active: number | string }>(
        `SELECT COUNT(*)::int AS active
           FROM admin_sessions
          WHERE expires_at > NOW()`,
      ),
      "Admin-session count timed out.",
    );
    return Number(result.rows[0]?.active || 0);
  } catch {
    return null;
  }
}

type RevenueQueryRow = {
  payment_tx_hash: string;
  wallet_address: string;
  plan_id: AdminRevenueEvent["planId"];
  billing_period: AdminRevenueEvent["billingPeriod"] | null;
  asset_symbol: string | null;
  amount_display: string | null;
  amount_eth: string | null;
  amount_usd_cents: number | string;
  paid_from: Date | string | null;
  paid_until: Date | string | null;
  confirmed_at: Date | string;
};

type PlanRevenueSnapshot = Pick<
  AdminMoneySnapshot,
  | "planRevenueStatus"
  | "planRevenueUsdCents"
  | "planPaymentCount"
  | "recentPlanPayments"
  | "planRevenueMessage"
>;

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function getPlanRevenueSnapshot(): Promise<PlanRevenueSnapshot> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) {
    return {
      planRevenueStatus: "unavailable",
      planRevenueUsdCents: 0,
      planPaymentCount: 0,
      recentPlanPayments: [],
      planRevenueMessage: "DATABASE_URL is not configured.",
    };
  }

  try {
    const pool = getPostgresPool(databaseUrl);
    const [totals, recent] = await withTimeout(
      Promise.all([
        pool.query<{ count: number | string; usd_cents: number | string }>(
          `SELECT
             COUNT(*)::int AS count,
             COALESCE(SUM(amount_usd_cents), 0)::bigint AS usd_cents
           FROM plan_payment_events`,
        ),
        pool.query<RevenueQueryRow>(
          `SELECT
             payment_tx_hash,
             wallet_address,
             plan_id,
             billing_period,
             asset_symbol,
             amount_display,
             amount_eth,
             amount_usd_cents,
             paid_from,
             paid_until,
             confirmed_at
           FROM plan_payment_events
           ORDER BY confirmed_at DESC
           LIMIT 20`,
        ),
      ]),
      "Plan revenue snapshot timed out.",
    );
    const total = totals.rows[0];
    return {
      planRevenueStatus: "ready",
      planRevenueUsdCents: Number(total?.usd_cents || 0),
      planPaymentCount: Number(total?.count || 0),
      recentPlanPayments: recent.rows.map((row) => ({
        transactionHash: row.payment_tx_hash,
        walletAddress: row.wallet_address,
        planId: row.plan_id,
        billingPeriod:
          row.billing_period ??
          (row.plan_id === "bond-pro-site" ? "one_off" : "monthly"),
        asset: row.asset_symbol || (row.amount_eth ? "ETH" : "—"),
        amountDisplay: row.amount_display || row.amount_eth || "—",
        amountEth: row.amount_eth || null,
        amountUsdCents: Number(row.amount_usd_cents),
        paidFrom: asIso(row.paid_from),
        paidUntil: asIso(row.paid_until),
        confirmedAt: asIso(row.confirmed_at)!,
      })),
      planRevenueMessage:
        "Server-verified ETH and USDT plan-payment events from Postgres.",
    };
  } catch {
    return {
      planRevenueStatus: "unavailable",
      planRevenueUsdCents: 0,
      planPaymentCount: 0,
      recentPlanPayments: [],
      planRevenueMessage:
        "Plan revenue could not be loaded. Apply migrations through 011_plan_payments.sql and try again.",
    };
  }
}

async function getMoneySnapshot(): Promise<AdminMoneySnapshot> {
  const revenue = await getPlanRevenueSnapshot();
  const chainLabel = "Robinhood Chain Testnet";
  const factoryAddress = getFactoryAddress(
    ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
  );
  if (!factoryAddress) {
    return {
      status: "unavailable",
      chainLabel,
      launchFee: "—",
      launchCount: "—",
      feeRecipient: "—",
      feeRecipientBalance: "—",
      message: "No factory address is configured for this chain.",
      ...revenue,
    };
  }

  try {
    const rpcUrl = ROBINHOOD_TESTNET.rpcUrls[0];
    const client = createPublicClient({
      chain: {
        id: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
        name: chainLabel,
        nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
        rpcUrls: { default: { http: [rpcUrl] } },
      },
      transport: http(rpcUrl),
    });

    const [launchFee, launchCount, feeRecipient] = await withTimeout(
      Promise.all([
        client.readContract({
          address: factoryAddress,
          abi: HOODLUMS_TOKEN_FACTORY_ABI,
          functionName: "launchFee",
        }),
        client.readContract({
          address: factoryAddress,
          abi: HOODLUMS_TOKEN_FACTORY_ABI,
          functionName: "launchCount",
        }),
        client.readContract({
          address: factoryAddress,
          abi: HOODLUMS_TOKEN_FACTORY_ABI,
          functionName: "feeRecipient",
        }),
      ]),
      "Factory money snapshot timed out.",
    );
    const balance = await withTimeout(
      client.getBalance({ address: feeRecipient }),
      "Fee-recipient balance timed out.",
    );

    return {
      status: "ready",
      chainLabel,
      launchFee: `${formatEther(launchFee)} ${ROBINHOOD_TESTNET.nativeCurrency.symbol}`,
      launchCount: launchCount.toString(),
      feeRecipient,
      feeRecipientBalance: `${formatEther(balance)} ${ROBINHOOD_TESTNET.nativeCurrency.symbol}`,
      message:
        "Live factory values. The wallet balance is not an audited revenue total and may include unrelated funds.",
      ...revenue,
    };
  } catch {
    return {
      status: "unavailable",
      chainLabel,
      launchFee: "—",
      launchCount: "—",
      feeRecipient: factoryAddress,
      feeRecipientBalance: "—",
      message: "Live factory money data could not be read from the chain.",
      ...revenue,
    };
  }
}

function healthServiceKey(
  check: AdminHealthCheck,
): AdminServiceKey | null {
  return check.id === "website-generation" ? "website-generation" : null;
}

function buildIssues(input: {
  health: AdminHealthCheck[];
  services: AdminOperationsSnapshot["services"];
  money: AdminMoneySnapshot;
  costs: AdminOperationsCostSnapshot;
  sectionErrors: string[];
}): AdminOperationsIssue[] {
  const issues: AdminOperationsIssue[] = [];

  for (const check of input.health) {
    if (check.status === "green") continue;
    issues.push({
      id: `health:${check.id}`,
      severity: check.status,
      title: check.label,
      message: check.message,
      source: "health",
      serviceKey: healthServiceKey(check),
    });
  }

  for (const service of input.services) {
    if (!service.isolated) continue;
    issues.push({
      id: `isolation:${service.key}`,
      severity: "amber",
      title: `${service.label} is isolated`,
      message: service.reason || "This service has been manually isolated.",
      source: "isolation",
      serviceKey: service.key,
    });
  }

  if (input.money.status === "unavailable") {
    issues.push({
      id: "operations:money",
      severity: "amber",
      title: "Factory money data unavailable",
      message: input.money.message,
      source: "operations",
      serviceKey: null,
    });
  }

  if (input.money.planRevenueStatus === "unavailable") {
    issues.push({
      id: "operations:plan-revenue",
      severity: "amber",
      title: "Plan revenue data unavailable",
      message: input.money.planRevenueMessage,
      source: "operations",
      serviceKey: null,
    });
  }

  if (input.costs.status === "unavailable") {
    issues.push({
      id: "operations:costs",
      severity: "amber",
      title: "Operations cost data unavailable",
      message: input.costs.message,
      source: "operations",
      serviceKey: null,
    });
  }

  input.sectionErrors.forEach((message, index) => {
    issues.push({
      id: `operations:${index}`,
      severity: "red",
      title: "Admin operations data unavailable",
      message,
      source: "operations",
      serviceKey: null,
    });
  });

  return issues;
}

export type AdminOperationsSnapshotDeps = {
  requestOidcToken?: string;
};

export async function getAdminOperationsSnapshot(
  deps: AdminOperationsSnapshotDeps = {},
): Promise<AdminOperationsSnapshot> {
  const store = getAdminOperationsStore();
  const [
    healthResult,
    servicesResult,
    activityResult,
    sitesResult,
    sessionsResult,
    moneyResult,
    costsResult,
  ] = await Promise.allSettled([
    getSystemHealth({ requestOidcToken: deps.requestOidcToken }),
    store.listServiceControls(),
    store.listActivity(40),
    getSiteStats(),
    getActiveAdminSessionCount(),
    getMoneySnapshot(),
    getOperationsCostSnapshot(),
  ]);

  const sectionErrors: string[] = [];
  const health =
    healthResult.status === "fulfilled"
      ? (healthResult.value as AdminHealthCheck[])
      : [];
  if (healthResult.status === "rejected") {
    sectionErrors.push("System Health could not be loaded.");
  }

  const services =
    servicesResult.status === "fulfilled" ? servicesResult.value : [];
  if (servicesResult.status === "rejected") {
    sectionErrors.push(
      "Service isolation controls could not be loaded. Apply the latest database migration.",
    );
  }

  const activity =
    activityResult.status === "fulfilled" ? activityResult.value : [];
  if (activityResult.status === "rejected") {
    sectionErrors.push(
      "Admin activity could not be loaded. Apply the latest database migration.",
    );
  }

  const sites =
    sitesResult.status === "fulfilled"
      ? sitesResult.value
      : {
          status: "unavailable" as const,
          total: 0,
          live: 0,
          draft: 0,
          message: "Published-site statistics could not be loaded.",
        };
  const activeAdminSessions =
    sessionsResult.status === "fulfilled" ? sessionsResult.value : null;
  const money =
    moneyResult.status === "fulfilled"
      ? moneyResult.value
      : {
          status: "unavailable" as const,
          chainLabel: "Robinhood Chain Testnet",
          launchFee: "—",
          launchCount: "—",
          feeRecipient: "—",
          feeRecipientBalance: "—",
          message: "Money data could not be loaded.",
          planRevenueStatus: "unavailable" as const,
          planRevenueUsdCents: 0,
          planPaymentCount: 0,
          recentPlanPayments: [],
          planRevenueMessage: "Plan revenue data could not be loaded.",
        };
  const costs: AdminOperationsCostSnapshot =
    costsResult.status === "fulfilled"
      ? costsResult.value
      : {
          status: "unavailable" as const,
          message: "Operations cost data could not be loaded.",
          today: EMPTY_COST_PERIOD,
          thisMonth: EMPTY_COST_PERIOD,
          lastMonth: EMPTY_COST_PERIOD,
          featureBreakdown: [],
          reconciliation: { attributedCostUsd: 0, unattributedCostUsd: 0, topWallets: [], topWalletsLimit: 0 },
          ledger: [],
          fixedCosts: [],
        };

  const issues = buildIssues({ health, services, money, costs, sectionErrors });

  return {
    checkedAt: new Date().toISOString(),
    health,
    services,
    activity,
    sites,
    activeAdminSessions,
    money,
    costs,
    issues,
    sectionErrors,
  };
}
