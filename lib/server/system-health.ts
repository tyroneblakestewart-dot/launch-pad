import { createPublicClient, http } from "viem";
import { getBondingCurveAddress, HOODLUMS_BONDING_CURVE_READ_ABI } from "@/lib/bonding-curve-config";
import { ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getCurveLaunchPipelineAddress } from "@/lib/curve-launch-pipeline-config";
import { getFactoryAddress, HOODLUMS_TOKEN_FACTORY_ABI } from "@/lib/factory-config";
import { monthlyEquivalentUsd, proratedFixedCostForThisMonthSoFar, utcMonthBounds } from "@/lib/operations-cost-math";
import { readOperationsCostThresholds } from "@/lib/server/ai-pricing";
import { resolveAIResponsesRuntime } from "@/lib/server/ai-responses-runtime";
import { CONTENT_FILTER_CATEGORY_COUNT, CONTENT_FILTER_TERM_COUNT } from "@/lib/server/content-filter";
import { getFixedOperatingCostsStore } from "@/lib/server/fixed-operating-costs-store";
import { getPostgresPool } from "@/lib/server/postgres";

export type SystemHealthStatus = "green" | "amber" | "red";

export type SystemHealthCheck = {
  id:
    | "website-generation"
    | "database"
    | "contracts"
    | "deployment"
    | "subscribers"
    | "hoodchat"
    | "token-chat"
    | "outreach"
    | "social-studio-ai"
    | "social-posting"
    | "client-errors"
    | "operations-cost"
    | "content-filter"
    | "support"
    | "token-launches";
  label: string;
  status: SystemHealthStatus;
  message: string;
};

export const HEALTH_CHECK_TIMEOUT_MS = 5_000;

export async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Reports whether an AI generation provider is configured, without ever
 * spending money on a real OpenAI/gateway call — this check may be polled
 * repeatedly from the dashboard, so it must stay free.
 *
 * `requestOidcToken` must be threaded through from the incoming admin
 * request (`getVercelOidcToken(request)`). In production, generation
 * authenticates via the automatic per-request `x-vercel-oidc-token` header,
 * not a `VERCEL_OIDC_TOKEN` environment variable — checking `env` alone
 * reported "not configured" even while real generation requests succeeded.
 */
export function checkWebsiteGenerationHealth(
  env: Record<string, string | undefined> = process.env,
  requestOidcToken = "",
): SystemHealthCheck {
  const id = "website-generation" as const;
  const label = "Website generation";
  try {
    const runtime = resolveAIResponsesRuntime(env, requestOidcToken);
    if (!runtime) {
      return { id, label, status: "amber", message: "No AI generation provider is configured." };
    }
    return { id, label, status: "green", message: `Ready via ${runtime.source} (${runtime.model}).` };
  } catch {
    return { id, label, status: "red", message: "Website generation health check failed unexpectedly." };
  }
}

export type DatabasePing = () => Promise<unknown>;

export async function checkDatabaseHealth(deps: {
  databaseUrl?: string;
  ping?: DatabasePing;
} = {}): Promise<SystemHealthCheck> {
  const id = "database" as const;
  const label = "Database";
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl && !deps.ping) {
    return { id, label, status: "amber", message: "DATABASE_URL is not configured." };
  }
  const ping = deps.ping ?? (() => getPostgresPool(databaseUrl).query("SELECT 1"));
  try {
    await withTimeout(ping(), HEALTH_CHECK_TIMEOUT_MS, "Database health check timed out.");
    return { id, label, status: "green", message: "Postgres connection is alive." };
  } catch {
    return { id, label, status: "red", message: "Postgres connection failed." };
  }
}

export type ContractReader = () => Promise<unknown>;

