import { isAddress } from "viem";
import type {
  AdminAccountRecord,
  AdminAccountSearchItem,
  AdminAccountSearchResponse,
  AdminAccountSectionId,
  AdminAccountSectionResponse,
  AdminAccountSummary,
} from "@/lib/admin-accounts";
import { subscriptionStatusAt } from "@/lib/subscription-lifecycle";
import { getPostgresPool } from "@/lib/server/postgres";
import { getSubscriptionAccess } from "@/lib/server/subscription-lifecycle";

export type AdminAccountsQuery = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<{ rows: T[]; rowCount?: number | null }>;

export type AdminAccountsDeps = {
  databaseUrl?: string;
  query?: AdminAccountsQuery;
  now?: Date;
};

export class AdminAccountsUnavailableError extends Error {}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const EVM_WALLET = /^0x[a-fA-F0-9]{40}$/;

function queryFor(deps: AdminAccountsDeps): AdminAccountsQuery {
  if (deps.query) return deps.query;
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    throw new AdminAccountsUnavailableError("DATABASE_URL is not configured.");
  }
  return ((text: string, params?: unknown[]) =>
    getPostgresPool(databaseUrl).query(text, params)) as AdminAccountsQuery;
}

function positiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < 1) return fallback;
  return Math.min(Number(value), maximum);
}

function pagination(page?: number, pageSize?: number) {
  const safePage = positiveInteger(page, 1, Number.MAX_SAFE_INTEGER);
  const safePageSize = positiveInteger(pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  return {
    page: safePage,
    pageSize: safePageSize,
    offset: (safePage - 1) * safePageSize,
  };
}

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function count(value: number | string | null | undefined): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function totalPages(total: number, pageSize: number): number {
  return total === 0 ? 0 : Math.ceil(total / pageSize);
}

function displayUsername(value: string | null): string | null {
  if (!value?.trim()) return null;
  return `@${value.trim().replace(/^@/, "")}`;
}

function metadata(
  entries: Array<[string, string | number | null | undefined]>,
): Array<{ label: string; value: string }> {
  return entries
    .filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined && String(entry[1]).trim() !== "")
    .map(([label, value]) => ({ label, value: String(value) }));
}

function searchStatus(
  tier: string | null,
  paidUntil: Date | string | null,
  now: Date,
): AdminAccountSearchItem["status"] {
  if (!tier) return "free";
  if (tier === "pro" || tier === "pro_bundle") {
    return subscriptionStatusAt(paidUntil, now);
  }
  return "active";
}

type SearchRow = {
  wallet_address: string;
  telegram_username: string | null;
  tier: string | null;
  paid_until: Date | string | null;
  expires_at: Date | string | null;
  payment_count: number | string;
  site_count: number | string;
  total_count: number | string;
};

const SEARCH_SELECT = `
  SELECT
    candidate.wallet_address,
    subscription.telegram_username,
    subscription.tier,
    subscription.paid_until,
    subscription.expires_at,
    (SELECT COUNT(*) FROM plan_payment_events payment WHERE LOWER(payment.wallet_address) = candidate.wallet_address) AS payment_count,
    (SELECT COUNT(*) FROM published_sites site WHERE LOWER(site.owner_wallet_address) = candidate.wallet_address) AS site_count,
    COUNT(*) OVER() AS total_count
  FROM candidate_wallets candidate
  LEFT JOIN subscriptions subscription ON LOWER(subscription.wallet_address) = candidate.wallet_address
  ORDER BY
    CASE WHEN candidate.wallet_address = $1 THEN 0 ELSE 1 END,
    candidate.wallet_address
  LIMIT $2 OFFSET $3
`;

function walletSearchSql(): string {
  return `
    WITH candidate_wallets AS (
      SELECT LOWER(wallet_address) AS wallet_address FROM subscriptions WHERE LOWER(wallet_address) = $1
      UNION SELECT LOWER(wallet_address) AS wallet_address FROM plan_payment_events WHERE LOWER(wallet_address) = $1
      UNION SELECT LOWER(owner_wallet_address) AS wallet_address FROM published_sites WHERE LOWER(owner_wallet_address) = $1
      UNION SELECT LOWER(wallet_address) AS wallet_address FROM hoodchat_messages WHERE LOWER(wallet_address) = $1
      UNION SELECT LOWER(wallet_address) AS wallet_address FROM token_chat_messages WHERE LOWER(wallet_address) = $1
    )
    ${SEARCH_SELECT}
  `;
}

