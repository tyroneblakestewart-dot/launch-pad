import { describe, expect, it } from "vitest";
import type { AdminServiceControl } from "@/lib/admin-operations";
import {
  buildClientErrorsPipeline,
  buildContentFilterPipeline,
  buildContractsPipeline,
  buildDatabasePipeline,
  buildDeploymentPipeline,
  buildOperationsCostPipeline,
  buildOutreachPipeline,
  buildServicePipeline,
  buildSocialPostingPipeline,
  buildSocialStudioAiPipeline,
  buildSubscribersPipeline,
  buildWebsiteGenerationPipeline,
} from "@/lib/server/system-health-pipeline";

function stageById(pipeline: { stages: Array<{ id: string }> }, id: string) {
  const stage = pipeline.stages.find((candidate) => candidate.id === id);
  if (!stage) throw new Error(`No stage with id ${id}`);
  return stage;
}

function activeControl(overrides: Partial<AdminServiceControl> = {}): AdminServiceControl {
  return {
    key: "website-generation",
    label: "Website generation",
    description: "AI artwork analysis, site copy, styling and full-page generation.",
    affectedRoutes: "/api/generate-free-site, /api/generate-site-page, /api/generate-site-style",
    isolated: false,
    reason: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildWebsiteGenerationPipeline", () => {
  it("reports provider configured green from an env credential and amber with none", async () => {
    const withKey = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    expect(stageById(withKey, "provider-configured")).toMatchObject({ status: "green" });

    const withoutKey = await buildWebsiteGenerationPipeline({
      env: {},
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    expect(stageById(withoutKey, "provider-configured")).toMatchObject({ status: "amber" });
  });

  it("resolves the provider from the request OIDC token even with no env credential — the fixed bug", async () => {
    const pipeline = await buildWebsiteGenerationPipeline({
      env: {},
      requestOidcToken: "runtime-oidc-token",
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    expect(stageById(pipeline, "provider-configured")).toMatchObject({
      status: "green",
      message: expect.stringContaining("vercel-ai-gateway"),
    });
  });

  it("marks endpoint-reachable amber with the reason when the service is isolated", async () => {
    const pipeline = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => activeControl({ isolated: true, reason: "Investigating a provider outage." }),
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    expect(stageById(pipeline, "endpoint-reachable")).toMatchObject({
      status: "amber",
      message: expect.stringContaining("Investigating a provider outage."),
    });
  });

  it("fails open (amber, not red) when the isolation store cannot be read", async () => {
    const pipeline = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => {
        throw new Error("control store unavailable");
      },
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    expect(stageById(pipeline, "endpoint-reachable")).toMatchObject({ status: "amber" });
  });

  it("is red in production without the shared secret and green when it matches the bridge value", async () => {
    const missing = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key", NODE_ENV: "production" },
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    expect(stageById(missing, "origin-check")).toMatchObject({ status: "red" });

    const matching = await buildWebsiteGenerationPipeline({
      env: {
        OPENAI_API_KEY: "test-key",
        GENERATE_SITE_STYLE_SHARED_SECRET: "shared-secret",
        NEXT_PUBLIC_GENERATE_SITE_STYLE_SHARED_SECRET: "shared-secret",
      },
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    expect(stageById(matching, "origin-check")).toMatchObject({ status: "green" });
  });

  it("reports the rate limiter as configured only once the shared secret is set", async () => {
    const withoutSecret = await buildWebsiteGenerationPipeline({
      env: {},
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    expect(stageById(withoutSecret, "rate-limiter")).toMatchObject({ status: "amber" });

    const withSecret = await buildWebsiteGenerationPipeline({
      env: { GENERATE_SITE_STYLE_SHARED_SECRET: "shared-secret" },
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    expect(stageById(withSecret, "rate-limiter")).toMatchObject({
      status: "green",
      message: expect.stringContaining("10 requests"),
    });
  });

  it("probes provider reachability with a HEAD request and never sends a generation payload", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const pipeline = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => activeControl(),
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(null, { status: 401 });
      },
    });
    expect(stageById(pipeline, "provider-reachable")).toMatchObject({ status: "green" });
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe("HEAD");
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("marks provider reachability red when the network probe fails, and amber when not configured", async () => {
    const networkDown = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => {
        throw new Error("network unreachable");
      },
    });
    expect(stageById(networkDown, "provider-reachable")).toMatchObject({ status: "red" });

    const notConfigured = await buildWebsiteGenerationPipeline({
      env: {},
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    expect(stageById(notConfigured, "provider-reachable")).toMatchObject({ status: "amber" });
  });

  it("never fakes a green for unrecorded stages — last outcome and response validation stay amber with no observedAt", async () => {
    const pipeline = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    const outcome = stageById(pipeline, "last-generation-outcome");
    expect(outcome.status).toBe("amber");
    expect(outcome.observedAt).toBeNull();

    const validation = stageById(pipeline, "response-validation");
    expect(validation.status).toBe("amber");
    expect(validation.observedAt).toBeNull();
  });
});

describe("buildDatabasePipeline", () => {
  function fakePool(overrides: {
    query?: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  } = {}) {
    return {
      totalCount: 2,
      idleCount: 1,
      waitingCount: 0,
      query:
        overrides.query ??
        (async (text: string) => {
          if (text.includes("information_schema.tables")) {
            return {
              rows: [
                { table_name: "published_sites" },
                { table_name: "wallet_nonces" },
                { table_name: "admin_sessions" },
                { table_name: "admin_service_controls" },
              ],
            };
          }
          if (text.includes("MAX(created_at)")) {
            return { rows: [{ last_write: "2026-01-02T00:00:00.000Z" }] };
          }
          return { rows: [] };
        }),
    };
  }

  it("reports every stage amber when DATABASE_URL is not configured", async () => {
    const pipeline = await buildDatabasePipeline({ databaseUrl: "" });
    expect(pipeline.stages.every((stage) => stage.status === "amber")).toBe(true);
  });

  it("is green end to end when the connection, tables and activity log all check out", async () => {
    const pipeline = await buildDatabasePipeline({
      databaseUrl: "postgres://test",
      getPool: () => fakePool(),
    });
    expect(stageById(pipeline, "connection")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "pool-state")).toMatchObject({
      status: "green",
      message: expect.stringContaining("2 total"),
    });
    expect(stageById(pipeline, "tables")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "last-read-write")).toMatchObject({
      status: "green",
      observedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("is red on connection failure and lists missing tables by name", async () => {
    const pipeline = await buildDatabasePipeline({
      databaseUrl: "postgres://test",
      getPool: () =>
        fakePool({
          query: async (text: string) => {
            if (text.includes("SELECT 1")) throw new Error("connection refused");
            if (text.includes("information_schema.tables")) {
              return { rows: [{ table_name: "published_sites" }] };
            }
            return { rows: [] };
          },
        }),
    });
    expect(stageById(pipeline, "connection")).toMatchObject({ status: "red" });
    const tables = stageById(pipeline, "tables");
    expect(tables.status).toBe("red");
    expect(tables.message).toContain("wallet_nonces");
    expect(tables.message).toContain("admin_sessions");
    expect(tables.message).toContain("admin_service_controls");
    expect(tables.message).not.toContain("published_sites");
  });

  it("reports last-read-write as never recorded rather than guessing green", async () => {
    const pipeline = await buildDatabasePipeline({
      databaseUrl: "postgres://test",
      getPool: () =>
        fakePool({
          query: async (text: string) => {
            if (text.includes("MAX(created_at)")) return { rows: [{ last_write: null }] };
            if (text.includes("information_schema.tables")) {
              return {
                rows: [
                  { table_name: "published_sites" },
                  { table_name: "wallet_nonces" },
                  { table_name: "admin_sessions" },
                  { table_name: "admin_service_controls" },
                ],
              };
            }
            return { rows: [] };
          },
        }),
    });
    const lastReadWrite = stageById(pipeline, "last-read-write");
    expect(lastReadWrite.observedAt).toBeNull();
    expect(lastReadWrite.message).toContain("No write has been recorded");
  });
});

describe("buildContractsPipeline", () => {
  it("is green end to end and confirms the chain ID matches", async () => {
    const pipeline = await buildContractsPipeline({
      chainId: 46630,
      factoryAddress: "0x1111111111111111111111111111111111111",
      bondingCurveAddress: "0x2222222222222222222222222222222222222",
      readChainId: async () => 46630,
      readFactory: async () => "0xowner",
      readBondingCurve: async () => true,
    });
    expect(stageById(pipeline, "rpc-reachable")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "factory-read")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "bonding-curve-read")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "chain-id-match")).toMatchObject({ status: "green" });
  });

  it("flags a chain ID mismatch as red", async () => {
    const pipeline = await buildContractsPipeline({
      chainId: 46630,
      readChainId: async () => 1,
      readFactory: async () => "0xowner",
      readBondingCurve: async () => true,
    });
    expect(stageById(pipeline, "chain-id-match")).toMatchObject({ status: "red" });
  });

  it("is red when the RPC call fails, and amber for unconfigured addresses", async () => {
    const pipeline = await buildContractsPipeline({
      chainId: 1,
      readChainId: async () => Promise.reject(new Error("rpc down")),
    });
    expect(stageById(pipeline, "rpc-reachable")).toMatchObject({ status: "red" });
    expect(stageById(pipeline, "factory-read")).toMatchObject({ status: "amber" });
    expect(stageById(pipeline, "bonding-curve-read")).toMatchObject({ status: "amber" });
    expect(stageById(pipeline, "chain-id-match")).toMatchObject({ status: "amber" });
  });
});

describe("buildDeploymentPipeline", () => {
  it("is green locally with no commit metadata required", () => {
    const pipeline = buildDeploymentPipeline({ env: { NODE_ENV: "development" } });
    expect(stageById(pipeline, "current-commit")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "last-deploy-status")).toMatchObject({ status: "green" });
  });

  it("is red in production without Vercel deployment metadata", () => {
    const pipeline = buildDeploymentPipeline({ env: { NODE_ENV: "production" } });
    expect(stageById(pipeline, "current-commit")).toMatchObject({ status: "red" });
    expect(stageById(pipeline, "last-deploy-status")).toMatchObject({ status: "red" });
  });

  it("lists every missing required variable by name, never by value", () => {
    const pipeline = buildDeploymentPipeline({ env: { NODE_ENV: "production", VERCEL_ENV: "production" } });
    const envStage = stageById(pipeline, "env-vars");
    expect(envStage.status).toBe("red");
    expect(envStage.message).toContain("Database: DATABASE_URL");
    expect(envStage.message).toContain("Market feed: GMGN_API_KEY");
    expect(envStage.message).toContain("Admin authentication: ADMIN_WALLET_ADDRESS or ADMIN_PASSWORD");
  });

  it("is green when every required variable is present, and accepts the request OIDC header as a generation credential", () => {
    const pipeline = buildDeploymentPipeline({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        GENERATE_SITE_STYLE_SHARED_SECRET: "secret",
        DATABASE_URL: "postgres://test",
        GMGN_API_KEY: "gmgn-key",
        ADMIN_PASSWORD: "correct horse battery staple",
      },
      requestOidcToken: "runtime-oidc-token",
    });
    expect(stageById(pipeline, "env-vars")).toMatchObject({ status: "green" });
  });
});

describe("buildSubscribersPipeline", () => {
  function fakePool(overrides: {
    query?: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  } = {}) {
    return {
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
      query:
        overrides.query ??
        (async (text: string) => {
          if (text.includes("information_schema.tables")) {
            return { rows: [{ table_name: "subscriptions" }] };
          }
          if (text.includes("COUNT(*)")) {
            return { rows: [{ count: 3 }] };
          }
          return { rows: [] };
        }),
    };
  }

  it("reports every stage amber when DATABASE_URL is not configured", async () => {
    const pipeline = await buildSubscribersPipeline({ databaseUrl: "" });
    expect(pipeline.stages.every((stage) => stage.status === "amber")).toBe(true);
  });

  it("is green end to end when the table exists and the read query succeeds", async () => {
    const pipeline = await buildSubscribersPipeline({ databaseUrl: "postgres://test", getPool: () => fakePool() });
    expect(stageById(pipeline, "table-exists")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "read-query")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "row-count")).toMatchObject({ status: "green", message: expect.stringContaining("3") });
  });

  it("is red on table-exists and does not probe the read query or row count when the migration has not been applied", async () => {
    const pipeline = await buildSubscribersPipeline({
      databaseUrl: "postgres://test",
      getPool: () => fakePool({ query: async () => ({ rows: [] }) }),
    });
    expect(stageById(pipeline, "table-exists")).toMatchObject({ status: "red" });
    expect(stageById(pipeline, "read-query")).toMatchObject({ status: "amber" });
    expect(stageById(pipeline, "row-count")).toMatchObject({ status: "amber" });
  });

  it("reports a green, not amber or red, row count of zero as 'No subscribers yet'", async () => {
    const pipeline = await buildSubscribersPipeline({
      databaseUrl: "postgres://test",
      getPool: () =>
        fakePool({
          query: async (text: string) => {
            if (text.includes("information_schema.tables")) return { rows: [{ table_name: "subscriptions" }] };
            if (text.includes("COUNT(*)")) return { rows: [{ count: 0 }] };
            return { rows: [] };
          },
        }),
    });
    expect(stageById(pipeline, "row-count")).toMatchObject({
      status: "green",
      message: expect.stringContaining("No subscribers yet"),
    });
  });
});

describe("buildClientErrorsPipeline", () => {
  function fakePool(overrides: {
    query?: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  } = {}) {
    return {
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
      query:
        overrides.query ??
        (async (text: string) => {
          if (text.includes("information_schema.tables")) return { rows: [{ table_name: "client_errors" }] };
          if (text.includes("new_groups")) return { rows: [{ count: 0 }] };
          if (text.includes("error_groups")) return { rows: [{ count: 0 }] };
          return { rows: [] };
        }),
    };
  }

  it("reports every stage amber when DATABASE_URL is not configured", async () => {
    const pipeline = await buildClientErrorsPipeline({ databaseUrl: "" });
    expect(pipeline.stages.every((stage) => stage.status === "amber")).toBe(true);
  });

  it("is green end to end when the table exists and there are no new or open groups", async () => {
    const pipeline = await buildClientErrorsPipeline({ databaseUrl: "postgres://test", getPool: () => fakePool() });
    expect(stageById(pipeline, "table-exists")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "new-groups-24h")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "open-groups")).toMatchObject({ status: "green" });
  });

  it("is red on table-exists and does not probe the other stages when the migration has not been applied", async () => {
    const pipeline = await buildClientErrorsPipeline({
      databaseUrl: "postgres://test",
      getPool: () => fakePool({ query: async () => ({ rows: [] }) }),
    });
    expect(stageById(pipeline, "table-exists")).toMatchObject({ status: "red" });
    expect(stageById(pipeline, "new-groups-24h")).toMatchObject({ status: "amber" });
    expect(stageById(pipeline, "open-groups")).toMatchObject({ status: "amber" });
  });

  it("escalates from amber to red as more new groups appear in the last 24 hours", async () => {
    const amberPipeline = await buildClientErrorsPipeline({
      databaseUrl: "postgres://test",
      getPool: () =>
        fakePool({
          query: async (text: string) => {
            if (text.includes("information_schema.tables")) return { rows: [{ table_name: "client_errors" }] };
            if (text.includes("new_groups")) return { rows: [{ count: 1 }] };
            return { rows: [{ count: 0 }] };
          },
        }),
    });
    expect(stageById(amberPipeline, "new-groups-24h")).toMatchObject({ status: "amber" });

    const redPipeline = await buildClientErrorsPipeline({
      databaseUrl: "postgres://test",
      getPool: () =>
        fakePool({
          query: async (text: string) => {
            if (text.includes("information_schema.tables")) return { rows: [{ table_name: "client_errors" }] };
            if (text.includes("new_groups")) return { rows: [{ count: 3 }] };
            return { rows: [{ count: 0 }] };
          },
        }),
    });
    expect(stageById(redPipeline, "new-groups-24h")).toMatchObject({ status: "red" });
  });

  it("is reachable through the buildServicePipeline dispatcher", async () => {
    const pipeline = await buildServicePipeline("client-errors", { clientErrors: { databaseUrl: "" } });
    expect(pipeline.id).toBe("client-errors");
  });
});

describe("buildContentFilterPipeline", () => {
  function fakePool(overrides: {
    query?: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  } = {}) {
    return {
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
      query: overrides.query ?? (async () => ({ rows: [{ count: 0 }] })),
    };
  }

  it("reports the filter as loaded (green) even with no database configured", async () => {
    const pipeline = await buildContentFilterPipeline({ databaseUrl: "" });
    expect(stageById(pipeline, "filter-loaded")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "filter-loaded").message).toMatch(/\d+ terms across \d+ categories/);
    expect(stageById(pipeline, "rejections-24h")).toMatchObject({ status: "amber" });
  });

  it("is green end to end when the rejection count query succeeds", async () => {
    const pipeline = await buildContentFilterPipeline({
      databaseUrl: "postgres://test",
      getPool: () => fakePool({ query: async () => ({ rows: [{ count: 2 }] }) }),
    });
    expect(stageById(pipeline, "rejections-24h")).toMatchObject({ status: "green", message: expect.stringContaining("2 rejection(s)") });
  });

  it("is red on rejections-24h when the query fails", async () => {
    const pipeline = await buildContentFilterPipeline({
      databaseUrl: "postgres://test",
      getPool: () => fakePool({ query: async () => Promise.reject(new Error("boom")) }),
    });
    expect(stageById(pipeline, "rejections-24h")).toMatchObject({ status: "red" });
  });

  it("is reachable through the buildServicePipeline dispatcher", async () => {
    const pipeline = await buildServicePipeline("content-filter", { contentFilter: { databaseUrl: "" } });
    expect(pipeline.id).toBe("content-filter");
  });
});

