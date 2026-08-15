import type { PublicClient } from "viem";
import type {
  AdminPipelineStage,
  AdminServiceControl,
  AdminServiceKey,
  AdminServicePipeline,
  SystemHealthCheckId,
} from "@/lib/admin-operations";
import { getBondingCurveAddress, HOODLUMS_BONDING_CURVE_READ_ABI } from "@/lib/bonding-curve-config";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getFactoryAddress, HOODLUMS_TOKEN_FACTORY_ABI } from "@/lib/factory-config";
import { resolveAIResponsesRuntime } from "@/lib/server/ai-responses-runtime";
import {
  GENERATE_SITE_STYLE_LIMIT,
  GENERATE_SITE_STYLE_WINDOW_MS,
  SOCIAL_DRAFT_LIMIT,
  SOCIAL_MASCOT_DNA_LIMIT,
  SOCIAL_MASCOT_IMAGE_LIMIT,
  SOCIAL_STUDIO_WINDOW_MS,
  SOCIAL_VOICE_PROFILE_LIMIT,
} from "@/lib/server/api-protection";
import { getAdminOperationsStore } from "@/lib/server/admin-operations-store";
import { getPostgresPool } from "@/lib/server/postgres";
import { contractsClient, HEALTH_CHECK_TIMEOUT_MS, withTimeout } from "@/lib/server/system-health";