function telegramSearchSql(): string {
  return `
    WITH candidate_wallets AS (
      SELECT LOWER(wallet_address) AS wallet_address
      FROM subscriptions
      WHERE LOWER(telegram_username) LIKE $4 ESCAPE '!'
    )
    ${SEARCH_SELECT}
  `;
}

function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (character) => `!${character}`);
}

export async function searchAdminAccounts(
  input: { query: string; page?: number; pageSize?: number },
  deps: AdminAccountsDeps = {},
): Promise<AdminAccountSearchResponse> {
  const queryText = input.query.trim();
  const pageState = pagination(input.page, input.pageSize);
  if (!queryText) {
    return {
      query: "",
      page: pageState.page,
      pageSize: pageState.pageSize,
      total: 0,
      totalPages: 0,
      items: [],
    };
  }

  const query = queryFor(deps);
  const walletLookup = EVM_WALLET.test(queryText);
  const normalisedWallet = walletLookup ? queryText.toLowerCase() : "";
  const usernamePattern = `${escapeLike(queryText.replace(/^@/, "").toLowerCase())}%`;
  const result = await query<SearchRow>(
    walletLookup ? walletSearchSql() : telegramSearchSql(),
    walletLookup
      ? [normalisedWallet, pageState.pageSize, pageState.offset]
      : [normalisedWallet, pageState.pageSize, pageState.offset, usernamePattern],
  );
  const now = deps.now ?? new Date();
  const total = count(result.rows[0]?.total_count);

  return {
    query: queryText,
    page: pageState.page,
    pageSize: pageState.pageSize,
    total,
    totalPages: totalPages(total, pageState.pageSize),
    items: result.rows.map((row) => ({
      walletAddress: row.wallet_address,
      telegramUsername: displayUsername(row.telegram_username),
      tier: row.tier,
      status: searchStatus(row.tier, row.paid_until ?? row.expires_at, now),
      paidUntil: asIso(row.paid_until ?? row.expires_at),
      paymentCount: count(row.payment_count),
      siteCount: count(row.site_count),
    })),
  };
}

type SummaryRow = {
  has_subscription: boolean;
  tier: string | null;
  paid_from: Date | string | null;
  paid_until: Date | string | null;
  expires_at: Date | string | null;
  last_payment_asset: string | null;
  last_payment_amount: string | null;
  amount_eth: string | null;
  telegram_user_id: number | string | null;
  telegram_chat_id: number | string | null;
  telegram_username: string | null;
  telegram_linked_at: Date | string | null;
  payment_count: number | string;
  reminder_count: number | string;
  token_count: number | string;
  site_count: number | string;
  hoodchat_count: number | string;
  token_chat_count: number | string;
  reported_message_count: number | string;
  reports_against: number | string;
  hidden_message_count: number | string;
};

