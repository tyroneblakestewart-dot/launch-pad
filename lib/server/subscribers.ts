import {
  type AdminSubscriberPayment,
  type AdminSubscriberRow,
  type AdminSubscriberTier,
  type AdminSubscribersSnapshot,
} from "@/lib/admin-operations";
import { subscriptionStatusAt } from "@/lib/subscription-lifecycle";
import { getPostgresPool } from "@/lib/server/postgres";

export type SubscribersPaymentQueryRow = {
  payment_tx_hash: string;
  plan_id: AdminSubscriberPayment["planId"];
  billing_period: AdminSubscriberPayment["billingPeriod"] | null;
  asset_symbol: string | null;
  amount_display: string | null;
  amount_eth: string | null;
  amount_usd_cents: number | string;
  paid_from: Date | string | null;
  paid_until: Date | string | null;
  confirmed_at: Date | string;
};

export type SubscribersQueryRow = {
  wallet_address: string;
  tier: string | null;
  status: string | null;
  started_at: Date | string | null;
  expires_at: Date | string | null;
  paid_from: Date | string | null;
  paid_until: Date | string | null;
  payment_tx_hash: string | null;
  amount_eth: string | null;
  last_payment_asset: string | null;
  last_payment_amount: string | null;
  telegram_user_id: number | string | null;
  telegram_username: string | null;
  created_at: Date | string | null;
  slugs: Array<string | null> | null;
  x_handles: Array<string | null> | null;
  telegrams: Array<string | null> | null;
  payment_history: SubscribersPaymentQueryRow[] | null;
};

export type SubscribersQuery = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: SubscribersQueryRow[] }>;

export type ListSubscribersDeps = {
  databaseUrl?: string;
  query?: SubscribersQuery;
  now?: Date;
};

const SUBSCRIBERS_QUERY = `
  WITH site_wallets AS (
    SELECT
      owner_wallet_address AS wallet_address,
      array_agg(DISTINCT slug) AS slugs,
      array_agg(DISTINCT NULLIF(x_handle, '')) AS x_handles,
      array_agg(DISTINCT NULLIF(telegram, '')) AS telegrams
    FROM published_sites
    GROUP BY owner_wallet_address
  )
  SELECT
    COALESCE(sw.wallet_address, sub.wallet_address) AS wallet_address,
    sub.tier,
    sub.status,
    sub.started_at,
    sub.expires_at,
    sub.paid_from,
    sub.paid_until,
    sub.payment_tx_hash,
    sub.amount_eth,
    sub.last_payment_asset,
    sub.last_payment_amount,
    sub.telegram_user_id,
    sub.telegram_username,
    sub.created_at,
    sw.slugs,
    sw.x_handles,
    sw.telegrams,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'payment_tx_hash', payment.payment_tx_hash,
            'plan_id', payment.plan_id,
            'billing_period', payment.billing_period,
            'asset_symbol', payment.asset_symbol,
            'amount_display', payment.amount_display,
            'amount_eth', payment.amount_eth,
            'amount_usd_cents', payment.amount_usd_cents,
            'paid_from', payment.paid_from,
            'paid_until', payment.paid_until,
            'confirmed_at', payment.confirmed_at
          ) ORDER BY payment.confirmed_at DESC
        )
        FROM plan_payment_events payment
        WHERE payment.wallet_address = COALESCE(sw.wallet_address, sub.wallet_address)
      ),
      '[]'::jsonb
    ) AS payment_history
  FROM site_wallets sw
  FULL OUTER JOIN subscriptions sub ON sub.wallet_address = sw.wallet_address
  ORDER BY COALESCE(sw.wallet_address, sub.wallet_address)
`;

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function firstNonEmpty(values: Array<string | null> | null): string | null {
  if (!values) return null;
  const found = values.find((value) => Boolean(value && value.trim()));
  return found ? found.trim() : null;
}

function paymentFromQueryRow(row: SubscribersPaymentQueryRow): AdminSubscriberPayment {
  return {
    transactionHash: row.payment_tx_hash,
    planId: row.plan_id,
    billingPeriod: row.billing_period ?? (row.plan_id === "bond-pro-site" ? "one_off" : "monthly"),
    asset: row.asset_symbol || (row.amount_eth ? "ETH" : "—"),
    amountDisplay: row.amount_display || row.amount_eth || "—",
    amountUsdCents: Number(row.amount_usd_cents || 0),
    paidFrom: asIso(row.paid_from),
    paidUntil: asIso(row.paid_until),
    confirmedAt: asIso(row.confirmed_at)!,
  };
}

function subscriberStatus(
  tier: AdminSubscriberTier,
  paidUntil: string | null,
  now: Date,
): AdminSubscriberRow["status"] {
  if (tier === "free") return "free";
  if (tier === "pro" || tier === "pro_bundle") {
    return subscriptionStatusAt(paidUntil, now);
  }
  return "active";
}

function rowFromQueryRow(row: SubscribersQueryRow, now: Date): AdminSubscriberRow {
  const hasSubscription = Boolean(row.tier);
  const paidUntil = asIso(row.paid_until ?? row.expires_at);
  const tier = (hasSubscription ? row.tier : "free") as AdminSubscriberTier;
  const status = subscriberStatus(tier, paidUntil, now);
  const slugs = [...new Set((row.slugs || []).filter((slug): slug is string => Boolean(slug)))].sort((a, b) =>
    a.localeCompare(b),
  );
  const linkedTelegram = row.telegram_username
    ? `@${row.telegram_username.replace(/^@/, "")}`
    : null;

  return {
    walletAddress: row.wallet_address,
    tier,
    status,
    slugs,
    xHandle: firstNonEmpty(row.x_handles),
    telegram: linkedTelegram || firstNonEmpty(row.telegrams),
    telegramLinked: Boolean(row.telegram_user_id),
    startedAt: asIso(row.started_at),
    expiresAt: paidUntil,
    paidFrom: asIso(row.paid_from),
    paidUntil,
    lastPaymentAsset: row.last_payment_asset || (row.amount_eth ? "ETH" : null),
    lastPaymentAmount: row.last_payment_amount || row.amount_eth || null,
    lastPaymentAmountEth: row.amount_eth || null,
    lastPaymentAt: asIso(row.created_at),
    paymentHistory: (row.payment_history || []).map(paymentFromQueryRow),
  };
}

/**
 * Read-only. Never throws — a missing database/migration degrades to an
 * unavailable snapshot so the admin cockpit itself remains usable.
 */
export async function listSubscribers(deps: ListSubscribersDeps = {}): Promise<AdminSubscribersSnapshot> {
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  const query = deps.query ?? (databaseUrl
    ? (text: string, params?: unknown[]) => getPostgresPool(databaseUrl).query(text, params)
    : null);

  if (!query) {
    return { status: "unavailable", message: "DATABASE_URL is not configured.", rows: [] };
  }

  try {
    const now = deps.now ?? new Date();
    const result = await query(SUBSCRIBERS_QUERY);
    return {
      status: "ready",
      message: "Live subscription lifecycle and payment history from Postgres.",
      rows: result.rows.map((row) => rowFromQueryRow(row, now)),
    };
  } catch {
    return {
      status: "unavailable",
      message:
        "Subscriber lifecycle data could not be loaded. Apply migrations through 011_plan_payments.sql and try again.",
      rows: [],
    };
  }
}