describe("buildServicePipeline dispatch", () => {
  it("routes each id to the matching pipeline builder", async () => {
    const websiteGeneration = await buildServicePipeline("website-generation", {
      env: {},
      websiteGeneration: { getServiceControl: async () => activeControl(), fetchImpl: async () => new Response(null) },
    });
    expect(websiteGeneration.id).toBe("website-generation");

    const database = await buildServicePipeline("database", { database: { databaseUrl: "" } });
    expect(database.id).toBe("database");

    const contracts = await buildServicePipeline("contracts", {
      contracts: { chainId: 1, readChainId: async () => 1 },
    });
    expect(contracts.id).toBe("contracts");

    const deployment = await buildServicePipeline("deployment", { env: { NODE_ENV: "development" } });
    expect(deployment.id).toBe("deployment");

    const subscribers = await buildServicePipeline("subscribers", { subscribers: { databaseUrl: "" } });
    expect(subscribers.id).toBe("subscribers");

    const outreach = await buildServicePipeline("outreach", {
      env: {},
      outreach: { databaseUrl: "", getServiceControl: async () => activeControl({ key: "outreach" }) },
    });
    expect(outreach.id).toBe("outreach");
  });
});

describe("buildOutreachPipeline", () => {
  function fakePool(overrides: {
    query?: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  } = {}) {
    return {
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
      query:
        overrides.query ??
        (async (text: string) => {
          if (text.includes("information_schema.tables")) return { rows: [{ table_name: "outreach_queue_items" }] };
          if (text.includes("GROUP BY status")) {
            return { rows: [{ status: "pending", count: 2 }, { status: "posted", count: 1 }] };
          }
          return { rows: [] };
        }),
    };
  }

  it("reports the queue-flag and credential stages from env, independent of the database", async () => {
    const off = await buildOutreachPipeline({
      databaseUrl: "",
      env: {},
      getServiceControl: async () => activeControl({ key: "outreach" }),
    });
    expect(stageById(off, "queue-flag")).toMatchObject({ status: "amber" });
    expect(stageById(off, "x-credentials")).toMatchObject({ status: "amber" });

    const on = await buildOutreachPipeline({
      databaseUrl: "",
      env: {
        OUTREACH_QUEUE_ENABLED: "true",
        X_OUTREACH_API_KEY: "a",
        X_OUTREACH_API_SECRET: "b",
        X_OUTREACH_ACCESS_TOKEN: "c",
        X_OUTREACH_ACCESS_SECRET: "d",
      },
      getServiceControl: async () => activeControl({ key: "outreach" }),
    });
    expect(stageById(on, "queue-flag")).toMatchObject({ status: "green" });
    expect(stageById(on, "x-credentials")).toMatchObject({ status: "green" });
  });

  it("never leaks credential values into the credentials stage message", async () => {
    const pipeline = await buildOutreachPipeline({
      databaseUrl: "",
      env: { X_OUTREACH_API_KEY: "super-secret-value" },
      getServiceControl: async () => activeControl({ key: "outreach" }),
    });
    expect(stageById(pipeline, "x-credentials").message).not.toContain("super-secret-value");
  });

  it("is green end to end and reports per-status counts when the table exists", async () => {
    const pipeline = await buildOutreachPipeline({
      databaseUrl: "postgres://test",
      env: {},
      getPool: () => fakePool(),
      getServiceControl: async () => activeControl({ key: "outreach" }),
    });
    expect(stageById(pipeline, "table-exists")).toMatchObject({ status: "green" });
    const counts = stageById(pipeline, "queue-counts");
    expect(counts.status).toBe("green");
    expect(counts.message).toContain("2 pending");
    expect(counts.message).toContain("1 posted");
  });

  it("is red on table-exists and does not probe queue counts when the migration has not been applied", async () => {
    const pipeline = await buildOutreachPipeline({
      databaseUrl: "postgres://test",
      env: {},
      getPool: () => fakePool({ query: async () => ({ rows: [] }) }),
      getServiceControl: async () => activeControl({ key: "outreach" }),
    });
    expect(stageById(pipeline, "table-exists")).toMatchObject({ status: "red" });
    expect(stageById(pipeline, "queue-counts")).toMatchObject({ status: "amber" });
  });

  it("surfaces isolation state from the shared chat-style isolation stage", async () => {
    const pipeline = await buildOutreachPipeline({
      databaseUrl: "",
      env: {},
      getServiceControl: async () => activeControl({ key: "outreach", isolated: true, reason: "maintenance" }),
    });
    expect(stageById(pipeline, "endpoint-reachable")).toMatchObject({ status: "amber" });
  });
});