type PoolLike = {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
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

// ---------------------------------------------------------------------------
// Website generation
// ---------------------------------------------------------------------------

export type WebsiteGenerationPipelineDeps = {
  env?: Record<string, string | undefined>;
  requestOidcToken?: string;
  getServiceControl?: (key: AdminServiceKey) => Promise<AdminServiceControl>;
  fetchImpl?: typeof fetch;
};

function providerConfiguredStage(env: Record<string, string | undefined>, requestOidcToken: string): AdminPipelineStage {
  try {
    const runtime = resolveAIResponsesRuntime(env, requestOidcToken);
    if (!runtime) {
      return stage(
        "provider-configured",
        "Provider configured",
        "amber",
        "No AI generation provider is configured (no OpenAI key, Gateway key, or Vercel OIDC token/header).",
      );
    }
    return stage(
      "provider-configured",
      "Provider configured",
      "green",
      `Ready via ${runtime.source} (${runtime.model}).`,
    );
  } catch {
    return stage("provider-configured", "Provider configured", "red", "Provider configuration check failed unexpectedly.");
  }
}

async function endpointReachableStage(
  getServiceControl: (key: AdminServiceKey) => Promise<AdminServiceControl>,
): Promise<AdminPipelineStage> {
  const id = "endpoint-reachable";
  const label = "Endpoint reachable";
  try {
    const control = await getServiceControl("website-generation");
    if (control.isolated) {
      return stage(
        id,
        label,
        "amber",
        `Isolated by an administrator: ${control.reason || "no reason given"}.`,
        control.updatedAt,
      );
    }
    return stage(id, label, "green", "Not isolated; the endpoint accepts requests.", control.updatedAt);
  } catch {
    return stage(
      id,
      label,
      "amber",
      "Isolation state could not be read; the circuit breaker fails open and requests are treated as reachable.",
    );
  }
}

function originCheckStage(env: Record<string, string | undefined>): AdminPipelineStage {
  const secret = (env.GENERATE_SITE_STYLE_SHARED_SECRET || "").trim();
  const bridge = (env.NEXT_PUBLIC_GENERATE_SITE_STYLE_SHARED_SECRET || "").trim();
  const allowedOrigin = (env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN || "").trim() || "https://hoodlums.dev";

  if (!secret) {
    const productionLike = env.NODE_ENV === "production";
    return stage(
      "origin-check",
      "Shared-secret / origin check",
      productionLike ? "red" : "amber",
      productionLike
        ? "GENERATE_SITE_STYLE_SHARED_SECRET is not set; generation requests are rejected in production."
        : "GENERATE_SITE_STYLE_SHARED_SECRET is not set; protection is bypassed outside production.",
    );
  }

  if (bridge !== secret) {
    return stage(
      "origin-check",
      "Shared-secret / origin check",
      "amber",
      "The server secret and the NEXT_PUBLIC_ bridge value do not match; the browser client will be rejected by the origin check.",
    );
  }

  return stage(
    "origin-check",
    "Shared-secret / origin check",
    "green",
    `Shared-secret and origin protection are configured (allowed origin: ${allowedOrigin}).`,
  );
}

function rateLimiterStage(env: Record<string, string | undefined>): AdminPipelineStage {
  const secret = (env.GENERATE_SITE_STYLE_SHARED_SECRET || "").trim();
  if (!secret) {
    return stage(
      "rate-limiter",
      "Rate limiter",
      "amber",
      "Rate limiting only applies once shared-secret protection is enabled.",
    );
  }
  const windowMinutes = Math.round(GENERATE_SITE_STYLE_WINDOW_MS / 60_000);
  return stage(
    "rate-limiter",
    "Rate limiter",
    "green",
    `Configured: ${GENERATE_SITE_STYLE_LIMIT} requests per ${windowMinutes} minutes, per IP.`,
  );
}

async function providerReachableStage(
  env: Record<string, string | undefined>,
  requestOidcToken: string,
  fetchImpl: typeof fetch,
): Promise<AdminPipelineStage> {
  let runtime;
  try {
    runtime = resolveAIResponsesRuntime(env, requestOidcToken);
  } catch {
    runtime = null;
  }
  if (!runtime) {
    return stage(
      "provider-reachable",
      "AI provider reachable",
      "amber",
      "Not probed: no provider credentials are configured.",
    );
  }

  const origin = new URL(runtime.responsesUrl).origin;
  try {
    const response = await withTimeout(
      fetchImpl(origin, { method: "HEAD" }),
      HEALTH_CHECK_TIMEOUT_MS,
      "Provider reachability probe timed out.",
    );
    return stage(
      "provider-reachable",
      "AI provider reachable",
      "green",
      `${origin} responded (HTTP ${response.status}) to a lightweight network probe. No generation request or tokens were sent.`,
    );
  } catch {
    return stage(
      "provider-reachable",
      "AI provider reachable",
      "red",
      `${origin} did not respond to a lightweight network probe.`,
    );
  }
}

function lastGenerationOutcomeStage(): AdminPipelineStage {
  return stage(
    "last-generation-outcome",
    "Last generation outcome",
    "amber",
    "Not recorded. Individual generation outcomes are not persisted to logs or the database yet.",
  );
}

function responseValidationStage(): AdminPipelineStage {
  return stage(
    "response-validation",
    "Response validation",
    "amber",
    "Not recorded. Validation runs in-process for every generation attempt, but outcomes are not persisted yet.",
  );
}

export async function buildWebsiteGenerationPipeline(
  deps: WebsiteGenerationPipelineDeps = {},
): Promise<AdminServicePipeline> {
  const env = deps.env ?? process.env;
  const requestOidcToken = deps.requestOidcToken ?? "";
  const getServiceControl =
    deps.getServiceControl ?? ((key: AdminServiceKey) => getAdminOperationsStore().getServiceControl(key));
  const fetchImpl = deps.fetchImpl ?? fetch;

  const [endpointReachable, providerReachable] = await Promise.all([
    endpointReachableStage(getServiceControl),
    providerReachableStage(env, requestOidcToken, fetchImpl),
  ]);

  return {
    id: "website-generation",
    label: "Website generation",
    stages: [
      providerConfiguredStage(env, requestOidcToken),
      endpointReachable,
      originCheckStage(env),
      rateLimiterStage(env),
      providerReachable,
      lastGenerationOutcomeStage(),
      responseValidationStage(),
    ],
  };
}

// ---------------------------------------------------------------------------
// AI Social Studio (issue #332)
// ---------------------------------------------------------------------------

export type SocialStudioAiPipelineDeps = {
  env?: Record<string, string | undefined>;
  requestOidcToken?: string;
  getServiceControl?: (key: AdminServiceKey) => Promise<AdminServiceControl>;
};

function socialStudioEntitlementStage(env: Record<string, string | undefined>): AdminPipelineStage {
  const databaseUrl = (env.DATABASE_URL || "").trim();
  return stage(
    "entitlement-configured",
    "Entitlement check (subscriptions table)",
    databaseUrl ? "green" : "red",
    databaseUrl
      ? "DATABASE_URL is configured; every route re-checks the wallet's Pro/Pro Bundle subscription before spending AI tokens."
      : "DATABASE_URL is not configured; every route fails closed with a 503 rather than skip the entitlement check.",
  );
}

function socialStudioRateLimiterStage(env: Record<string, string | undefined>): AdminPipelineStage {
  const secret = (env.GENERATE_SITE_STYLE_SHARED_SECRET || "").trim();
  if (!secret) {
    return stage(
      "rate-limiter",
      "Rate limiter",
      "amber",
      "Rate limiting only applies once shared-secret protection is enabled.",
    );
  }
  const windowMinutes = Math.round(SOCIAL_STUDIO_WINDOW_MS / 60_000);
  return stage(
    "rate-limiter",
    "Rate limiter",
    "green",
    `Configured per IP per ${windowMinutes} minutes: voice-profile ${SOCIAL_VOICE_PROFILE_LIMIT}, draft ${SOCIAL_DRAFT_LIMIT}, mascot analysis ${SOCIAL_MASCOT_DNA_LIMIT}, mascot image ${SOCIAL_MASCOT_IMAGE_LIMIT}.`,
  );
}

function socialStudioImageProviderStage(env: Record<string, string | undefined>, requestOidcToken: string): AdminPipelineStage {
  const runtime = resolveAIResponsesRuntime(env, requestOidcToken);
  if (!runtime) {
    return stage("mascot-image-provider", "Mascot image provider", "amber", "No AI generation provider is configured.");
  }
  if (runtime.source === "openai") {
    const imageModel = (env.OPENAI_IMAGE_MODEL || "").trim() || "gpt-image-1";
    return stage("mascot-image-provider", "Mascot image provider", "green", `Direct OpenAI key configured; images call ${imageModel}.`);
  }
  return stage(
    "mascot-image-provider",
    "Mascot image provider",
    "amber",
    "Only the Vercel AI Gateway fallback is configured; mascot image generation needs a direct OPENAI_API_KEY and returns 503 until then. Voice profile and draft text generation are unaffected.",
  );
}

export async function buildSocialStudioAiPipeline(deps: SocialStudioAiPipelineDeps = {}): Promise<AdminServicePipeline> {
  const env = deps.env ?? process.env;
  const requestOidcToken = deps.requestOidcToken ?? "";
  const getServiceControl =
    deps.getServiceControl ?? ((key: AdminServiceKey) => getAdminOperationsStore().getServiceControl(key));

  const isolationStage = await chatIsolationStage("social-studio-ai", getServiceControl);

  return {
    id: "social-studio-ai",
    label: "AI Social Studio",
    stages: [
      providerConfiguredStage(env, requestOidcToken),
      isolationStage,
      originCheckStage(env),
      socialStudioRateLimiterStage(env),
      socialStudioEntitlementStage(env),
      socialStudioImageProviderStage(env, requestOidcToken),
    ],
  };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const REQUIRED_TABLES = ["published_sites", "wallet_nonces", "admin_sessions", "admin_service_controls"];

export type DatabasePipelineDeps = {
  databaseUrl?: string;
  getPool?: (databaseUrl: string) => PoolLike;
};

export async function buildDatabasePipeline(deps: DatabasePipelineDeps = {}): Promise<AdminServicePipeline> {
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    const message = "DATABASE_URL is not configured.";
    return {
      id: "database",
      label: "Database",
      stages: [
        stage("connection", "Connection", "amber", message),
        stage("pool-state", "Pool state", "amber", message),
        stage("tables", "Critical tables", "amber", message),
        stage("last-read-write", "Last successful read/write", "amber", message),
      ],
    };
  }

  const pool = (deps.getPool ?? ((url: string) => getPostgresPool(url) as unknown as PoolLike))(databaseUrl);

  let connectionStage: AdminPipelineStage;
  try {
    await withTimeout(pool.query("SELECT 1"), HEALTH_CHECK_TIMEOUT_MS, "timed out");
    connectionStage = stage("connection", "Connection", "green", "Postgres connection is alive.");
  } catch {
    connectionStage = stage("connection", "Connection", "red", "Postgres connection failed.");
  }

  const poolStage = stage(
    "pool-state",
    "Pool state",
    "green",
    `${pool.totalCount ?? 0} total, ${pool.idleCount ?? 0} idle, ${pool.waitingCount ?? 0} waiting connection(s) in this instance's pool.`,
  );

  let tablesStage: AdminPipelineStage;
  try {
    const result = await withTimeout(
      pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [REQUIRED_TABLES],
      ),
      HEALTH_CHECK_TIMEOUT_MS,
      "timed out",
    );
    const present = new Set(result.rows.map((row) => row.table_name));
    const missing = REQUIRED_TABLES.filter((name) => !present.has(name));
    tablesStage =
      missing.length === 0
        ? stage("tables", "Critical tables", "green", `All ${REQUIRED_TABLES.length} critical tables exist.`)
        : stage("tables", "Critical tables", "red", `Missing table(s): ${missing.join(", ")}.`);
  } catch {
    tablesStage = stage("tables", "Critical tables", "red", "Critical-table check failed.");
  }

  let lastReadWriteStage: AdminPipelineStage;
  try {
    const result = await withTimeout(
      pool.query<{ last_write: Date | string | null }>(`SELECT MAX(created_at) AS last_write FROM admin_activity_log`),
      HEALTH_CHECK_TIMEOUT_MS,
      "timed out",
    );
    const rawLastWrite = result.rows[0]?.last_write ?? null;
    const lastWrite = rawLastWrite ? new Date(rawLastWrite).toISOString() : null;
    lastReadWriteStage = stage(
      "last-read-write",
      "Last successful read/write",
      "green",
      lastWrite
        ? `Read succeeded just now. Last recorded write: ${lastWrite}.`
        : "Read succeeded just now. No write has been recorded in the activity log yet.",
      lastWrite,
    );
  } catch {
    lastReadWriteStage = stage(
      "last-read-write",
      "Last successful read/write",
      "amber",
      "Read succeeded just now, but the last-write lookup failed (the admin_activity_log table may be missing the latest migration).",
    );
  }

  return {
    id: "database",
    label: "Database",
    stages: [connectionStage, poolStage, tablesStage, lastReadWriteStage],
  };
}

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