export async function checkContractsHealth(deps: {
  chainId?: number;
  rpcUrl?: string;
  factoryAddress?: `0x${string}` | undefined;
  bondingCurveAddress?: `0x${string}` | undefined;
  readFactory?: ContractReader;
  readBondingCurve?: ContractReader;
} = {}): Promise<SystemHealthCheck> {
  const id = "contracts" as const;
  const label = "On-chain contracts";
  try {
    const chainId = deps.chainId ?? ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL;
    const factoryAddress = deps.factoryAddress ?? getFactoryAddress(chainId);
    const bondingCurveAddress = deps.bondingCurveAddress ?? getBondingCurveAddress(chainId);

    const targets: Array<{ name: string; read: ContractReader }> = [];

    if (deps.readFactory) {
      targets.push({ name: "factory", read: deps.readFactory });
    } else if (factoryAddress) {
      targets.push({
        name: "factory",
        read: () =>
          contractsClient(chainId, deps.rpcUrl).readContract({
            address: factoryAddress,
            abi: HOODLUMS_TOKEN_FACTORY_ABI,
            functionName: "owner",
          }),
      });
    }

    if (deps.readBondingCurve) {
      targets.push({ name: "bonding curve", read: deps.readBondingCurve });
    } else if (bondingCurveAddress) {
      targets.push({
        name: "bonding curve",
        read: () =>
          contractsClient(chainId, deps.rpcUrl).readContract({
            address: bondingCurveAddress,
            abi: HOODLUMS_BONDING_CURVE_READ_ABI,
            functionName: "funded",
          }),
      });
    }

    if (targets.length === 0) {
      return {
        id,
        label,
        status: "amber",
        message: "No factory or bonding curve address is configured for this chain.",
      };
    }

    const outcomes = await Promise.all(
      targets.map(async (target) => {
        try {
          await withTimeout(target.read(), HEALTH_CHECK_TIMEOUT_MS, "timed out");
          return { name: target.name, ok: true };
        } catch {
          return { name: target.name, ok: false };
        }
      }),
    );

    const failed = outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.name);
    const healthy = outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.name);

    if (failed.length === 0) {
      return { id, label, status: "green", message: `${healthy.join(" and ")} responded to a read call.` };
    }
    if (healthy.length === 0) {
      return { id, label, status: "red", message: `${failed.join(" and ")} did not respond to a read call.` };
    }
    return {
      id,
      label,
      status: "amber",
      message: `${failed.join(" and ")} did not respond; ${healthy.join(" and ")} is healthy.`,
    };
  } catch {
    return { id, label, status: "red", message: "On-chain contracts health check failed unexpectedly." };
  }
}

export function contractsClient(chainId: number, rpcUrl: string | undefined) {
  const resolvedRpcUrl = rpcUrl ?? ROBINHOOD_TESTNET.rpcUrls[0];
  return createPublicClient({
    chain: {
      id: chainId,
      name: "Robinhood Chain Testnet",
      nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
      rpcUrls: { default: { http: [resolvedRpcUrl] } },
    },
    transport: http(resolvedRpcUrl),
  });
}

/**
 * Reports whether the current server process is a healthy deployment. If
 * this code is executing at all, the process serving the request is up; the
 * check's job is to flag when production is missing the Vercel deployment
 * metadata it should always have.
 */
export function checkDeploymentHealth(
  env: Record<string, string | undefined> = process.env,
): SystemHealthCheck {
  const id = "deployment" as const;
  const label = "Deployment";
  try {
    if (env.NODE_ENV !== "production") {
      return { id, label, status: "green", message: "Local development server is running." };
    }
    const vercelEnv = env.VERCEL_ENV?.trim();
    if (!vercelEnv) {
      return {
        id,
        label,
        status: "red",
        message: "Production runtime is missing Vercel deployment metadata (VERCEL_ENV unset).",
      };
    }
    const commit = env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7);
    return {
      id,
      label,
      status: "green",
      message: commit ? `Live on ${vercelEnv} (commit ${commit}).` : `Live on ${vercelEnv}.`,
    };
  } catch {
    return { id, label, status: "red", message: "Deployment health check failed unexpectedly." };
  }
}

export type SubscribersPing = () => Promise<unknown>;

/** Reports whether the `subscriptions` table backing the admin Subscribers section is reachable. */
export async function checkSubscribersHealth(deps: {
  databaseUrl?: string;
  ping?: SubscribersPing;
} = {}): Promise<SystemHealthCheck> {
  const id = "subscribers" as const;
  const label = "Subscribers";
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl && !deps.ping) {
    return { id, label, status: "amber", message: "DATABASE_URL is not configured." };
  }
  const ping = deps.ping ?? (() => getPostgresPool(databaseUrl).query("SELECT 1 FROM subscriptions LIMIT 1"));
  try {
    await withTimeout(ping(), HEALTH_CHECK_TIMEOUT_MS, "Subscribers table health check timed out.");
    return { id, label, status: "green", message: "The subscriptions table is reachable." };
  } catch {
    return {
      id,
      label,
      status: "red",
      message: "The subscriptions table is not reachable. Apply migration 007_subscriptions.sql.",
    };
  }
}