describe("buildSocialPostingPipeline (issue #335)", () => {
  function fakePool(overrides: {
    query?: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  } = {}) {
    return {
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
      query:
        overrides.query ??
        (async (text: string) => {
          if (text.includes("information_schema.tables")) return { rows: [{ table_name: "social_scheduled_posts" }] };
          if (text.includes("scheduled_job_heartbeats")) {
            return { rows: [{ last_succeeded_at: new Date().toISOString() }] };
          }
          if (text.includes("GROUP BY status")) {
            return { rows: [{ status: "scheduled", count: 2 }, { status: "sent", count: 1 }] };
          }
          return { rows: [] };
        }),
    };
  }

  it("reports the destinations and encryption-key stages from env, independent of the database", async () => {
    const off = await buildSocialPostingPipeline({
      databaseUrl: "",
      env: {},
      getServiceControl: async () => activeControl({ key: "social-posting" }),
    });
    expect(stageById(off, "destinations")).toMatchObject({ status: "amber" });
    expect(stageById(off, "encryption-key")).toMatchObject({ status: "red" });
    expect(stageById(off, "cron-heartbeat")).toMatchObject({ status: "amber" });

    const on = await buildSocialPostingPipeline({
      databaseUrl: "",
      env: {
        X_SOCIAL_CONSUMER_KEY: "a",
        X_SOCIAL_CONSUMER_SECRET: "b",
        TELEGRAM_BOT_TOKEN: "c",
        SOCIAL_CREDENTIALS_ENCRYPTION_KEY: "d",
      },
      getServiceControl: async () => activeControl({ key: "social-posting" }),
    });
    expect(stageById(on, "destinations")).toMatchObject({ status: "green" });
    expect(stageById(on, "encryption-key")).toMatchObject({ status: "green" });
  });

  it("never leaks credential values into the destinations stage message", async () => {
    const pipeline = await buildSocialPostingPipeline({
      databaseUrl: "",
      env: { X_SOCIAL_CONSUMER_KEY: "super-secret-value" },
      getServiceControl: async () => activeControl({ key: "social-posting" }),
    });
    expect(stageById(pipeline, "destinations").message).not.toContain("super-secret-value");
  });

  it("is green end to end and reports per-status counts when the table exists", async () => {
    const pipeline = await buildSocialPostingPipeline({
      databaseUrl: "postgres://test",
      env: {},
      getPool: () => fakePool(),
      getServiceControl: async () => activeControl({ key: "social-posting" }),
    });
    expect(stageById(pipeline, "table-exists")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "cron-heartbeat")).toMatchObject({ status: "green" });
    const counts = stageById(pipeline, "queue-counts");
    expect(counts.status).toBe("green");
    expect(counts.message).toContain("2 scheduled");
    expect(counts.message).toContain("1 sent");
  });

  it("is red on table-exists and does not probe queue counts when the migration has not been applied", async () => {
    const pipeline = await buildSocialPostingPipeline({
      databaseUrl: "postgres://test",
      env: {},
      getPool: () => fakePool({ query: async () => ({ rows: [] }) }),
      getServiceControl: async () => activeControl({ key: "social-posting" }),
    });
    expect(stageById(pipeline, "table-exists")).toMatchObject({ status: "red" });
    expect(stageById(pipeline, "cron-heartbeat")).toMatchObject({ status: "amber" });
    expect(stageById(pipeline, "queue-counts")).toMatchObject({ status: "amber" });
    expect(stageById(pipeline, "cost-cap")).toMatchObject({ status: "amber" });
  });

  it("reports a missing first heartbeat as amber", async () => {
    const pipeline = await buildSocialPostingPipeline({
      databaseUrl: "postgres://test",
      env: {},
      now: new Date("2026-08-17T12:00:00Z"),
      getPool: () =>
        fakePool({
          query: async (text: string) => {
            if (text.includes("information_schema.tables")) return { rows: [{ table_name: "social_scheduled_posts" }] };
            if (text.includes("scheduled_job_heartbeats")) return { rows: [] };
            if (text.includes("GROUP BY status")) return { rows: [] };
            return { rows: [] };
          },
        }),
      getServiceControl: async () => activeControl({ key: "social-posting" }),
    });
    expect(stageById(pipeline, "cron-heartbeat")).toMatchObject({ status: "amber", observedAt: null });
  });

  it("escalates cron freshness from amber after three minutes to red after ten", async () => {
    const now = new Date("2026-08-17T12:00:00Z");
    const pipelineFor = (lastSucceededAt: string) =>
      buildSocialPostingPipeline({
        databaseUrl: "postgres://test",
        env: {},
        now,
        getPool: () =>
          fakePool({
            query: async (text: string) => {
              if (text.includes("information_schema.tables")) return { rows: [{ table_name: "social_scheduled_posts" }] };
              if (text.includes("scheduled_job_heartbeats")) return { rows: [{ last_succeeded_at: lastSucceededAt }] };
              if (text.includes("GROUP BY status")) return { rows: [] };
              return { rows: [] };
            },
          }),
        getServiceControl: async () => activeControl({ key: "social-posting" }),
      });

    const amber = await pipelineFor("2026-08-17T11:55:00Z");
    expect(stageById(amber, "cron-heartbeat")).toMatchObject({ status: "amber" });

    const red = await pipelineFor("2026-08-17T11:49:00Z");
    expect(stageById(red, "cron-heartbeat")).toMatchObject({ status: "red" });
  });

  it("reports heartbeat storage failure as red and names migration 023", async () => {
    const pipeline = await buildSocialPostingPipeline({
      databaseUrl: "postgres://test",
      env: {},
      getPool: () =>
        fakePool({
          query: async (text: string) => {
            if (text.includes("information_schema.tables")) return { rows: [{ table_name: "social_scheduled_posts" }] };
            if (text.includes("scheduled_job_heartbeats")) throw new Error("relation missing");
            if (text.includes("GROUP BY status")) return { rows: [] };
            return { rows: [] };
          },
        }),
      getServiceControl: async () => activeControl({ key: "social-posting" }),
    });
    const heartbeat = stageById(pipeline, "cron-heartbeat");
    expect(heartbeat.status).toBe("red");
    expect(heartbeat.message).toContain("023_scheduled_job_heartbeats.sql");
  });

  it("downgrades a stale heartbeat to amber while the service is deliberately isolated", async () => {
    const pipeline = await buildSocialPostingPipeline({
      databaseUrl: "postgres://test",
      env: {},
      now: new Date("2026-08-17T12:00:00Z"),
      getPool: () =>
        fakePool({
          query: async (text: string) => {
            if (text.includes("information_schema.tables")) return { rows: [{ table_name: "social_scheduled_posts" }] };
            if (text.includes("scheduled_job_heartbeats")) return { rows: [{ last_succeeded_at: "2026-08-17T11:00:00Z" }] };
            if (text.includes("GROUP BY status")) return { rows: [] };
            return { rows: [] };
          },
        }),
      getServiceControl: async () => activeControl({ key: "social-posting", isolated: true, reason: "maintenance" }),
    });
    expect(stageById(pipeline, "endpoint-reachable")).toMatchObject({ status: "amber" });
    expect(stageById(pipeline, "cron-heartbeat")).toMatchObject({ status: "amber" });
  });

  it("reports this month's X posting spend and the configured cap (issue #342)", async () => {
    const pipeline = await buildSocialPostingPipeline({
      databaseUrl: "postgres://test",
      env: { SOCIAL_X_API_SEND_COST_USD: "0.015", SOCIAL_X_MONTHLY_COST_CAP_USD: "5" },
      getPool: () => fakePool(),
      getServiceControl: async () => activeControl({ key: "social-posting" }),
      getCostStore: () => ({
        monthlyTotalsAllWallets: async () => [
          { walletAddress: "0xabc", totalUsd: 0.03, sendCount: 2 },
          { walletAddress: "0xdef", totalUsd: 5, sendCount: 333 },
        ],
      }),
    });
    const costCap = stageById(pipeline, "cost-cap");
    expect(costCap.status).toBe("green");
    expect(costCap.message).toContain("$0.015/send");
    expect(costCap.message).toContain("$5.00/wallet/month cap");
    expect(costCap.message).toContain("335 sends");
    expect(costCap.message).toContain("2 wallets");
    expect(costCap.message).toContain("1 at/over cap");
  });

  it("is red on the cost-cap stage when the cost store throws", async () => {
    const pipeline = await buildSocialPostingPipeline({
      databaseUrl: "postgres://test",
      env: {},
      getPool: () => fakePool(),
      getServiceControl: async () => activeControl({ key: "social-posting" }),
      getCostStore: () => ({
        monthlyTotalsAllWallets: async () => {
          throw new Error("db exploded");
        },
      }),
    });
    expect(stageById(pipeline, "cost-cap")).toMatchObject({ status: "red" });
  });

  it("surfaces isolation state from the shared chat-style isolation stage", async () => {
    const pipeline = await buildSocialPostingPipeline({
      databaseUrl: "",
      env: {},
      getServiceControl: async () => activeControl({ key: "social-posting", isolated: true, reason: "maintenance" }),
    });
    expect(stageById(pipeline, "endpoint-reachable")).toMatchObject({ status: "amber" });
  });

  it("is reachable through the buildServicePipeline dispatcher", async () => {
    const pipeline = await buildServicePipeline("social-posting", {
      env: {},
      socialPosting: { databaseUrl: "", getServiceControl: async () => activeControl({ key: "social-posting" }) },
    });
    expect(pipeline.id).toBe("social-posting");
    expect(stageById(pipeline, "destinations")).toMatchObject({ status: "amber" });
  });
});