const SUMMARY_SQL = `
  SELECT
    subscription.wallet_address IS NOT NULL AS has_subscription,
    subscription.tier,
    subscription.paid_from,
    subscription.paid_until,
    subscription.expires_at,
    subscription.last_payment_asset,
    subscription.last_payment_amount,
    subscription.amount_eth,
    subscription.telegram_user_id,
    subscription.telegram_chat_id,
    subscription.telegram_username,
    subscription.telegram_linked_at,
    (SELECT COUNT(*) FROM plan_payment_events payment WHERE LOWER(payment.wallet_address) = $1) AS payment_count,
    (SELECT COUNT(*) FROM subscription_reminder_events reminder WHERE LOWER(reminder.wallet_address) = $1) AS reminder_count,
    (SELECT COUNT(*) FROM published_sites site WHERE LOWER(site.owner_wallet_address) = $1 AND site.status = 'launched') AS token_count,
    (SELECT COUNT(*) FROM published_sites site WHERE LOWER(site.owner_wallet_address) = $1) AS site_count,
    (SELECT COUNT(*) FROM hoodchat_messages message WHERE LOWER(message.wallet_address) = $1) AS hoodchat_count,
    (SELECT COUNT(*) FROM token_chat_messages message WHERE LOWER(message.wallet_address) = $1) AS token_chat_count,
    (
      (SELECT COUNT(*) FROM hoodchat_messages message WHERE LOWER(message.wallet_address) = $1 AND message.report_count > 0) +
      (SELECT COUNT(*) FROM token_chat_messages message WHERE LOWER(message.wallet_address) = $1 AND message.report_count > 0)
    ) AS reported_message_count,
    (
      (SELECT COALESCE(SUM(report_count), 0) FROM hoodchat_messages message WHERE LOWER(message.wallet_address) = $1) +
      (SELECT COALESCE(SUM(report_count), 0) FROM token_chat_messages message WHERE LOWER(message.wallet_address) = $1)
    ) AS reports_against,
    (
      (SELECT COUNT(*) FROM hoodchat_messages message WHERE LOWER(message.wallet_address) = $1 AND message.hidden) +
      (SELECT COUNT(*) FROM token_chat_messages message WHERE LOWER(message.wallet_address) = $1 AND message.hidden)
    ) AS hidden_message_count
  FROM (SELECT 1 AS requested) requested
  LEFT JOIN LATERAL (
    SELECT *
    FROM subscriptions
    WHERE LOWER(wallet_address) = $1
    ORDER BY CASE WHEN wallet_address = $1 THEN 0 ELSE 1 END
    LIMIT 1
  ) subscription ON TRUE
`;

export async function getAdminAccountSummary(
  walletAddress: string,
  deps: AdminAccountsDeps = {},
): Promise<AdminAccountSummary> {
  const normalised = walletAddress.trim().toLowerCase();
  if (!isAddress(normalised)) {
    throw new TypeError("A valid EVM wallet address is required.");
  }

  const query = queryFor(deps);
  const [result, access] = await Promise.all([
    query<SummaryRow>(SUMMARY_SQL, [normalised]),
    getSubscriptionAccess(normalised, {
      query,
      now: deps.now,
    }),
  ]);
  const row = result.rows[0];
  if (!row) throw new Error("The account summary query returned no row.");

  const counts = {
    payments: count(row.payment_count),
    reminders: count(row.reminder_count),
    tokensLaunched: count(row.token_count),
    sitesPublished: count(row.site_count),
    hoodchatMessages: count(row.hoodchat_count),
    tokenChatMessages: count(row.token_chat_count),
    reportedMessages: count(row.reported_message_count),
    reportsAgainst: count(row.reports_against),
    hiddenMessages: count(row.hidden_message_count),
  };
  const exists = Boolean(row.has_subscription || Object.values(counts).some((value) => value > 0));

  return {
    walletAddress: normalised,
    exists,
    subscription: {
      plan: access.plan,
      tier: row.tier,
      status: access.status,
      active: access.active,
      paidFrom: access.paidFrom ?? asIso(row.paid_from),
      paidUntil: access.paidUntil ?? asIso(row.paid_until ?? row.expires_at),
      daysRemaining: access.daysRemaining,
      lastPaymentAsset: row.last_payment_asset || (row.amount_eth ? "ETH" : null),
      lastPaymentAmount: row.last_payment_amount || row.amount_eth || null,
    },
    telegram: {
      linked: Boolean(row.telegram_user_id || row.telegram_chat_id),
      username: displayUsername(row.telegram_username),
      userId: row.telegram_user_id === null ? null : String(row.telegram_user_id),
      chatId: row.telegram_chat_id === null ? null : String(row.telegram_chat_id),
      linkedAt: asIso(row.telegram_linked_at),
    },
    counts,
  };
}

type TotalRow = { total_count: number | string };

type PaymentRow = TotalRow & {
  payment_tx_hash: string;
  plan_id: string;
  tier: string;
  billing_period: string | null;
  asset_symbol: string | null;
  amount_display: string | null;
  amount_eth: string | null;
  amount_usd_cents: number | string;
  paid_from: Date | string | null;
  paid_until: Date | string | null;
  chain_id: number | string;
  block_number: number | string;
  confirmed_at: Date | string;
};

type ReminderRow = TotalRow & {
  id: string;
  reminder_kind: string;
  status: string;
  paid_until: Date | string;
  telegram_chat_id: number | string | null;
  telegram_message_id: number | string | null;
  error_message: string | null;
  attempted_at: Date | string;
  sent_at: Date | string | null;
};