export type ChatTablePing = () => Promise<unknown>;

async function checkChatTableHealth(
  id: "hoodchat" | "token-chat",
  label: string,
  tableName: string,
  deps: { databaseUrl?: string; ping?: ChatTablePing } = {},
): Promise<SystemHealthCheck> {
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl && !deps.ping) {
    return { id, label, status: "amber", message: "DATABASE_URL is not configured." };
  }
  const ping = deps.ping ?? (() => getPostgresPool(databaseUrl).query(`SELECT 1 FROM ${tableName} LIMIT 1`));
  try {
    await withTimeout(ping(), HEALTH_CHECK_TIMEOUT_MS, `${label} health check timed out.`);
    return { id, label, status: "green", message: `The ${tableName} table is reachable.` };
  } catch {
    return {
      id,
      label,
      status: "red",
      message: `The ${tableName} table is not reachable. Apply the migration that creates it.`,
    };
  }
}

/** Reports whether the `hoodchat_messages` table backing the main /hoodchat feed is reachable. */
export async function checkHoodchatHealth(deps: { databaseUrl?: string; ping?: ChatTablePing } = {}): Promise<SystemHealthCheck> {
  return checkChatTableHealth("hoodchat", "Hoodchat", "hoodchat_messages", deps);
}

/** Reports whether the `token_chat_messages` table backing the per-token chat tab is reachable. */
export async function checkTokenChatHealth(deps: { databaseUrl?: string; ping?: ChatTablePing } = {}): Promise<SystemHealthCheck> {
  return checkChatTableHealth("token-chat", "Token chat", "token_chat_messages", deps);
}

export type OutreachPing = () => Promise<unknown>;

/**
 * Reports whether the `outreach_queue_items` table backing the dormant X
 * outreach bot (issue #298) is reachable, and surfaces the
 * OUTREACH_QUEUE_ENABLED flag state (never the X_OUTREACH_* secret values —
 * just "configured"/"not configured" is left to the pipeline drill-down).
 */
export async function checkOutreachHealth(
  deps: { databaseUrl?: string; ping?: OutreachPing; env?: Record<string, string | undefined> } = {},
): Promise<SystemHealthCheck> {
  const id = "outreach" as const;
  const label = "Outreach";
  const env = deps.env ?? process.env;
  const queueEnabled = (env.OUTREACH_QUEUE_ENABLED || "").trim() === "true";
  const flagNote = queueEnabled ? "Queue flag is on." : "Queue flag is off (dormant).";

  const databaseUrl = deps.databaseUrl ?? env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl && !deps.ping) {
    return { id, label, status: "amber", message: `DATABASE_URL is not configured. ${flagNote}` };
  }
  const ping = deps.ping ?? (() => getPostgresPool(databaseUrl).query(`SELECT 1 FROM outreach_queue_items LIMIT 1`));
  try {
    await withTimeout(ping(), HEALTH_CHECK_TIMEOUT_MS, "Outreach health check timed out.");
    return { id, label, status: "green", message: `The outreach_queue_items table is reachable. ${flagNote}` };
  } catch {
    return {
      id,
      label,
      status: "red",
      message: `The outreach_queue_items table is not reachable. Apply migration 013_outreach.sql. ${flagNote}`,
    };
  }
}

/**
 * Reports whether an AI generation provider is configured and whether the
 * shared-secret protection guarding every AI Social Studio route
 * (voice-profile, draft, mascot visual-DNA, mascot image) is set up — mirrors
 * `checkWebsiteGenerationHealth` in shape. Entitlement (Pro/Pro Bundle) is
 * decided per-request from the `subscriptions` table already covered by the
 * `database` check, so it is not re-probed here.
 */