describe("buildSocialStudioAiPipeline (issue #332)", () => {
  const env = {
    OPENAI_API_KEY: "test-key",
    GENERATE_SITE_STYLE_SHARED_SECRET: "test-secret",
    NEXT_PUBLIC_GENERATE_SITE_STYLE_SHARED_SECRET: "test-secret",
    DATABASE_URL: "postgres://test",
  };

  it("is green with a direct OpenAI key, a configured secret and a configured database", async () => {
    const pipeline = await buildSocialStudioAiPipeline({
      env,
      getServiceControl: async () => activeControl({ key: "social-studio-ai" }),
    });
    expect(stageById(pipeline, "provider-configured")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "origin-check")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "rate-limiter")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "entitlement-configured")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "mascot-image-provider")).toMatchObject({ status: "green" });
  });

  it("reports the mascot image provider as amber (not red) on the Vercel AI Gateway fallback", async () => {
    const pipeline = await buildSocialStudioAiPipeline({
      env: { ...env, OPENAI_API_KEY: "", AI_GATEWAY_API_KEY: "gateway-key" },
      getServiceControl: async () => activeControl({ key: "social-studio-ai" }),
    });
    expect(stageById(pipeline, "provider-configured")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "mascot-image-provider")).toMatchObject({ status: "amber" });
  });

  it("reports entitlement as red without DATABASE_URL — every route fails closed", async () => {
    const pipeline = await buildSocialStudioAiPipeline({
      env: { ...env, DATABASE_URL: "" },
      getServiceControl: async () => activeControl({ key: "social-studio-ai" }),
    });
    expect(stageById(pipeline, "entitlement-configured")).toMatchObject({ status: "red" });
  });

  it("surfaces isolation state", async () => {
    const pipeline = await buildSocialStudioAiPipeline({
      env,
      getServiceControl: async () => activeControl({ key: "social-studio-ai", isolated: true, reason: "maintenance" }),
    });
    expect(stageById(pipeline, "endpoint-reachable")).toMatchObject({ status: "amber" });
  });

  it("is reachable through the buildServicePipeline dispatcher", async () => {
    const pipeline = await buildServicePipeline("social-studio-ai", {
      env,
      socialStudioAi: { getServiceControl: async () => activeControl({ key: "social-studio-ai" }) },
    });
    expect(pipeline.id).toBe("social-studio-ai");
    expect(stageById(pipeline, "provider-configured")).toMatchObject({ status: "green" });
  });
});