export type SubscribersPipelineDeps = {
  databaseUrl?: string;
  getPool?: (databaseUrl: string) => PoolLike;
};

export async function buildSubscribersPipeline(deps: SubscribersPipelineDeps = {}): Promise<AdminServicePipeline> {
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    const message = "DATABASE_URL is not configured.";
    return {
      id: "subscribers",
      label: "Subscribers",
      stages: [
        stage("table-exists", "subscriptions table exists", "amber", message),
        stage("read-query", "Subscribers read query", "amber", message),
        stage("row-count", "Subscriber row count", "amber", message),
      ],
    };
  }

  const pool = (deps.getPool ?? ((url: string) => getPostgresPool(url) as unknown as PoolLike))(databaseUrl);

  let tableExists = false;
  let tableExistsStage: AdminPipelineStage;
  try {
    const result = await withTimeout(
      pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'subscriptions'`,
      ),
      HEALTH_CHECK_TIMEOUT_MS,
      "timed out",
    );
    tableExists = result.rows.length > 0;
    tableExistsStage = tableExists
      ? stage("table-exists", "subscriptions table exists", "green", "The subscriptions table is present.")
      : stage(
          "table-exists",
          "subscriptions table exists",
          "red",
          "Migration 007_subscriptions.sql has not been applied yet.",
        );
  } catch {
    tableExistsStage = stage(
      "table-exists",
      "subscriptions table exists",
      "red",
      "Could not check whether the subscriptions table exists.",
    );
  }

  let readQueryStage: AdminPipelineStage;
  let rowCountStage: AdminPipelineStage;
  if (!tableExists) {
    readQueryStage = stage(
      "read-query",
      "Subscribers read query",
      "amber",
      "Not probed; the subscriptions table does not exist yet.",
    );
    rowCountStage = stage(
      "row-count",
      "Subscriber row count",
      "amber",
      "Not probed; the subscriptions table does not exist yet.",
    );
  } else {
    try {
      const result = await withTimeout(
        pool.query<{ count: number | string }>(`SELECT COUNT(*)::int AS count FROM subscriptions`),
        HEALTH_CHECK_TIMEOUT_MS,
        "timed out",
      );
      const count = Number(result.rows[0]?.count ?? 0);
      readQueryStage = stage("read-query", "Subscribers read query", "green", "The subscribers read query succeeded.");
      rowCountStage =
        count === 0
          ? stage(
              "row-count",
              "Subscriber row count",
              "green",
              `0 subscriber rows. The dashboard shows "No subscribers yet", not an error.`,
            )
          : stage("row-count", "Subscriber row count", "green", `${count} subscriber row(s).`);
    } catch {
      readQueryStage = stage("read-query", "Subscribers read query", "red", "The subscribers read query failed.");
      rowCountStage = stage("row-count", "Subscriber row count", "red", "Could not count subscriber rows.");
    }
  }

  return {
    id: "subscribers",
    label: "Subscribers",
    stages: [tableExistsStage, readQueryStage, rowCountStage],
  };
}

// ---------------------------------------------------------------------------
// Hoodchat / token chat
// ---------------------------------------------------------------------------

export type ChatPipelineDeps = {
  databaseUrl?: string;
  getPool?: (databaseUrl: string) => PoolLike;
  getServiceControl?: (key: AdminServiceKey) => Promise<AdminServiceControl>;
};

async function chatIsolationStage(
  serviceKey: AdminServiceKey,
  getServiceControl: (key: AdminServiceKey) => Promise<AdminServiceControl>,
): Promise<AdminPipelineStage> {
  const id = "endpoint-reachable";
  const label = "Endpoint reachable";
  try {
    const control = await getServiceControl(serviceKey);
    if (control.isolated) {
      return stage(
        id,
        label,
        "amber",
        `Isolated by an administrator: ${control.reason || "no reason given"}.`,
        control.updatedAt,
      );
    }
    return stage(id, label, "green", "Not isolated; the endpoint accepts requests.", control.updatedAt);
  } catch {
    return stage(
      id,
      label,
      "amber",
      "Isolation state could not be read; the circuit breaker fails open and requests are treated as reachable.",
    );
  }
}

async function buildChatPipeline(
  id: Extract<SystemHealthCheckId, "hoodchat" | "token-chat">,
  label: string,
  tableName: string,
  serviceKey: AdminServiceKey,
  deps: ChatPipelineDeps,
): Promise<AdminServicePipeline> {
  const getServiceControl =
    deps.getServiceControl ?? ((key: AdminServiceKey) => getAdminOperationsStore().getServiceControl(key));
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";

  const isolationStage = await chatIsolationStage(serviceKey, getServiceControl);

  if (!databaseUrl) {
    const message = "DATABASE_URL is not configured.";
    return {
      id,
      label,
      stages: [
        isolationStage,
        stage("table-exists", `${tableName} table exists`, "amber", message),
        stage("read-query", "Feed read query", "amber", message),
        stage("row-count", "Message row count", "amber", message),
      ],
    };
  }

  const pool = (deps.getPool ?? ((url: string) => getPostgresPool(url) as unknown as PoolLike))(databaseUrl);

  let tableExists = false;
  let tableExistsStage: AdminPipelineStage;
  try {
    const result = await withTimeout(
      pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
        [tableName],
      ),
      HEALTH_CHECK_TIMEOUT_MS,
      "timed out",
    );
    tableExists = result.rows.length > 0;
    tableExistsStage = tableExists
      ? stage("table-exists", `${tableName} table exists`, "green", `The ${tableName} table is present.`)
      : stage(
          "table-exists",
          `${tableName} table exists`,
          "red",
          `The migration that creates ${tableName} has not been applied yet.`,
        );
  } catch {
    tableExistsStage = stage(
      "table-exists",
      `${tableName} table exists`,
      "red",
      `Could not check whether the ${tableName} table exists.`,
    );
  }

  let readQueryStage: AdminPipelineStage;
  let rowCountStage: AdminPipelineStage;
  if (!tableExists) {
    readQueryStage = stage("read-query", "Feed read query", "amber", `Not probed; the ${tableName} table does not exist yet.`);
    rowCountStage = stage("row-count", "Message row count", "amber", `Not probed; the ${tableName} table does not exist yet.`);
  } else {
    try {
      const result = await withTimeout(
        pool.query<{ count: number | string }>(`SELECT COUNT(*)::int AS count FROM ${tableName}`),
        HEALTH_CHECK_TIMEOUT_MS,
        "timed out",
      );
      const count = Number(result.rows[0]?.count ?? 0);
      readQueryStage = stage("read-query", "Feed read query", "green", "The feed read query succeeded.");
      rowCountStage =
        count === 0
          ? stage("row-count", "Message row count", "green", "0 messages. The feed shows an empty state, not an error.")
          : stage("row-count", "Message row count", "green", `${count} message row(s).`);
    } catch {
      readQueryStage = stage("read-query", "Feed read query", "red", "The feed read query failed.");
      rowCountStage = stage("row-count", "Message row count", "red", "Could not count message rows.");
    }
  }

  return { id, label, stages: [isolationStage, tableExistsStage, readQueryStage, rowCountStage] };
}

export async function buildHoodchatPipeline(deps: ChatPipelineDeps = {}): Promise<AdminServicePipeline> {
  return buildChatPipeline("hoodchat", "Hoodchat", "hoodchat_messages", "hoodchat", deps);
}

export async function buildTokenChatPipeline(deps: ChatPipelineDeps = {}): Promise<AdminServicePipeline> {
  return buildChatPipeline("token-chat", "Token chat", "token_chat_messages", "token-chat", deps);
}

// ---------------------------------------------------------------------------
// Outreach
// ---------------------------------------------------------------------------

export type OutreachPipelineDeps = {
  databaseUrl?: string;
  getPool?: (databaseUrl: string) => PoolLike;
  getServiceControl?: (key: AdminServiceKey) => Promise<AdminServiceControl>;
  env?: Record<string, string | undefined>;
};

function outreachQueueFlagStage(env: Record<string, string | undefined>): AdminPipelineStage {
  const enabled = (env.OUTREACH_QUEUE_ENABLED || "").trim() === "true";
  return stage(
    "queue-flag",
    "Queue flag (OUTREACH_QUEUE_ENABLED)",
    enabled ? "green" : "amber",
    enabled
      ? "Draft generation is enabled; the cron reads the feed and queues drafts."
      : "Draft generation is off; the cron no-ops (no feed read, no store writes).",
  );
}

/** Reports credential presence by name only — values are never read into the message. */
function outreachCredentialsStage(env: Record<string, string | undefined>): AdminPipelineStage {
  const has = (name: string) => Boolean((env[name] || "").trim());
  const names = ["X_OUTREACH_API_KEY", "X_OUTREACH_API_SECRET", "X_OUTREACH_ACCESS_TOKEN", "X_OUTREACH_ACCESS_SECRET"];
  const missing = names.filter((name) => !has(name));
  if (missing.length === 0) {
    return stage(
      "x-credentials",
      "X_OUTREACH_* credentials",
      "green",
      "All four X_OUTREACH_* credentials are configured. Posting is enabled.",
    );
  }
  return stage(
    "x-credentials",
    "X_OUTREACH_* credentials",
    "amber",
    `Posting is dormant: missing ${missing.join(", ")}. Approving a draft returns 503.`,
  );
}

export async function buildOutreachPipeline(deps: OutreachPipelineDeps = {}): Promise<AdminServicePipeline> {
  const env = deps.env ?? process.env;
  const getServiceControl =
    deps.getServiceControl ?? ((key: AdminServiceKey) => getAdminOperationsStore().getServiceControl(key));
  const databaseUrl = deps.databaseUrl ?? env.DATABASE_URL?.trim() ?? "";

  const isolationStage = await chatIsolationStage("outreach", getServiceControl);
  const queueFlagStage = outreachQueueFlagStage(env);
  const credentialsStage = outreachCredentialsStage(env);

  if (!databaseUrl) {
    const message = "DATABASE_URL is not configured.";
    return {
      id: "outreach",
      label: "Outreach",
      stages: [
        isolationStage,
        queueFlagStage,
        credentialsStage,
        stage("table-exists", "outreach_queue_items table exists", "amber", message),
        stage("queue-counts", "Queue counts (pending/posted/dismissed/failed)", "amber", message),
      ],
    };
  }

  const pool = (deps.getPool ?? ((url: string) => getPostgresPool(url) as unknown as PoolLike))(databaseUrl);

  let tableExists = false;
  let tableExistsStage: AdminPipelineStage;
  try {
    const result = await withTimeout(
      pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'outreach_queue_items'`,
      ),
      HEALTH_CHECK_TIMEOUT_MS,
      "timed out",
    );
    tableExists = result.rows.length > 0;
    tableExistsStage = tableExists
      ? stage("table-exists", "outreach_queue_items table exists", "green", "The outreach_queue_items table is present.")
      : stage(
          "table-exists",
          "outreach_queue_items table exists",
          "red",
          "Migration 013_outreach.sql has not been applied yet.",
        );
  } catch {
    tableExistsStage = stage(
      "table-exists",
      "outreach_queue_items table exists",
      "red",
      "Could not check whether the outreach_queue_items table exists.",
    );
  }

  let queueCountsStage: AdminPipelineStage;
  if (!tableExists) {
    queueCountsStage = stage(
      "queue-counts",
      "Queue counts (pending/posted/dismissed/failed)",
      "amber",
      "Not probed; the outreach_queue_items table does not exist yet.",
    );
  } else {
    try {
      const result = await withTimeout(
        pool.query<{ status: string; count: number | string }>(
          `SELECT status, COUNT(*)::int AS count FROM outreach_queue_items GROUP BY status`,
        ),
        HEALTH_CHECK_TIMEOUT_MS,
        "timed out",
      );
      const counts: Record<string, number> = { pending: 0, posted: 0, dismissed: 0, failed: 0 };
      for (const row of result.rows) {
        if (row.status in counts) counts[row.status] = Number(row.count);
      }
      queueCountsStage = stage(
        "queue-counts",
        "Queue counts (pending/posted/dismissed/failed)",
        "green",
        `${counts.pending} pending, ${counts.posted} posted, ${counts.dismissed} dismissed, ${counts.failed} failed.`,
      );
    } catch {
      queueCountsStage = stage(
        "queue-counts",
        "Queue counts (pending/posted/dismissed/failed)",
        "red",
        "Could not count outreach queue rows.",
      );
    }
  }

  return {
    id: "outreach",
    label: "Outreach",
    stages: [isolationStage, queueFlagStage, credentialsStage, tableExistsStage, queueCountsStage],
  };
}