export function checkSocialStudioAiHealth(
  env: Record<string, string | undefined> = process.env,
  requestOidcToken = "",
): SystemHealthCheck {
  const id = "social-studio-ai" as const;
  const label = "AI Social Studio";
  try {
    const runtime = resolveAIResponsesRuntime(env, requestOidcToken);
    if (!runtime) {
      return { id, label, status: "amber", message: "No AI generation provider is configured." };
    }
    const secretConfigured = Boolean((env.GENERATE_SITE_STYLE_SHARED_SECRET || "").trim());
    if (!secretConfigured) {
      return {
        id,
        label,
        status: "amber",
        message: `Ready via ${runtime.source} (${runtime.model}), but GENERATE_SITE_STYLE_SHARED_SECRET is not set — every route rejects requests outside test mode.`,
      };
    }
    const imageGenerationReady = runtime.source === "openai";
    return {
      id,
      label,
      status: "green",
      message: imageGenerationReady
        ? `Ready via ${runtime.source} (${runtime.model}). Mascot image generation is available.`
        : `Ready via ${runtime.source} (${runtime.model}). Voice profile and draft text generation are available; mascot image generation needs a direct OPENAI_API_KEY and is unavailable through this gateway fallback.`,
    };
  } catch {
    return { id, label, status: "red", message: "AI Social Studio health check failed unexpectedly." };
  }
}

export type SocialPostingPing = () => Promise<{
  lastSucceededAt: Date | string | null;
}>;

export const SOCIAL_POSTING_CRON_GREEN_MAX_AGE_MS = 3 * 60 * 1000;
export const SOCIAL_POSTING_CRON_RED_AGE_MS = 10 * 60 * 1000;

export type SocialPostingCronFreshness = {
  status: SystemHealthStatus;
  message: string;
  observedAt: string | null;
};

export function evaluateSocialPostingCronFreshness(
  lastSucceededAt: Date | string | null,
  now = new Date(),
): SocialPostingCronFreshness {
  if (!lastSucceededAt) {
    return {
      status: "amber",
      message: "The social-posting cron has not completed successfully yet.",
      observedAt: null,
    };
  }

  const observed = new Date(
    lastSucceededAt instanceof Date ? lastSucceededAt.getTime() : lastSucceededAt,
  );
  if (Number.isNaN(observed.getTime())) {
    return {
      status: "red",
      message: "The stored social-posting cron heartbeat is invalid.",
      observedAt: null,
    };
  }

  const observedAt = observed.toISOString();
  const ageMs = now.getTime() - observed.getTime();
  if (ageMs < -60_000) {
    return {
      status: "amber",
      message: `The last successful cron heartbeat (${observedAt}) is in the future; check server clocks.`,
      observedAt,
    };
  }

  const ageMinutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (ageMs <= SOCIAL_POSTING_CRON_GREEN_MAX_AGE_MS) {
    return {
      status: "green",
      message: `The cron last completed successfully ${ageMinutes} minute(s) ago (${observedAt}).`,
      observedAt,
    };
  }
  if (ageMs <= SOCIAL_POSTING_CRON_RED_AGE_MS) {
    return {
      status: "amber",
      message: `The cron has not completed successfully for ${ageMinutes} minutes (last: ${observedAt}).`,
      observedAt,
    };
  }
  return {
    status: "red",
    message: `The cron is stale: no successful completion for ${ageMinutes} minutes (last: ${observedAt}).`,
    observedAt,
  };
}

/**
 * Reports whether the Social Studio posting queue and the constant-size cron
 * heartbeat are reachable, plus destination configuration. No external X or
 * Telegram call is made.
 */
