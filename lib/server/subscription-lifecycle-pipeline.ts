import type {
  AdminPipelineStage,
  AdminServicePipeline,
} from "@/lib/admin-operations";
import { getPostgresPool } from "@/lib/server/postgres";
import {
  buildSubscribersPipeline,
  type SubscribersPipelineDeps,
} from "@/lib/server/system-health-pipeline";
import {
  HEALTH_CHECK_TIMEOUT_MS,
  withTimeout,
} from "@/lib/server/system-health";

type PoolLike = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

type LifecycleRunRow = {
  started_at: Date | string;
  completed_at: Date | string | null;
  status: "running" | "completed" | "failed";
  subscriptions_checked: number | string;
  statuses_updated: number | string;
  reminders_due: number | string;
  reminders_sent: number | string;
  reminders_failed: number | string;
  error_message: string | null;
};

type ReminderRow = {
  reminder_kind: "five_days" | "two_days" | "expiry";
  status: "pending" | "sent" | "failed" | "skipped";
  wallet_address: string;
  attempted_at: Date | string;
  sent_at: Date | string | null;
  error_message: string | null;
};

function stage(
  id: string,
  label: string,
  status: AdminPipelineStage["status"],
  message: string,
  observedAt: string | null = null,
): AdminPipelineStage {
  return { id, label, status, message, observedAt };
}

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function configurationStage(
  environment: Record<string, string | undefined>,
): AdminPipelineStage {
  const required = ["DATABASE_URL", "CRON_SECRET"];
  const missingRequired = required.filter(
    (name) => !(environment[name] || "").trim(),
  );
  if (missingRequired.length > 0) {
    return stage(
      "lifecycle-configuration",
      "Cron and reminder configuration",
      "red",
      `Missing required variable(s): ${missingRequired.join(", ")}.`,
    );
  }

  const telegram = [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_BOT_USERNAME",
    "TELEGRAM_WEBHOOK_SECRET",
  ];
  const missingTelegram = telegram.filter(
    (name) => !(environment[name] || "").trim(),
  );
  if (missingTelegram.length > 0) {
    return stage(
      "lifecycle-configuration",
      "Cron and reminder configuration",
      "amber",
      `Daily lifecycle processing is configured. Telegram reminders are optional and currently missing: ${missingTelegram.join(", ")}. In-app reminders remain available.`,
    );
  }

  return stage(
    "lifecycle-configuration",
    "Cron and reminder configuration",
    "green",
    "Daily lifecycle processing and Telegram reminder configuration are present.",
  );
}

function lifecycleRunStage(
  row: LifecycleRunRow | undefined,
  now: Date,
): AdminPipelineStage {
  if (!row) {
    return stage(
      "last-lifecycle-run",
      "Last daily lifecycle run",
      "amber",
      "No lifecycle run has been recorded yet. The first Vercel cron run will create one.",
    );
  }

  const observedAt = asIso(row.completed_at ?? row.started_at);
  const startedAt = new Date(row.started_at);
  const ageHours = (now.getTime() - startedAt.getTime()) / 3_600_000;
  const checked = Number(row.subscriptions_checked || 0);
  const updated = Number(row.statuses_updated || 0);
  const due = Number(row.reminders_due || 0);
  const sent = Number(row.reminders_sent || 0);
  const failed = Number(row.reminders_failed || 0);

  if (row.status === "failed") {
    return stage(
      "last-lifecycle-run",
      "Last daily lifecycle run",
      "red",
      `The last run failed${row.error_message ? `: ${row.error_message}` : "."}`,
      observedAt,
    );
  }
  if (row.status === "running") {
    return stage(
      "last-lifecycle-run",
      "Last daily lifecycle run",
      ageHours > 2 ? "red" : "amber",
      ageHours > 2
        ? "The lifecycle run has remained in progress for more than two hours."
        : "A lifecycle run is currently in progress.",
      observedAt,
    );
  }
  if (ageHours > 36) {
    return stage(
      "last-lifecycle-run",
      "Last daily lifecycle run",
      "amber",
      `Last completed run is ${Math.floor(ageHours)} hours old. Checked ${checked}, updated ${updated}, reminders ${sent} sent / ${failed} failed.`,
      observedAt,
    );
  }

  return stage(
    "last-lifecycle-run",
    "Last daily lifecycle run",
    failed > 0 ? "amber" : "green",
    `Checked ${checked} subscription(s), updated ${updated} status(es), ${due} reminder(s) due, ${sent} sent and ${failed} failed.`,
    observedAt,
  );
}