// ---------------------------------------------------------------------------
// Social Studio posting (Mode 1 review-and-release, issue #335)
// ---------------------------------------------------------------------------

export type SocialPostingPipelineDeps = {
  databaseUrl?: string;
  getPool?: (databaseUrl: string) => PoolLike;
  getServiceControl?: (key: AdminServiceKey) => Promise<AdminServiceControl>;
  env?: Record<string, string | undefined>;
};

/** Reports credential presence by name only — values are never read into the message. */
function socialPostingDestinationsStage(env: Record<string, string | undefined>): AdminPipelineStage {
  const has = (name: string) => Boolean((env[name] || "").trim());
  const xConfigured = has("X_SOCIAL_CONSUMER_KEY") && has("X_SOCIAL_CONSUMER_SECRET");
  const telegramConfigured = has("TELEGRAM_BOT_TOKEN");
  if (xConfigured && telegramConfigured) {
    return stage("destinations", "X_SOCIAL_* / TELEGRAM_BOT_TOKEN", "green", "Both X and Telegram connections are configured.");
  }
  if (!xConfigured && !telegramConfigured) {
    return stage(
      "destinations",
      "X_SOCIAL_* / TELEGRAM_BOT_TOKEN",
      "amber",
      "Dormant: neither X_SOCIAL_CONSUMER_KEY/SECRET nor TELEGRAM_BOT_TOKEN is set. Connect actions 503 for both destinations.",
    );
  }
  return stage(
    "destinations",
    "X_SOCIAL_* / TELEGRAM_BOT_TOKEN",
    "amber",
    xConfigured ? "X is configured; Telegram is dormant (TELEGRAM_BOT_TOKEN unset)." : "Telegram is configured; X is dormant (X_SOCIAL_CONSUMER_KEY/SECRET unset).",
  );
}