export async function checkSocialPostingHealth(
  deps: {
    databaseUrl?: string;
    ping?: SocialPostingPing;
    env?: Record<string, string | undefined>;
    now?: Date;
  } = {},
): Promise<SystemHealthCheck> {
  const id = "social-posting" as const;
  const label = "Social Studio posting";
  const env = deps.env ?? process.env;
  const xConfigured = Boolean((env.X_SOCIAL_CONSUMER_KEY || "").trim() && (env.X_SOCIAL_CONSUMER_SECRET || "").trim());
  const telegramConfigured = Boolean((env.TELEGRAM_BOT_TOKEN || "").trim());
  const destinationNote = xConfigured && telegramConfigured
    ? "X and Telegram are both configured."
    : xConfigured
      ? "Only X is configured; Telegram is dormant (TELEGRAM_BOT_TOKEN unset)."
      : telegramConfigured
        ? "Only Telegram is configured; X is dormant (X_SOCIAL_CONSUMER_KEY/SECRET unset)."
        : "Dormant: neither X nor Telegram is configured.";

  const databaseUrl = deps.databaseUrl ?? env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl && !deps.ping) {
    return { id, label, status: "amber", message: `DATABASE_URL is not configured. ${destinationNote}` };
  }

  const ping = deps.ping ?? (async () => {
    const pool = getPostgresPool(databaseUrl);
    await pool.query(`SELECT 1 FROM social_scheduled_posts LIMIT 1`);
    const heartbeat = await pool.query<{ last_succeeded_at: Date | string | null }>(
      `SELECT last_succeeded_at
         FROM scheduled_job_heartbeats
        WHERE job_key = $1`,
      ["social-posting"],
    );
    return { lastSucceededAt: heartbeat.rows[0]?.last_succeeded_at ?? null };
  });

  try {
    const { lastSucceededAt } = await withTimeout(
      ping(),
      HEALTH_CHECK_TIMEOUT_MS,
      "Social posting health check timed out.",
    );
    const freshness = evaluateSocialPostingCronFreshness(lastSucceededAt, deps.now ?? new Date());
    const status = freshness.status === "green" && !(xConfigured || telegramConfigured)
      ? "amber"
      : freshness.status;
    return {
      id,
      label,
      status,
      message: `The posting queue and heartbeat are reachable. ${destinationNote} ${freshness.message}`,
    };
  } catch {
    return {
      id,
      label,
      status: "red",
      message: `The posting queue or cron heartbeat is not reachable. Apply migrations 018_social_studio_connections.sql and 023_scheduled_job_heartbeats.sql. ${destinationNote}`,
    };
  }
}

export type ClientErrorsPing = () => Promise<{ newGroupCount: number }>;

/**
 * A "new group" is a (message, route_path) pair whose very first-ever
 * occurrence fell inside the given window — a genuinely fresh crash, not
 * just one that happened to fire again recently. Kept red/amber at the
 * summary-card level (not just in the pipeline drill-down) so a fresh
 * client-side crash is visible at a glance rather than requiring a click-in.
 */