type SiteRow = TotalRow & {
  id: string;
  slug: string;
  token_name: string;
  ticker: string;
  chain: string;
  contract_address: string;
  status: string;
  visibility: string;
  created_at: Date | string;
  updated_at: Date | string;
  lp_locked_at: Date | string | null;
};

type ChatRow = TotalRow & {
  id: string;
  chat_kind: "hoodchat" | "token-chat";
  category: string | null;
  chain: string | null;
  contract_address: string | null;
  body: string;
  created_at: Date | string;
  report_count: number | string;
  hidden: boolean;
};

type TimelineRow = TotalRow & {
  id: string;
  kind: AdminAccountRecord["kind"];
  title: string;
  detail: string;
  occurred_at: Date | string;
  transaction_hash: string | null;
  event_metadata: Record<string, unknown> | null;
};

const PAYMENTS_SQL = `
  SELECT *, COUNT(*) OVER() AS total_count
  FROM plan_payment_events
  WHERE LOWER(wallet_address) = $1
  ORDER BY confirmed_at DESC
  LIMIT $2 OFFSET $3
`;

const REMINDERS_SQL = `
  SELECT *, COUNT(*) OVER() AS total_count
  FROM subscription_reminder_events
  WHERE LOWER(wallet_address) = $1
  ORDER BY COALESCE(sent_at, attempted_at) DESC
  LIMIT $2 OFFSET $3
`;

function sitesSql(tokensOnly: boolean): string {
  return `
    SELECT id, slug, token_name, ticker, chain, contract_address, status,
           visibility, created_at, updated_at, lp_locked_at,
           COUNT(*) OVER() AS total_count
    FROM published_sites
    WHERE LOWER(owner_wallet_address) = $1
      ${tokensOnly ? "AND status = 'launched'" : ""}
    ORDER BY ${tokensOnly ? "updated_at" : "created_at"} DESC
    LIMIT $2 OFFSET $3
  `;
}

function chatSql(reportsOnly: boolean): string {
  return `
    WITH messages AS (
      SELECT id, 'hoodchat'::text AS chat_kind, category, NULL::text AS chain,
             NULL::text AS contract_address, body, created_at, report_count, hidden
      FROM hoodchat_messages
      WHERE LOWER(wallet_address) = $1 ${reportsOnly ? "AND report_count > 0" : ""}
      UNION ALL
      SELECT id, 'token-chat'::text AS chat_kind, NULL::text AS category, chain,
             contract_address, body, created_at, report_count, hidden
      FROM token_chat_messages
      WHERE LOWER(wallet_address) = $1 ${reportsOnly ? "AND report_count > 0" : ""}
    )
    SELECT *, COUNT(*) OVER() AS total_count
    FROM messages
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `;
}