function socialPostingEncryptionStage(env: Record<string, string | undefined>): AdminPipelineStage {
  const configured = Boolean((env.SOCIAL_CREDENTIALS_ENCRYPTION_KEY || "").trim());
  return stage(
    "encryption-key",
    "SOCIAL_CREDENTIALS_ENCRYPTION_KEY",
    configured ? "green" : "red",
    configured
      ? "At-rest encryption key is configured; stored connection credentials are encrypted."
      : "Not set — every connect attempt fails closed (credentials cannot be encrypted for storage).",
  );
}

export async function buildSocialPostingPipeline(deps: SocialPostingPipelineDeps = {}): Promise<AdminServicePipeline> {
  const env = deps.env ?? process.env;
  const getServiceControl =
    deps.getServiceControl ?? ((key: AdminServiceKey) => getAdminOperationsStore().getServiceControl(key));
  const databaseUrl = deps.databaseUrl ?? env.DATABASE_URL?.trim() ?? "";

  const isolationStage = await chatIsolationStage("social-posting", getServiceControl);
  const destinationsStage = socialPostingDestinationsStage(env);
  const encryptionStage = socialPostingEncryptionStage(env);

  if (!databaseUrl) {
    const message = "DATABASE_URL is not configured.";
    return {
      id: "social-posting",
      label: "Social Studio posting",
      stages: [
        isolationStage,
        destinationsStage,
        encryptionStage,
        stage("table-exists", "social_scheduled_posts table exists", "amber", message),
        stage("queue-counts", "Post counts (scheduled/sent/partially_sent/failed/canceled)", "amber", message),
      ],
    };
  }

  const pool = (deps.getPool ?? ((url: string) => getPostgresPool(url) as unknown as PoolLike))(databaseUrl);

  let tableExists = false;
  let tableExistsStage: AdminPipelineStage;
  try {
    const result = await withTimeout(
      pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'social_scheduled_posts'`,
      ),
      HEALTH_CHECK_TIMEOUT_MS,
      "timed out",
    );
    tableExists = result.rows.length > 0;
    tableExistsStage = tableExists
      ? stage("table-exists", "social_scheduled_posts table exists", "green", "The social_scheduled_posts table is present.")
      : stage(
          "table-exists",
          "social_scheduled_posts table exists",
          "red",
          "Migration 018_social_studio_connections.sql has not been applied yet.",
        );
  } catch {
    tableExistsStage = stage(
      "table-exists",
      "social_scheduled_posts table exists",
      "red",
      "Could not check whether the social_scheduled_posts table exists.",
    );
  }

  let queueCountsStage: AdminPipelineStage;
  if (!tableExists) {
    queueCountsStage = stage(
      "queue-counts",
      "Post counts (scheduled/sent/partially_sent/failed/canceled)",
      "amber",
      "Not probed; the social_scheduled_posts table does not exist yet.",
    );
  } else {
    try {
      const result = await withTimeout(
        pool.query<{ status: string; count: number | string }>(
          `SELECT status, COUNT(*)::int AS count FROM social_scheduled_posts GROUP BY status`,
        ),
        HEALTH_CHECK_TIMEOUT_MS,
        "timed out",
      );
      const counts: Record<string, number> = { scheduled: 0, sent: 0, partially_sent: 0, failed: 0, canceled: 0 };
      for (const row of result.rows) {
        if (row.status in counts) counts[row.status] = Number(row.count);
      }
      queueCountsStage = stage(
        "queue-counts",
        "Post counts (scheduled/sent/partially_sent/failed/canceled)",
        "green",
        `${counts.scheduled} scheduled, ${counts.sent} sent, ${counts.partially_sent} partially sent, ${counts.failed} failed, ${counts.canceled} canceled.`,
      );
    } catch {
      queueCountsStage = stage(
        "queue-counts",
        "Post counts (scheduled/sent/partially_sent/failed/canceled)",
        "red",
        "Could not count scheduled post rows.",
      );
    }
  }

  return {
    id: "social-posting",
    label: "Social Studio posting",
    stages: [isolationStage, destinationsStage, encryptionStage, tableExistsStage, queueCountsStage],
  };
}

// ---------------------------------------------------------------------------
// On-chain contracts
// ---------------------------------------------------------------------------

export type ContractsPipelineDeps = {
  chainId?: number;
  rpcUrl?: string;
  factoryAddress?: `0x${string}` | undefined;
  bondingCurveAddress?: `0x${string}` | undefined;
  client?: Pick<PublicClient, "getChainId" | "readContract">;
  readFactory?: () => Promise<unknown>;
  readBondingCurve?: () => Promise<unknown>;
  readChainId?: () => Promise<number>;
};

export async function buildContractsPipeline(deps: ContractsPipelineDeps = {}): Promise<AdminServicePipeline> {
  const chainId = deps.chainId ?? ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL;
  const factoryAddress = deps.factoryAddress ?? getFactoryAddress(chainId);
  const bondingCurveAddress = deps.bondingCurveAddress ?? getBondingCurveAddress(chainId);
  const client = deps.client ?? contractsClient(chainId, deps.rpcUrl);

  const readChainId = deps.readChainId ?? (() => client.getChainId());
  const readFactory =
    deps.readFactory ??
    (factoryAddress
      ? () =>
          client.readContract({
            address: factoryAddress,
            abi: HOODLUMS_TOKEN_FACTORY_ABI,
            functionName: "owner",
          })
      : null);
  const readBondingCurve =
    deps.readBondingCurve ??
    (bondingCurveAddress
      ? () =>
          client.readContract({
            address: bondingCurveAddress,
            abi: HOODLUMS_BONDING_CURVE_READ_ABI,
            functionName: "funded",
          })
      : null);

  let observedChainId: number | null = null;
  let rpcStage: AdminPipelineStage;
  try {
    observedChainId = await withTimeout(readChainId(), HEALTH_CHECK_TIMEOUT_MS, "timed out");
    rpcStage = stage("rpc-reachable", "RPC endpoint reachable", "green", `RPC responded (reported chain ID ${observedChainId}).`);
  } catch {
    rpcStage = stage("rpc-reachable", "RPC endpoint reachable", "red", "RPC endpoint did not respond.");
  }

  let factoryStage: AdminPipelineStage;
  if (!readFactory) {
    factoryStage = stage("factory-read", "Factory read call", "amber", "No factory address is configured for this chain.");
  } else {
    try {
      await withTimeout(readFactory(), HEALTH_CHECK_TIMEOUT_MS, "timed out");
      factoryStage = stage("factory-read", "Factory read call", "green", "Factory owner() call succeeded.");
    } catch {
      factoryStage = stage("factory-read", "Factory read call", "red", "Factory owner() call failed.");
    }
  }

  let bondingCurveStage: AdminPipelineStage;
  if (!readBondingCurve) {
    bondingCurveStage = stage(
      "bonding-curve-read",
      "Bonding curve read call",
      "amber",
      "No bonding curve address is configured for this chain.",
    );
  } else {
    try {
      await withTimeout(readBondingCurve(), HEALTH_CHECK_TIMEOUT_MS, "timed out");
      bondingCurveStage = stage("bonding-curve-read", "Bonding curve read call", "green", "Bonding curve funded() call succeeded.");
    } catch {
      bondingCurveStage = stage("bonding-curve-read", "Bonding curve read call", "red", "Bonding curve funded() call failed.");
    }
  }

  let chainIdStage: AdminPipelineStage;
  if (observedChainId === null) {
    chainIdStage = stage(
      "chain-id-match",
      "Chain ID matches expected",
      "amber",
      "Could not confirm; the RPC reachability call failed.",
    );
  } else if (Number(observedChainId) === chainId) {
    chainIdStage = stage(
      "chain-id-match",
      "Chain ID matches expected",
      "green",
      `RPC reports chain ID ${observedChainId}, matching the expected ${chainId}.`,
    );
  } else {
    chainIdStage = stage(
      "chain-id-match",
      "Chain ID matches expected",
      "red",
      `RPC reports chain ID ${observedChainId}, but ${chainId} was expected.`,
    );
  }

  return {
    id: "contracts",
    label: "On-chain contracts",
    stages: [rpcStage, factoryStage, bondingCurveStage, chainIdStage],
  };
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

export type DeploymentPipelineDeps = {
  env?: Record<string, string | undefined>;
  requestOidcToken?: string;
};

function currentCommitStage(env: Record<string, string | undefined>): AdminPipelineStage {
  if (env.NODE_ENV !== "production") {
    return stage("current-commit", "Current commit", "green", "No commit metadata outside production (local development server).");
  }
  const commit = (env.VERCEL_GIT_COMMIT_SHA || "").trim();
  if (!commit) {
    return stage("current-commit", "Current commit", "red", "VERCEL_GIT_COMMIT_SHA is not set in production.");
  }
  return stage("current-commit", "Current commit", "green", `Running commit ${commit.slice(0, 7)}.`);
}

type EnvCheckItem = { name: string; present: boolean; required: boolean };
type FeatureEnvGroup = { feature: string; items: EnvCheckItem[] };

function envVarGroups(env: Record<string, string | undefined>, requestOidcToken: string): FeatureEnvGroup[] {
  const has = (name: string) => Boolean((env[name] || "").trim());
  const generationCredentialPresent =
    has("OPENAI_API_KEY") || has("AI_GATEWAY_API_KEY") || has("VERCEL_OIDC_TOKEN") || Boolean(requestOidcToken.trim());

  return [
    {
      feature: "Website generation",
      items: [
        {
          name: "OPENAI_API_KEY or AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN (or request OIDC header)",
          present: generationCredentialPresent,
          required: true,
        },
        { name: "GENERATE_SITE_STYLE_SHARED_SECRET", present: has("GENERATE_SITE_STYLE_SHARED_SECRET"), required: true },
      ],
    },
    {
      feature: "Database",
      items: [{ name: "DATABASE_URL", present: has("DATABASE_URL"), required: true }],
    },
    {
      feature: "Public publishing",
      items: [{ name: "DATABASE_URL", present: has("DATABASE_URL"), required: true }],
    },
    {
      feature: "Market feed",
      items: [
        { name: "GMGN_API_KEY", present: has("GMGN_API_KEY"), required: true },
        { name: "BITQUERY_ACCESS_TOKEN", present: has("BITQUERY_ACCESS_TOKEN"), required: false },
      ],
    },
    {
      feature: "Telegram publishing",
      items: [
        { name: "(none — bot token and chat ID are supplied per request, not stored server-side)", present: true, required: false },
      ],
    },
    {
      feature: "Admin authentication",
      items: [{ name: "ADMIN_WALLET_ADDRESS or ADMIN_PASSWORD", present: has("ADMIN_WALLET_ADDRESS") || has("ADMIN_PASSWORD"), required: true }],
    },
  ];
}

/** Reports variable presence by name only — values are never read into the message. */
function envVarsStage(env: Record<string, string | undefined>, requestOidcToken: string): AdminPipelineStage {
  const groups = envVarGroups(env, requestOidcToken);
  const missing = groups.flatMap((group) =>
    group.items.filter((item) => item.required && !item.present).map((item) => `${group.feature}: ${item.name}`),
  );

  if (missing.length === 0) {
    return stage(
      "env-vars",
      "Required environment variables",
      "green",
      `All required variables are present for: ${groups.map((group) => group.feature).join(", ")}.`,
    );
  }

  return stage("env-vars", "Required environment variables", "red", `Missing: ${missing.join("; ")}.`);
}

function lastDeployStatusStage(env: Record<string, string | undefined>): AdminPipelineStage {
  if (env.NODE_ENV !== "production") {
    return stage("last-deploy-status", "Last deploy status", "green", "Local development server is running (not a Vercel deployment).");
  }
  const vercelEnv = (env.VERCEL_ENV || "").trim();
  if (!vercelEnv) {
    return stage(
      "last-deploy-status",
      "Last deploy status",
      "red",
      "Production runtime is missing Vercel deployment metadata (VERCEL_ENV unset).",
    );
  }
  const commit = (env.VERCEL_GIT_COMMIT_SHA || "").trim().slice(0, 7);
  return stage(
    "last-deploy-status",
    "Last deploy status",
    "green",
    commit
      ? `Currently serving ${vercelEnv} at commit ${commit}. Historical deploy status is not tracked by this app.`
      : `Currently serving ${vercelEnv}. Historical deploy status is not tracked by this app.`,
  );
}

export function buildDeploymentPipeline(deps: DeploymentPipelineDeps = {}): AdminServicePipeline {
  const env = deps.env ?? process.env;
  const requestOidcToken = deps.requestOidcToken ?? "";
  return {
    id: "deployment",
    label: "Deployment",
    stages: [currentCommitStage(env), envVarsStage(env, requestOidcToken), lastDeployStatusStage(env)],
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type SystemHealthPipelineDeps = {
  env?: Record<string, string | undefined>;
  requestOidcToken?: string;
  websiteGeneration?: WebsiteGenerationPipelineDeps;
  database?: DatabasePipelineDeps;
  contracts?: ContractsPipelineDeps;
  subscribers?: SubscribersPipelineDeps;
  hoodchat?: ChatPipelineDeps;
  tokenChat?: ChatPipelineDeps;
  outreach?: OutreachPipelineDeps;
  socialStudioAi?: SocialStudioAiPipelineDeps;
  socialPosting?: SocialPostingPipelineDeps;
};

/** Builds a single service's pipeline on demand — used by the drill-down endpoint. */
export async function buildServicePipeline(
  id: SystemHealthCheckId,
  deps: SystemHealthPipelineDeps = {},
): Promise<AdminServicePipeline> {
  switch (id) {
    case "website-generation":
      return buildWebsiteGenerationPipeline({
        env: deps.env,
        requestOidcToken: deps.requestOidcToken,
        ...deps.websiteGeneration,
      });
    case "database":
      return buildDatabasePipeline(deps.database);
    case "contracts":
      return buildContractsPipeline(deps.contracts);
    case "deployment":
      return buildDeploymentPipeline({ env: deps.env, requestOidcToken: deps.requestOidcToken });
    case "subscribers":
      return buildSubscribersPipeline(deps.subscribers);
    case "hoodchat":
      return buildHoodchatPipeline(deps.hoodchat);
    case "token-chat":
      return buildTokenChatPipeline(deps.tokenChat);
    case "outreach":
      return buildOutreachPipeline({ env: deps.env, ...deps.outreach });
    case "social-studio-ai":
      return buildSocialStudioAiPipeline({
        env: deps.env,
        requestOidcToken: deps.requestOidcToken,
        ...deps.socialStudioAi,
      });
    case "social-posting":
      return buildSocialPostingPipeline({ env: deps.env, ...deps.socialPosting });
  }
}