function emptyCostPeriod(overrides: Partial<{ aiCostUsd: number; xCostUsd: number; fixedCostUsd: number; totalCostUsd: number }> = {}) {
  return {
    aiCostUsd: 0,
    xCostUsd: 0,
    variableCostUsd: 0,
    fixedCostUsd: 0,
    totalCostUsd: 0,
    revenueUsdCents: 0,
    marginUsd: 0,
    marginPercent: null,
    ...overrides,
  };
}

describe("buildOperationsCostPipeline (issue #368)", () => {
  const env = { OPERATIONS_MONTHLY_COST_AMBER_USD: "100", OPERATIONS_MONTHLY_COST_RED_USD: "250" };

  it("reports the tables stage red — not amber — when DATABASE_URL is not configured (issue #368 correction pass)", async () => {
    const pipeline = await buildOperationsCostPipeline({ env, databaseUrl: "" });
    expect(stageById(pipeline, "tables")).toMatchObject({ status: "red" });
    expect(stageById(pipeline, "monthly-cost")).toMatchObject({ status: "amber" });
    expect(stageById(pipeline, "pricing-config")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "thresholds")).toMatchObject({ status: "green" });
  });

  it("reports the pricing-config stage amber, by exact variable name, when a configured price is invalid", async () => {
    const pipeline = await buildOperationsCostPipeline({
      env: { ...env, OPENAI_OUTPUT_COST_USD_PER_MILLION: "not-a-number" },
      databaseUrl: "",
    });
    const pricingStage = stageById(pipeline, "pricing-config");
    expect(pricingStage.status).toBe("amber");
    expect(pricingStage.message).toContain("OPENAI_OUTPUT_COST_USD_PER_MILLION");
  });

  it("reports the pricing-config stage green when every configured price is valid", async () => {
    const pipeline = await buildOperationsCostPipeline({
      env: { ...env, OPENAI_INPUT_COST_USD_PER_MILLION: "1" },
      databaseUrl: "",
    });
    expect(stageById(pipeline, "pricing-config")).toMatchObject({ status: "green" });
  });

  it("is amber on the thresholds stage when red <= amber, independent of the database", async () => {
    const pipeline = await buildOperationsCostPipeline({
      env: { OPERATIONS_MONTHLY_COST_AMBER_USD: "250", OPERATIONS_MONTHLY_COST_RED_USD: "100" },
      databaseUrl: "",
    });
    expect(stageById(pipeline, "thresholds")).toMatchObject({ status: "amber" });
  });

  it("is green end to end when this month's total is below the amber threshold", async () => {
    const pipeline = await buildOperationsCostPipeline({
      env,
      databaseUrl: "postgres://test",
      getSnapshot: async () => ({
        status: "ready",
        message: "",
        today: emptyCostPeriod(),
        thisMonth: emptyCostPeriod({ aiCostUsd: 5, xCostUsd: 1, totalCostUsd: 6 }),
        lastMonth: emptyCostPeriod(),
        featureBreakdown: [],
        reconciliation: { attributedCostUsd: 0, unattributedCostUsd: 0, topWallets: [], topWalletsLimit: 10 },
        ledger: [],
        fixedCosts: [],
      }),
    });
    expect(stageById(pipeline, "tables")).toMatchObject({ status: "green" });
    expect(stageById(pipeline, "monthly-cost")).toMatchObject({ status: "green" });
  });

  it("escalates the monthly-cost stage from amber to red as spend crosses each threshold", async () => {
    const snapshotWith = (totalCostUsd: number) =>
      async () => ({
        status: "ready" as const,
        message: "",
        today: emptyCostPeriod(),
        thisMonth: emptyCostPeriod({ totalCostUsd }),
        lastMonth: emptyCostPeriod(),
        featureBreakdown: [],
        reconciliation: { attributedCostUsd: 0, unattributedCostUsd: 0, topWallets: [], topWalletsLimit: 10 },
        ledger: [],
        fixedCosts: [],
      });

    const amber = await buildOperationsCostPipeline({ env, databaseUrl: "postgres://test", getSnapshot: snapshotWith(150) });
    expect(stageById(amber, "monthly-cost")).toMatchObject({ status: "amber" });

    const red = await buildOperationsCostPipeline({ env, databaseUrl: "postgres://test", getSnapshot: snapshotWith(300) });
    expect(stageById(red, "monthly-cost")).toMatchObject({ status: "red" });
  });

  it("is red on tables and does not probe monthly cost when the migration has not been applied", async () => {
    const pipeline = await buildOperationsCostPipeline({
      env,
      databaseUrl: "postgres://test",
      getSnapshot: async () => ({
        status: "unavailable",
        message: "not applied",
        today: emptyCostPeriod(),
        thisMonth: emptyCostPeriod(),
        lastMonth: emptyCostPeriod(),
        featureBreakdown: [],
        reconciliation: { attributedCostUsd: 0, unattributedCostUsd: 0, topWallets: [], topWalletsLimit: 10 },
        ledger: [],
        fixedCosts: [],
      }),
    });
    expect(stageById(pipeline, "tables")).toMatchObject({ status: "red" });
    expect(stageById(pipeline, "monthly-cost")).toMatchObject({ status: "amber" });
  });

  it("is reachable through the buildServicePipeline dispatcher", async () => {
    const pipeline = await buildServicePipeline("operations-cost", { env, operationsCost: { databaseUrl: "" } });
    expect(pipeline.id).toBe("operations-cost");
    expect(stageById(pipeline, "pricing-config")).toMatchObject({ status: "green" });
  });
});