const TIMELINE_SQL = `
  WITH events AS (
    SELECT
      'subscription:' || wallet_address AS id,
      'subscription'::text AS kind,
      CASE WHEN tier = 'pro_bundle' THEN 'Pro Bundle subscription' ELSE 'Pro subscription' END AS title,
      status AS detail,
      COALESCE(paid_from, started_at, created_at) AS occurred_at,
      NULL::text AS transaction_hash,
      jsonb_build_object('tier', tier, 'paid_until', COALESCE(paid_until, expires_at)) AS event_metadata
    FROM subscriptions
    WHERE LOWER(wallet_address) = $1

    UNION ALL

    SELECT
      payment_tx_hash AS id,
      'payment'::text AS kind,
      plan_id || ' payment' AS title,
      COALESCE(amount_display, amount_eth, '—') || ' ' || COALESCE(asset_symbol, 'ETH') AS detail,
      confirmed_at AS occurred_at,
      payment_tx_hash AS transaction_hash,
      jsonb_build_object('billing_period', billing_period, 'paid_until', paid_until) AS event_metadata
    FROM plan_payment_events
    WHERE LOWER(wallet_address) = $1

    UNION ALL

    SELECT
      id::text,
      'reminder'::text AS kind,
      REPLACE(reminder_kind, '_', ' ') || ' reminder' AS title,
      status AS detail,
      COALESCE(sent_at, attempted_at) AS occurred_at,
      NULL::text AS transaction_hash,
      jsonb_build_object('paid_until', paid_until, 'telegram_message_id', telegram_message_id) AS event_metadata
    FROM subscription_reminder_events
    WHERE LOWER(wallet_address) = $1

    UNION ALL

    SELECT
      id::text,
      'site'::text AS kind,
      '/' || slug AS title,
      token_name || ' (' || ticker || ')' AS detail,
      created_at AS occurred_at,
      NULL::text AS transaction_hash,
      jsonb_build_object('status', status, 'visibility', visibility, 'chain', chain) AS event_metadata
    FROM published_sites
    WHERE LOWER(owner_wallet_address) = $1

    UNION ALL

    SELECT
      id::text || ':launch',
      'token'::text AS kind,
      token_name || ' (' || ticker || ')' AS title,
      CASE WHEN contract_address = '' THEN chain ELSE chain || ' · ' || contract_address END AS detail,
      updated_at AS occurred_at,
      NULL::text AS transaction_hash,
      jsonb_build_object('slug', slug, 'visibility', visibility) AS event_metadata
    FROM published_sites
    WHERE LOWER(owner_wallet_address) = $1 AND status = 'launched'

    UNION ALL

    SELECT
      id::text,
      'hoodchat'::text AS kind,
      'Community Hoodchat · ' || category AS title,
      body AS detail,
      created_at AS occurred_at,
      NULL::text AS transaction_hash,
      jsonb_build_object('reports', report_count, 'hidden', hidden) AS event_metadata
    FROM hoodchat_messages
    WHERE LOWER(wallet_address) = $1

    UNION ALL

    SELECT
      id::text,
      'token-chat'::text AS kind,
      'Token Hoodchat · ' || chain AS title,
      body AS detail,
      created_at AS occurred_at,
      NULL::text AS transaction_hash,
      jsonb_build_object('contract', contract_address, 'reports', report_count, 'hidden', hidden) AS event_metadata
    FROM token_chat_messages
    WHERE LOWER(wallet_address) = $1
  )
  SELECT *, COUNT(*) OVER() AS total_count
  FROM events
  ORDER BY occurred_at DESC
  LIMIT $2 OFFSET $3
`;

function pageResponse(
  walletAddress: string,
  section: AdminAccountSectionId,
  page: number,
  pageSize: number,
  total: number,
  items: AdminAccountRecord[],
): AdminAccountSectionResponse {
  return {
    walletAddress,
    section,
    page,
    pageSize,
    total,
    totalPages: totalPages(total, pageSize),
    items,
  };
}

