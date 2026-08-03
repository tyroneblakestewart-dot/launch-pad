import {
  type AdminSubscriberRow,
  type AdminSubscriberTier,
  type AdminSubscribersSnapshot,
} from "@/lib/admin-operations";
import { getPostgresPool } from "@/lib/server/postgres";

export type SubscribersQueryRow = {
  wallet_address: string;
  tier: string | null;
  status: string | null;
  started_at: Date | string | null;
  expires_at: Date | string | null;
  payment_tx_hash: string | null;
  amount_eth: string | null;
  created_at: Date | string | null;
  slugs: Array<string | null> | null;
  x_handles: Array<string | null> | null;
  telegrams: Array<string | null> | null;
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

/**
 * Every wallet on the platform, joined from two independent sources: wallets
 * that have published a site (`published_sites`, always present) and wallets
 * with a durable subscription record (`subscriptions`, only present once a
 * wallet has paid). A wallet in one table but not the other is not an error
 * — it is either a free-tier publisher or a subscriber who hasn't published
 * yet — so this is a FULL OUTER JOIN, not an inner join.
 */
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
    sub.payment_tx_hash,
    sub.amount_eth,
    sub.created_at,
    sw.slugs,
    sw.x_handles,
    sw.telegrams
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

function rowFromQueryRow(row: SubscribersQueryRow, now: Date): AdminSubscriberRow {
  const hasSubscription = Boolean(row.tier);
  const expiresAt = asIso(row.expires_at);
  const isExpired = Boolean(expiresAt && new Date(expiresAt).getTime() < now.getTime());
  const tier = (hasSubscription ? row.tier : "free") as AdminSubscriberTier;
  const status = !hasSubscription ? "free" : isExpired ? "expired" : "active";
  const slugs = [...new Set((row.slugs || []).filter((slug): slug is string => Boolean(slug)))].sort((a, b) =>
    a.localeCompare(b),
  );

  return {
    walletAddress: row.wallet_address,
    tier,
    status,
    slugs,
    xHandle: firstNonEmpty(row.x_handles),
    telegram: firstNonEmpty(row.telegrams),
    startedAt: asIso(row.started_at),
    expiresAt,
    lastPaymentAmountEth: row.amount_eth || null,
    lastPaymentAt: asIso(row.created_at),
  };
}

/**
 * Read-only. Never throws — a missing DATABASE_URL, an unapplied migration
 * (the `subscriptions` table not existing yet) or any other query failure
 * all degrade to an "unavailable" snapshot with an empty row list, so the
 * dashboard can always render "No subscribers yet" instead of an error.
 */
export async function listSubscribers(deps: ListSubscribersDeps = {}): Promise<AdminSubscribersSnapshot> {
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  const query = deps.query ?? (databaseUrl ? (text: string, params?: unknown[]) => getPostgresPool(databaseUrl).query(text, params) : null);

  if (!query) {
    return { status: "unavailable", message: "DATABASE_URL is not configured.", rows: [] };
  }

  try {
    const now = deps.now ?? new Date();
    const result = await query(SUBSCRIBERS_QUERY);
    return {
      status: "ready",
      message: "Live data from Postgres.",
      rows: result.rows.map((row) => rowFromQueryRow(row, now)),
    };
  } catch {
    return {
      status: "unavailable",
      message: "Subscriber data could not be loaded. Apply migration 007_subscriptions.sql and try again.",
      rows: [],
    };
  }
}