async function countNewClientErrorGroups(
  pool: { query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[] }> },
  since: Date,
): Promise<number> {
  const result = await pool.query<{ count: number | string }>(
    `SELECT COUNT(*)::int AS count FROM (
       SELECT message, route_path FROM client_errors
        GROUP BY message, route_path
       HAVING MIN(created_at) >= $1
     ) AS new_groups`,
    [since],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export const CLIENT_ERRORS_RED_THRESHOLD = 3;

/** Reports whether the `client_errors` table is reachable, and how many new error groups appeared in the last 24h. */
export async function checkClientErrorsHealth(deps: {
  databaseUrl?: string;
  ping?: ClientErrorsPing;
  now?: Date;
} = {}): Promise<SystemHealthCheck> {
  const id = "client-errors" as const;
  const label = "Client errors";
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl && !deps.ping) {
    return { id, label, status: "amber", message: "DATABASE_URL is not configured." };
  }
  const since = new Date((deps.now ?? new Date()).getTime() - 24 * 60 * 60 * 1000);
  const ping = deps.ping ?? (async () => ({ newGroupCount: await countNewClientErrorGroups(getPostgresPool(databaseUrl), since) }));
  try {
    const { newGroupCount } = await withTimeout(ping(), HEALTH_CHECK_TIMEOUT_MS, "Client errors health check timed out.");
    if (newGroupCount === 0) {
      return { id, label, status: "green", message: "No new client error groups in the last 24 hours." };
    }
    if (newGroupCount < CLIENT_ERRORS_RED_THRESHOLD) {
      return { id, label, status: "amber", message: `${newGroupCount} new client error group(s) appeared in the last 24 hours.` };
    }
    return { id, label, status: "red", message: `${newGroupCount} new client error groups appeared in the last 24 hours.` };
  } catch {
    return {
      id,
      label,
      status: "red",
      message: "The client_errors table is not reachable. Apply migration 021_client_errors.sql.",
    };
  }
}

export type OperationsCostPing = () => Promise<{ totalCostUsd: number }>;

/**
 * Reports this month's estimated variable (AI+X) + prorated fixed operating
 * cost against the configured amber/red thresholds (issue #368). Makes no
 * paid external call — only reads already-recorded cost rows and the fixed
 * operating cost list.
 */
export async function checkOperationsCostHealth(deps: {
  databaseUrl?: string;
  ping?: OperationsCostPing;
  env?: Record<string, string | undefined>;
  now?: Date;
} = {}): Promise<SystemHealthCheck> {
  const id = "operations-cost" as const;
  const label = "Operations cost";
  const env = deps.env ?? process.env;
  const thresholds = readOperationsCostThresholds(env);

  const databaseUrl = deps.databaseUrl ?? env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl && !deps.ping) {
    return {
      id,
      label,
      status: "red",
      message: "DATABASE_URL is not configured, so operations cost tables cannot be read.",
    };
  }

  const ping =
    deps.ping ??
    (async () => {
      const now = deps.now ?? new Date();
      const monthStart = utcMonthBounds(now).start;
      const pool = getPostgresPool(databaseUrl);
      const [aiResult, xResult, fixedCosts] = await Promise.all([
        pool.query<{ total: string | null }>(
          `SELECT COALESCE(SUM(estimated_cost_usd), 0)::text AS total FROM ai_operation_costs WHERE occurred_at >= $1`,
          [monthStart],
        ),
        pool.query<{ total: string | null }>(
          `SELECT COALESCE(SUM(cost_usd), 0)::text AS total FROM social_x_send_costs WHERE sent_at >= $1`,
          [monthStart],
        ),
        getFixedOperatingCostsStore().list(),
      ]);
      const aiCostUsd = Number.parseFloat(aiResult.rows[0]?.total || "0") || 0;
      const xCostUsd = Number.parseFloat(xResult.rows[0]?.total || "0") || 0;
      const monthlyEquivalentTotalUsd = fixedCosts.reduce((sum, cost) => sum + monthlyEquivalentUsd(cost.amountUsd, cost.cadence), 0);
      const fixedCostUsd = proratedFixedCostForThisMonthSoFar(monthlyEquivalentTotalUsd, now);
      return { totalCostUsd: aiCostUsd + xCostUsd + fixedCostUsd };
    });

  // Storage reachability is checked before threshold validity: a red "the
  // tables can't be read" must never be masked by an amber "thresholds are
  // misconfigured" message (issue #368 correction pass).
  let totalCostUsd: number;
  try {
    ({ totalCostUsd } = await withTimeout(ping(), HEALTH_CHECK_TIMEOUT_MS, "Operations cost health check timed out."));
  } catch {
    return {
      id,
      label,
      status: "red",
      message: "Operations cost tables are not reachable. Apply migration 022_operations_costs.sql.",
    };
  }

  if (!thresholds.valid) {
    return { id, label, status: "amber", message: thresholds.message };
  }

  const status: SystemHealthStatus =
    totalCostUsd >= thresholds.redUsd ? "red" : totalCostUsd >= thresholds.amberUsd ? "amber" : "green";
  return {
    id,
    label,
    status,
    message: `This month's estimated operating cost so far is $${totalCostUsd.toFixed(2)} (amber at $${thresholds.amberUsd.toFixed(2)}, red at $${thresholds.redUsd.toFixed(2)}).`,
  };
}

export type ContentFilterPing = () => Promise<{ rejections24h: number }>;

/**
 * Reports that the content filter (issue #392) is loaded, its term-list
 * size/category count, and how many rejections it has recorded in the last
 * 24 hours (read from `admin_activity_log`, the same "kind" every
 * enforcement point writes to). The filter itself is an in-process module
 * with no external dependency, so this check is green even without a
 * database — only the rejection-count portion of the message degrades.
 */