function formatUsd(centsValue: number | string): string {
  const cents = count(centsValue);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function paymentRecord(row: PaymentRow): AdminAccountRecord {
  const billing = row.billing_period === "upfront"
    ? "3 months upfront"
    : row.billing_period === "one_off"
      ? "One-off"
      : "Monthly";
  const amount = row.amount_display || row.amount_eth || "—";
  const asset = row.asset_symbol || (row.amount_eth ? "ETH" : "—");
  return {
    id: row.payment_tx_hash,
    kind: "payment",
    title: `${row.plan_id} · ${billing}`,
    detail: `${amount} ${asset} · ${formatUsd(row.amount_usd_cents)}`,
    occurredAt: asIso(row.confirmed_at)!,
    transactionHash: row.payment_tx_hash,
    metadata: metadata([
      ["Tier", row.tier],
      ["Paid from", asIso(row.paid_from)],
      ["Paid until", asIso(row.paid_until)],
      ["Chain ID", row.chain_id],
      ["Block", row.block_number],
    ]),
  };
}

function reminderRecord(row: ReminderRow): AdminAccountRecord {
  return {
    id: row.id,
    kind: "reminder",
    title: `${row.reminder_kind.replaceAll("_", " ")} reminder · ${row.status}`,
    detail: row.error_message || (row.status === "sent" ? "Telegram reminder sent." : "Reminder lifecycle event recorded."),
    occurredAt: asIso(row.sent_at ?? row.attempted_at)!,
    transactionHash: null,
    metadata: metadata([
      ["Paid until", asIso(row.paid_until)],
      ["Telegram chat", row.telegram_chat_id],
      ["Telegram message", row.telegram_message_id],
      ["Attempted", asIso(row.attempted_at)],
    ]),
  };
}

function siteRecord(row: SiteRow, token: boolean): AdminAccountRecord {
  return {
    id: token ? `${row.id}:token` : row.id,
    kind: token ? "token" : "site",
    title: token ? `${row.token_name} (${row.ticker})` : `/${row.slug}`,
    detail: token
      ? `${row.chain}${row.contract_address ? ` · ${row.contract_address}` : ""}`
      : `${row.token_name} (${row.ticker}) · ${row.visibility}`,
    occurredAt: asIso(token ? row.updated_at : row.created_at)!,
    transactionHash: null,
    metadata: metadata([
      ["Slug", row.slug],
      ["Status", row.status],
      ["Visibility", row.visibility],
      ["Contract", row.contract_address],
      ["Created", asIso(row.created_at)],
      ["Updated", asIso(row.updated_at)],
      ["LP locked", asIso(row.lp_locked_at)],
    ]),
  };
}

function chatRecord(row: ChatRow, report: boolean): AdminAccountRecord {
  const tokenChat = row.chat_kind === "token-chat";
  return {
    id: report ? `${row.id}:report` : row.id,
    kind: report ? "report" : row.chat_kind,
    title: report
      ? `${count(row.report_count)} report${count(row.report_count) === 1 ? "" : "s"} against ${tokenChat ? "token chat" : "Hoodchat"}`
      : tokenChat
        ? `Token Hoodchat · ${row.chain}`
        : `Community Hoodchat · ${row.category}`,
    detail: row.body,
    occurredAt: asIso(row.created_at)!,
    transactionHash: null,
    metadata: metadata([
      ["Reports", row.report_count],
      ["Hidden", row.hidden ? "Yes" : "No"],
      ["Category", row.category],
      ["Chain", row.chain],
      ["Contract", row.contract_address],
    ]),
  };
}

function timelineRecord(row: TimelineRow): AdminAccountRecord {
  const eventMetadata = row.event_metadata || {};
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    occurredAt: asIso(row.occurred_at)!,
    transactionHash: row.transaction_hash,
    metadata: Object.entries(eventMetadata)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
      .map(([label, value]) => ({
        label: label.replaceAll("_", " "),
        value: value instanceof Date ? value.toISOString() : String(value),
      })),
  };
}

export async function getAdminAccountSection(
  walletAddress: string,
  section: AdminAccountSectionId,
  input: { page?: number; pageSize?: number } = {},
  deps: AdminAccountsDeps = {},
): Promise<AdminAccountSectionResponse> {
  const normalised = walletAddress.trim().toLowerCase();
  if (!isAddress(normalised)) {
    throw new TypeError("A valid EVM wallet address is required.");
  }
  const query = queryFor(deps);
  const pageState = pagination(input.page, input.pageSize);
  const params = [normalised, pageState.pageSize, pageState.offset];

  if (section === "payments") {
    const result = await query<PaymentRow>(PAYMENTS_SQL, params);
    const total = count(result.rows[0]?.total_count);
    return pageResponse(normalised, section, pageState.page, pageState.pageSize, total, result.rows.map(paymentRecord));
  }

  if (section === "reminders") {
    const result = await query<ReminderRow>(REMINDERS_SQL, params);
    const total = count(result.rows[0]?.total_count);
    return pageResponse(normalised, section, pageState.page, pageState.pageSize, total, result.rows.map(reminderRecord));
  }

  if (section === "tokens" || section === "sites") {
    const token = section === "tokens";
    const result = await query<SiteRow>(sitesSql(token), params);
    const total = count(result.rows[0]?.total_count);
    return pageResponse(normalised, section, pageState.page, pageState.pageSize, total, result.rows.map((row) => siteRecord(row, token)));
  }

  if (section === "hoodchat" || section === "reports") {
    const report = section === "reports";
    const result = await query<ChatRow>(chatSql(report), params);
    const total = count(result.rows[0]?.total_count);
    return pageResponse(normalised, section, pageState.page, pageState.pageSize, total, result.rows.map((row) => chatRecord(row, report)));
  }

  const result = await query<TimelineRow>(TIMELINE_SQL, params);
  const total = count(result.rows[0]?.total_count);
  return pageResponse(normalised, "timeline", pageState.page, pageState.pageSize, total, result.rows.map(timelineRecord));
}