function reminderStage(row: ReminderRow | undefined): AdminPipelineStage {
  if (!row) {
    return stage(
      "last-renewal-reminder",
      "Last Telegram renewal reminder",
      "green",
      "No Telegram renewal reminder has been due yet.",
    );
  }

  const observedAt = asIso(row.sent_at ?? row.attempted_at);
  if (row.status === "failed") {
    return stage(
      "last-renewal-reminder",
      "Last Telegram renewal reminder",
      "amber",
      `The latest ${row.reminder_kind} reminder for ${row.wallet_address} failed${row.error_message ? `: ${row.error_message}` : "."}`,
      observedAt,
    );
  }

  return stage(
    "last-renewal-reminder",
    "Last Telegram renewal reminder",
    row.status === "sent" ? "green" : "amber",
    `Latest ${row.reminder_kind} reminder for ${row.wallet_address}: ${row.status}.`,
    observedAt,
  );
}

export type SubscriptionLifecyclePipelineDeps = SubscribersPipelineDeps & {
  environment?: Record<string, string | undefined>;
  now?: Date;
};

export async function buildSubscriptionLifecyclePipeline(
  deps: SubscriptionLifecyclePipelineDeps = {},
): Promise<AdminServicePipeline> {
  const base = await buildSubscribersPipeline(deps);
  const environment = deps.environment ?? process.env;
  const databaseUrl = deps.databaseUrl ?? environment.DATABASE_URL?.trim() ?? "";
  const configuration = configurationStage(environment);

  if (!databaseUrl) {
    return {
      ...base,
      stages: [
        ...base.stages,
        configuration,
        stage(
          "lifecycle-tables",
          "Lifecycle tables",
          "amber",
          "DATABASE_URL is not configured.",
        ),
        stage(
          "last-lifecycle-run",
          "Last daily lifecycle run",
          "amber",
          "DATABASE_URL is not configured.",
        ),
        stage(
          "last-renewal-reminder",
          "Last Telegram renewal reminder",
          "amber",
          "DATABASE_URL is not configured.",
        ),
      ],
    };
  }

  const pool = (deps.getPool ?? ((url: string) => getPostgresPool(url) as unknown as PoolLike))(
    databaseUrl,
  );
  const requiredTables = [
    "plan_payment_events",
    "subscription_lifecycle_runs",
    "subscription_reminder_events",
    "telegram_link_codes",
  ];

  let tablesStage: AdminPipelineStage;
  let lastRun: LifecycleRunRow | undefined;
  let lastReminder: ReminderRow | undefined;
  try {
    const [tables, runs, reminders] = await withTimeout(
      Promise.all([
        pool.query<{ table_name: string }>(
          `SELECT table_name
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ANY($1)`,
          [requiredTables],
        ),
        pool.query<LifecycleRunRow>(
          `SELECT started_at, completed_at, status,
                  subscriptions_checked, statuses_updated,
                  reminders_due, reminders_sent, reminders_failed,
                  error_message
             FROM subscription_lifecycle_runs
            ORDER BY started_at DESC
            LIMIT 1`,
        ),
        pool.query<ReminderRow>(
          `SELECT reminder_kind, status, wallet_address,
                  attempted_at, sent_at, error_message
             FROM subscription_reminder_events
            ORDER BY attempted_at DESC
            LIMIT 1`,
        ),
      ]),
      HEALTH_CHECK_TIMEOUT_MS,
      "Subscription lifecycle health lookup timed out.",
    );
    const present = new Set(tables.rows.map((row) => row.table_name));
    const missing = requiredTables.filter((name) => !present.has(name));
    tablesStage = missing.length === 0
      ? stage(
          "lifecycle-tables",
          "Lifecycle tables",
          "green",
          "Payment history, Telegram links, reminder events and cron-run tables are present.",
        )
      : stage(
          "lifecycle-tables",
          "Lifecycle tables",
          "red",
          `Missing table(s): ${missing.join(", ")}. Apply migration 009_subscription_lifecycle.sql.`,
        );
    lastRun = runs.rows[0];
    lastReminder = reminders.rows[0];
  } catch {
    tablesStage = stage(
      "lifecycle-tables",
      "Lifecycle tables",
      "red",
      "Lifecycle health data could not be read. Apply migration 009_subscription_lifecycle.sql.",
    );
  }

  return {
    ...base,
    label: "Subscribers and renewals",
    stages: [
      ...base.stages,
      configuration,
      tablesStage,
      lifecycleRunStage(lastRun, deps.now ?? new Date()),
      reminderStage(lastReminder),
    ],
  };
}
