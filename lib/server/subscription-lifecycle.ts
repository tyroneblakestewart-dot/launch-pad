import { isAddress } from "viem";
import {
  dueSubscriptionReminder,
  subscriptionDaysRemaining,
  subscriptionPlanLabel,
  subscriptionStatusAt,
  type SubscriptionAccess,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from "@/lib/subscription-lifecycle";
import { getPostgresPool } from "@/lib/server/postgres";
import { sendText } from "@/lib/server/telegram";

type SubscriptionAccessRow = {
  wallet_address: string;
  tier: string;
  paid_from: Date | string | null;
  paid_until: Date | string | null;
  expires_at: Date | string | null;
  telegram_chat_id: number | string | null;
};

type LifecycleRow = SubscriptionAccessRow & {
  status: string;
};

type QueryResult<T> = { rows: T[]; rowCount?: number | null };
export type SubscriptionQuery = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function planFromTier(tier: string): SubscriptionPlan | null {
  if (tier === "pro") return "pro";
  if (tier === "pro_bundle") return "pro-bundle";
  return null;
}

export async function getSubscriptionAccess(
  walletAddress: string,
  options: {
    databaseUrl?: string;
    query?: SubscriptionQuery;
    now?: Date;
  } = {},
): Promise<SubscriptionAccess> {
  const normalised = walletAddress.trim().toLowerCase();
  const empty: SubscriptionAccess = {
    walletAddress: normalised,
    plan: null,
    status: "expired",
    active: false,
    paidFrom: null,
    paidUntil: null,
    daysRemaining: 0,
    telegramLinked: false,
  };
  if (!isAddress(normalised)) return empty;

  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  const query = options.query ?? (databaseUrl
    ? ((text: string, params?: unknown[]) => getPostgresPool(databaseUrl).query(text, params)) as SubscriptionQuery
    : null);
  if (!query) return empty;

  try {
    const result = await query<SubscriptionAccessRow>(
      `SELECT wallet_address, tier, paid_from, paid_until, expires_at, telegram_chat_id
         FROM subscriptions
        WHERE wallet_address = $1
        LIMIT 1`,
      [normalised],
    );
    const row = result.rows[0];
    const plan = row ? planFromTier(row.tier) : null;
    if (!row || !plan) return empty;

    const paidUntil = row.paid_until ?? row.expires_at;
    const now = options.now ?? new Date();
    const status = subscriptionStatusAt(paidUntil, now);
    return {
      walletAddress: row.wallet_address,
      plan,
      status,
      active: status !== "expired",
      paidFrom: asIso(row.paid_from),
      paidUntil: asIso(paidUntil),
      daysRemaining: subscriptionDaysRemaining(paidUntil, now),
      telegramLinked: Boolean(row.telegram_chat_id),
    };
  } catch {
    return empty;
  }
}

/** The only server-side entitlement decision for Pro and Pro Bundle features. */
export async function isSubscriptionActive(
  walletAddress: string,
  options: Parameters<typeof getSubscriptionAccess>[1] = {},
): Promise<boolean> {
  return (await getSubscriptionAccess(walletAddress, options)).active;
}

function appOrigin(environment: Record<string, string | undefined>): string {
  const candidate =
    environment.HOODLUMS_APP_ORIGIN?.trim() ||
    environment.PUBLISH_ALLOWED_ORIGIN?.trim() ||
    "https://hoodlums.dev";
  try {
    return new URL(candidate).origin;
  } catch {
    return "https://hoodlums.dev";
  }
}

function renewalUrl(plan: SubscriptionPlan, environment: Record<string, string | undefined>): string {
  const url = new URL("/", appOrigin(environment));
  url.searchParams.set("renew", plan);
  return url.toString();
}

function reminderMessage(input: {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  daysRemaining: number;
  environment: Record<string, string | undefined>;
}): string {
  const label = subscriptionPlanLabel(input.plan);
  const renew = renewalUrl(input.plan, input.environment);
  if (input.status === "expired") {
    return `Your ${label} has expired — renew to unlock your features. Your data is safe.\n\nRenew: ${renew}`;
  }
  const dayWord = input.daysRemaining === 1 ? "day" : "days";
  return `Your ${label} expires in ${input.daysRemaining} ${dayWord} — renew now.\n\nRenew: ${renew}`;
}

export type SubscriptionLifecycleRunResult = {
  subscriptionsChecked: number;
  statusesUpdated: number;
  remindersDue: number;
  remindersSent: number;
  remindersFailed: number;
};

export async function runSubscriptionLifecycle(options: {
  databaseUrl?: string;
  query?: SubscriptionQuery;
  now?: Date;
  environment?: Record<string, string | undefined>;
  send?: typeof sendText;
} = {}): Promise<SubscriptionLifecycleRunResult> {
  const environment = options.environment ?? process.env;
  const databaseUrl = options.databaseUrl ?? environment.DATABASE_URL?.trim() ?? "";
  const query = options.query ?? (databaseUrl
    ? ((text: string, params?: unknown[]) => getPostgresPool(databaseUrl).query(text, params)) as SubscriptionQuery
    : null);
  if (!query) throw new Error("DATABASE_URL is required for subscription lifecycle processing.");

  const now = options.now ?? new Date();
  const token = environment.TELEGRAM_BOT_TOKEN?.trim() || "";
  const send = options.send ?? sendText;
  const runInsert = await query<{ id: string }>(
    `INSERT INTO subscription_lifecycle_runs (started_at, status)
     VALUES ($1, 'running')
     RETURNING id`,
    [now],
  );
  const runId = runInsert.rows[0]?.id;
  if (!runId) throw new Error("The lifecycle run could not be recorded.");

  const result: SubscriptionLifecycleRunResult = {
    subscriptionsChecked: 0,
    statusesUpdated: 0,
    remindersDue: 0,
    remindersSent: 0,
    remindersFailed: 0,
  };

  try {
    const subscriptions = await query<LifecycleRow>(
      `SELECT wallet_address, tier, status, paid_from, paid_until, expires_at, telegram_chat_id
         FROM subscriptions
        WHERE tier IN ('pro', 'pro_bundle')
          AND COALESCE(paid_until, expires_at) IS NOT NULL
        ORDER BY wallet_address`,
    );
    result.subscriptionsChecked = subscriptions.rows.length;

    for (const row of subscriptions.rows) {
      const plan = planFromTier(row.tier);
      const paidUntil = row.paid_until ?? row.expires_at;
      if (!plan || !paidUntil) continue;

      const status = subscriptionStatusAt(paidUntil, now);
      const daysRemaining = subscriptionDaysRemaining(paidUntil, now);
      if (row.status !== status) {
        const updated = await query(
          `UPDATE subscriptions
              SET status = $2,
                  paid_until = COALESCE(paid_until, expires_at)
            WHERE wallet_address = $1
              AND status IS DISTINCT FROM $2`,
          [row.wallet_address, status],
        );
        result.statusesUpdated += Number(updated.rowCount || 0);
      }

      const reminderKind = dueSubscriptionReminder(paidUntil, now);
      const chatId = row.telegram_chat_id ? String(row.telegram_chat_id) : "";
      if (!reminderKind || !chatId || !token) continue;
      result.remindersDue += 1;

      const claimed = await query<{ id: string }>(
        `INSERT INTO subscription_reminder_events (
           wallet_address, paid_until, reminder_kind, telegram_chat_id, status, attempted_at
         ) VALUES ($1, $2, $3, $4, 'pending', $5)
         ON CONFLICT (wallet_address, paid_until, reminder_kind) DO UPDATE
           SET status = 'pending',
               attempted_at = EXCLUDED.attempted_at,
               error_message = NULL
         WHERE subscription_reminder_events.status = 'failed'
         RETURNING id`,
        [row.wallet_address, new Date(paidUntil), reminderKind, chatId, now],
      );
      const reminderId = claimed.rows[0]?.id;
      if (!reminderId) continue;

      try {
        const sent = await send(
          token,
          chatId,
          reminderMessage({ plan, status, daysRemaining, environment }),
        );
        await query(
          `UPDATE subscription_reminder_events
              SET status = 'sent', telegram_message_id = $2, sent_at = $3
            WHERE id = $1`,
          [reminderId, sent.message_id, now],
        );
        await query(
          `INSERT INTO admin_activity_log (event_kind, service_key, message, created_at)
           VALUES ('subscription-reminder-sent', NULL, $1, $2)`,
          [
            `${subscriptionPlanLabel(plan)} ${reminderKind} renewal reminder sent to ${row.wallet_address}.`,
            now,
          ],
        );
        result.remindersSent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : "Telegram send failed.";
        await query(
          `UPDATE subscription_reminder_events
              SET status = 'failed', error_message = $2
            WHERE id = $1`,
          [reminderId, message],
        );
        result.remindersFailed += 1;
      }
    }

    await query(
      `UPDATE subscription_lifecycle_runs
          SET completed_at = $2,
              status = 'completed',
              subscriptions_checked = $3,
              statuses_updated = $4,
              reminders_due = $5,
              reminders_sent = $6,
              reminders_failed = $7
        WHERE id = $1`,
      [
        runId,
        now,
        result.subscriptionsChecked,
        result.statusesUpdated,
        result.remindersDue,
        result.remindersSent,
        result.remindersFailed,
      ],
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Lifecycle processing failed.";
    await query(
      `UPDATE subscription_lifecycle_runs
          SET completed_at = $2, status = 'failed', error_message = $3
        WHERE id = $1`,
      [runId, now, message],
    ).catch(() => undefined);
    throw error;
  }
}