export async function checkContentFilterHealth(deps: {
  databaseUrl?: string;
  ping?: ContentFilterPing;
  now?: Date;
} = {}): Promise<SystemHealthCheck> {
  const id = "content-filter" as const;
  const label = "Content filter";
  const loadedNote = `Filter loaded: ${CONTENT_FILTER_TERM_COUNT} terms across ${CONTENT_FILTER_CATEGORY_COUNT} categories.`;

  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl && !deps.ping) {
    return { id, label, status: "green", message: `${loadedNote} Rejection counts unavailable (DATABASE_URL not configured).` };
  }

  const since = new Date((deps.now ?? new Date()).getTime() - 24 * 60 * 60 * 1000);
  const ping =
    deps.ping ??
    (async () => {
      const result = await getPostgresPool(databaseUrl).query<{ count: number | string }>(
        `SELECT COUNT(*)::int AS count FROM admin_activity_log WHERE event_kind = $1 AND created_at >= $2`,
        ["content-filter-rejected", since],
      );
      return { rejections24h: Number(result.rows[0]?.count ?? 0) };
    });

  try {
    const { rejections24h } = await withTimeout(ping(), HEALTH_CHECK_TIMEOUT_MS, "Content filter health check timed out.");
    return { id, label, status: "green", message: `${loadedNote} ${rejections24h} rejection(s) in the last 24 hours.` };
  } catch {
    return { id, label, status: "amber", message: `${loadedNote} The rejection count could not be read.` };
  }
}

export type SupportHealthPing = () => Promise<{ openCount: number; oldestOpenAgeSeconds: number | null }>;

/**
 * Reports whether the `support_tickets` table is reachable, whether the
 * best-effort owner Telegram alert is configured, and the current open
 * queue size/age (issue #393). Makes no paid external call.
 */
export async function checkSupportHealth(deps: {
  databaseUrl?: string;
  ping?: SupportHealthPing;
  env?: Record<string, string | undefined>;
  now?: Date;
} = {}): Promise<SystemHealthCheck> {
  const id = "support" as const;
  const label = "Support tickets";
  const env = deps.env ?? process.env;
  const alertConfigured = Boolean((env.TELEGRAM_ADMIN_CHAT_ID || "").trim());
  const alertNote = alertConfigured
    ? "Owner Telegram alert is configured."
    : "Owner Telegram alert is not configured (TELEGRAM_ADMIN_CHAT_ID unset) — tickets still save, alerts are just skipped.";

  const databaseUrl = deps.databaseUrl ?? env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl && !deps.ping) {
    return { id, label, status: "red", message: `DATABASE_URL is not configured. ${alertNote}` };
  }

  const ping =
    deps.ping ??
    (async () => {
      const pool = getPostgresPool(databaseUrl);
      const [openResult, oldestResult] = await Promise.all([
        pool.query<{ count: number | string }>(
          `SELECT COUNT(*)::int AS count FROM support_tickets WHERE status IN ('open', 'needs_user')`,
        ),
        pool.query<{ created_at: Date | string | null }>(
          `SELECT created_at FROM support_tickets WHERE status IN ('open', 'needs_user') ORDER BY created_at ASC LIMIT 1`,
        ),
      ]);
      const openCount = Number(openResult.rows[0]?.count ?? 0);
      const createdAt = oldestResult.rows[0]?.created_at ?? null;
      const now = deps.now ?? new Date();
      const oldestOpenAgeSeconds = createdAt ? Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 1000)) : null;
      return { openCount, oldestOpenAgeSeconds };
    });

  try {
    const { openCount, oldestOpenAgeSeconds } = await withTimeout(ping(), HEALTH_CHECK_TIMEOUT_MS, "Support health check timed out.");
    const ageNote = oldestOpenAgeSeconds === null ? "No open tickets." : `Oldest open ticket is ${Math.floor(oldestOpenAgeSeconds / 3600)}h old.`;
    return { id, label, status: "green", message: `${openCount} open ticket(s). ${ageNote} ${alertNote}` };
  } catch {
    return {
      id,
      label,
      status: "red",
      message: `The support_tickets table is not reachable. Apply migration 025_support_tickets.sql. ${alertNote}`,
    };
  }
}

export type TokenLaunchesHealthPing = () => Promise<{ count24h: number }>;

/**
 * Reports whether HoodlumsCurveLaunchPipeline is configured for Robinhood
 * Chain Testnet (amber if not — the launch flow just falls back to the
 * token-only path, nothing is broken) and whether the `token_launches` table
 * is reachable, with a rolling 24h launch count (Milestone A, issue #409).
 */
export async function checkTokenLaunchesHealth(deps: {
  databaseUrl?: string;
  ping?: TokenLaunchesHealthPing;
  env?: Record<string, string | undefined>;
} = {}): Promise<SystemHealthCheck> {
  const id = "token-launches" as const;
  const label = "Token launches";
  const env = deps.env ?? process.env;
  const pipelineAddress = getCurveLaunchPipelineAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, env);
  const configNote = pipelineAddress
    ? `Curve launch pipeline ${pipelineAddress} configured.`
    : "Curve launch pipeline not configured (NEXT_PUBLIC_HOODLUMS_CURVE_LAUNCH_PIPELINE_ADDRESSES unset) — /testnet falls back to the token-only launch path.";

  const databaseUrl = deps.databaseUrl ?? env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl && !deps.ping) {
    return { id, label, status: "red", message: `DATABASE_URL is not configured. ${configNote}` };
  }

  const ping =
    deps.ping ??
    (async () => {
      const pool = getPostgresPool(databaseUrl);
      const result = await pool.query<{ count: number | string }>(
        `SELECT COUNT(*)::int AS count FROM token_launches WHERE launched_at >= NOW() - INTERVAL '24 hours'`,
      );
      return { count24h: Number(result.rows[0]?.count ?? 0) };
    });

  try {
    const { count24h } = await withTimeout(ping(), HEALTH_CHECK_TIMEOUT_MS, "Token launches health check timed out.");
    return {
      id,
      label,
      status: pipelineAddress ? "green" : "amber",
      message: `${count24h} launch(es) in the last 24 hours. ${configNote}`,
    };
  } catch {
    return {
      id,
      label,
      status: "red",
      message: `The token_launches table is not reachable. Apply migration 029_token_launches.sql. ${configNote}`,
    };
  }
}

export type SystemHealthDeps = {
  env?: Record<string, string | undefined>;
  requestOidcToken?: string;
  database?: Parameters<typeof checkDatabaseHealth>[0];
  contracts?: Parameters<typeof checkContractsHealth>[0];
  subscribers?: Parameters<typeof checkSubscribersHealth>[0];
  hoodchat?: Parameters<typeof checkHoodchatHealth>[0];
  tokenChat?: Parameters<typeof checkTokenChatHealth>[0];
  outreach?: Parameters<typeof checkOutreachHealth>[0];
  socialPosting?: Parameters<typeof checkSocialPostingHealth>[0];
  clientErrors?: Parameters<typeof checkClientErrorsHealth>[0];
  operationsCost?: Parameters<typeof checkOperationsCostHealth>[0];
  contentFilter?: Parameters<typeof checkContentFilterHealth>[0];
  support?: Parameters<typeof checkSupportHealth>[0];
  tokenLaunches?: Parameters<typeof checkTokenLaunchesHealth>[0];
};

/**
 * Runs every check concurrently. Each check function fully contains its own
 * failures (never rejects), so one failing/slow check can never take down
 * the others or the response as a whole.
 */
export async function getSystemHealth(deps: SystemHealthDeps = {}): Promise<SystemHealthCheck[]> {
  const [
    websiteGeneration,
    database,
    contracts,
    deployment,
    subscribers,
    hoodchat,
    tokenChat,
    outreach,
    socialStudioAi,
    socialPosting,
    clientErrors,
    operationsCost,
    contentFilter,
    support,
    tokenLaunches,
  ] = await Promise.all([
    checkWebsiteGenerationHealth(deps.env, deps.requestOidcToken),
    checkDatabaseHealth(deps.database),
    checkContractsHealth(deps.contracts),
    checkDeploymentHealth(deps.env),
    checkSubscribersHealth(deps.subscribers),
    checkHoodchatHealth(deps.hoodchat),
    checkTokenChatHealth(deps.tokenChat),
    checkOutreachHealth({ env: deps.env, ...deps.outreach }),
    checkSocialStudioAiHealth(deps.env, deps.requestOidcToken),
    checkSocialPostingHealth({ env: deps.env, ...deps.socialPosting }),
    checkClientErrorsHealth(deps.clientErrors),
    checkOperationsCostHealth({ env: deps.env, ...deps.operationsCost }),
    checkContentFilterHealth(deps.contentFilter),
    checkSupportHealth({ env: deps.env, ...deps.support }),
    checkTokenLaunchesHealth({ env: deps.env, ...deps.tokenLaunches }),
  ]);
  return [
    websiteGeneration,
    database,
    contracts,
    deployment,
    subscribers,
    hoodchat,
    tokenChat,
    outreach,
    socialStudioAi,
    socialPosting,
    clientErrors,
    operationsCost,
    contentFilter,
    support,
    tokenLaunches,
  ];
}
