import { describe, expect, it, vi } from "vitest";
import {
  checkClientErrorsHealth,
  checkContentFilterHealth,
  checkContractsHealth,
  checkDatabaseHealth,
  contractsClient,
  HEALTH_CHECK_TIMEOUT_MS,
  setContractsClientForTests,
  checkDeploymentHealth,
  checkHoodchatHealth,
  checkOperationsCostHealth,
  checkOutreachHealth,
  checkSocialPostingHealth,
  checkSocialStudioAiHealth,
  checkSubscribersHealth,
  checkSupportHealth,
  checkTokenChatHealth,
  checkWebsiteGenerationHealth,
  getSystemHealth,
} from "@/lib/server/system-health";

describe("checkWebsiteGenerationHealth", () => {
  it("is green when an AI generation provider is configured", () => {
    const result = checkWebsiteGenerationHealth({ OPENAI_API_KEY: "test-key" });
    expect(result).toMatchObject({ id: "website-generation", status: "green" });
  });

  it("is amber when no provider is configured, not red — this is expected, not a failure", () => {
    const result = checkWebsiteGenerationHealth({});
    expect(result).toMatchObject({ id: "website-generation", status: "amber" });
  });

  it("is red if reading the environment throws unexpectedly", () => {
    const throwingEnv = {} as Record<string, string | undefined>;
    Object.defineProperty(throwingEnv, "OPENAI_API_KEY", {
      get() {
        throw new Error("boom");
      },
    });
    const result = checkWebsiteGenerationHealth(throwingEnv);
    expect(result).toMatchObject({ id: "website-generation", status: "red" });
  });

  it("is green from the request's Vercel Function OIDC token even with no env credential — regression for the check reporting 'not configured' while generation worked", () => {
    const result = checkWebsiteGenerationHealth({}, "runtime-oidc-token");
    expect(result).toMatchObject({
      id: "website-generation",
      status: "green",
      message: expect.stringContaining("vercel-ai-gateway"),
    });
  });
});

describe("checkSocialStudioAiHealth (issue #332)", () => {
  it("is amber when no AI generation provider is configured", () => {
    const result = checkSocialStudioAiHealth({});
    expect(result).toMatchObject({ id: "social-studio-ai", status: "amber" });
  });

  it("is amber when a provider is configured but the shared secret is missing", () => {
    const result = checkSocialStudioAiHealth({ OPENAI_API_KEY: "test-key" });
    expect(result).toMatchObject({ id: "social-studio-ai", status: "amber" });
  });

  it("is green with a direct OpenAI key and the shared secret configured, and notes mascot images are available", () => {
    const result = checkSocialStudioAiHealth({
      OPENAI_API_KEY: "test-key",
      GENERATE_SITE_STYLE_SHARED_SECRET: "test-secret",
    });
    expect(result).toMatchObject({ id: "social-studio-ai", status: "green" });
    expect(result.message).toContain("Mascot image generation is available");
  });

  it("is green but notes mascot images are unavailable through the Vercel AI Gateway fallback", () => {
    const result = checkSocialStudioAiHealth({
      AI_GATEWAY_API_KEY: "gateway-key",
      GENERATE_SITE_STYLE_SHARED_SECRET: "test-secret",
    });
    expect(result).toMatchObject({ id: "social-studio-ai", status: "green" });
    expect(result.message).toContain("unavailable through this gateway fallback");
  });
});

describe("checkDatabaseHealth", () => {
  it("is green when the ping succeeds", async () => {
    const result = await checkDatabaseHealth({ ping: async () => ({ rows: [{ "?column?": 1 }] }) });
    expect(result).toMatchObject({ id: "database", status: "green" });
  });

  it("is red when the ping rejects", async () => {
    const result = await checkDatabaseHealth({ ping: async () => Promise.reject(new Error("connection refused")) });
    expect(result).toMatchObject({ id: "database", status: "red" });
  });

  it("is red when the ping never resolves before the timeout", async () => {
    // Fake timers rather than a real 5s wait (issue #475), matching
    // tests/public-health-route.test.ts's own hung-probe test. Waiting for
    // real time made this the single slowest test in the suite and left it
    // needing an explicit 10s override just to outrun vitest's default
    // timeout — a margin that shrinks on a loaded CI runner.
    vi.useFakeTimers();
    try {
      const pending = checkDatabaseHealth({ ping: () => new Promise(() => {}) });
      await vi.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS);
      expect(await pending).toMatchObject({ id: "database", status: "red" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is amber when DATABASE_URL is not configured", async () => {
    const result = await checkDatabaseHealth({ databaseUrl: "" });
    expect(result).toMatchObject({ id: "database", status: "amber" });
  });
});

describe("checkContractsHealth", () => {
  it("is green when the configured factory and bonding curve both respond", async () => {
    const result = await checkContractsHealth({
      readFactory: async () => "0xowner",
      readBondingCurve: async () => true,
    });
    expect(result).toMatchObject({ id: "contracts", status: "green" });
  });

  it("is red when every configured contract fails to respond", async () => {
    const result = await checkContractsHealth({
      readFactory: async () => Promise.reject(new Error("rpc down")),
      readBondingCurve: async () => Promise.reject(new Error("rpc down")),
    });
    expect(result).toMatchObject({ id: "contracts", status: "red" });
  });

  it("is amber when one configured contract fails and another is healthy", async () => {
    const result = await checkContractsHealth({
      readFactory: async () => "0xowner",
      readBondingCurve: async () => Promise.reject(new Error("rpc down")),
    });
    expect(result).toMatchObject({ id: "contracts", status: "amber" });
  });

  it("is amber when no factory or bonding curve address is configured for the chain", async () => {
    const result = await checkContractsHealth({ chainId: 1 });
    expect(result).toMatchObject({ id: "contracts", status: "amber" });
  });
});

describe("checkDeploymentHealth", () => {
  it("is green in local development", () => {
    const result = checkDeploymentHealth({ NODE_ENV: "development" });
    expect(result).toMatchObject({ id: "deployment", status: "green" });
  });

  it("is green in production with Vercel deployment metadata present", () => {
    const result = checkDeploymentHealth({ NODE_ENV: "production", VERCEL_ENV: "production" });
    expect(result).toMatchObject({ id: "deployment", status: "green" });
  });

  it("is red in production without Vercel deployment metadata", () => {
    const result = checkDeploymentHealth({ NODE_ENV: "production" });
    expect(result).toMatchObject({ id: "deployment", status: "red" });
  });
});

describe("checkSubscribersHealth", () => {
  it("is green when the subscriptions table ping succeeds", async () => {
    const result = await checkSubscribersHealth({ ping: async () => ({ rows: [] }) });
    expect(result).toMatchObject({ id: "subscribers", status: "green" });
  });

  it("is red when the ping rejects (e.g. the migration has not been applied)", async () => {
    const result = await checkSubscribersHealth({
      ping: async () => Promise.reject(new Error(`relation "subscriptions" does not exist`)),
    });
    expect(result).toMatchObject({ id: "subscribers", status: "red" });
  });

  it("is amber when DATABASE_URL is not configured", async () => {
    const result = await checkSubscribersHealth({ databaseUrl: "" });
    expect(result).toMatchObject({ id: "subscribers", status: "amber" });
  });
});

describe("checkHoodchatHealth", () => {
  it("is green when the hoodchat_messages table ping succeeds", async () => {
    const result = await checkHoodchatHealth({ ping: async () => ({ rows: [] }) });
    expect(result).toMatchObject({ id: "hoodchat", status: "green" });
  });

  it("is red when the ping rejects (e.g. the migration has not been applied)", async () => {
    const result = await checkHoodchatHealth({
      ping: async () => Promise.reject(new Error(`relation "hoodchat_messages" does not exist`)),
    });
    expect(result).toMatchObject({ id: "hoodchat", status: "red" });
  });

  it("is amber when DATABASE_URL is not configured", async () => {
    const result = await checkHoodchatHealth({ databaseUrl: "" });
    expect(result).toMatchObject({ id: "hoodchat", status: "amber" });
  });
});

describe("checkTokenChatHealth", () => {
  it("is green when the token_chat_messages table ping succeeds", async () => {
    const result = await checkTokenChatHealth({ ping: async () => ({ rows: [] }) });
    expect(result).toMatchObject({ id: "token-chat", status: "green" });
  });

  it("is red when the ping rejects (e.g. the migration has not been applied)", async () => {
    const result = await checkTokenChatHealth({
      ping: async () => Promise.reject(new Error(`relation "token_chat_messages" does not exist`)),
    });
    expect(result).toMatchObject({ id: "token-chat", status: "red" });
  });

  it("is amber when DATABASE_URL is not configured", async () => {
    const result = await checkTokenChatHealth({ databaseUrl: "" });
    expect(result).toMatchObject({ id: "token-chat", status: "amber" });
  });
});

describe("checkOutreachHealth", () => {
  it("is green when the outreach_queue_items table ping succeeds, and reports the queue flag state", async () => {
    const off = await checkOutreachHealth({ ping: async () => ({ rows: [] }), env: {} });
    expect(off).toMatchObject({ id: "outreach", status: "green" });
    expect(off.message).toContain("dormant");

    const on = await checkOutreachHealth({
      ping: async () => ({ rows: [] }),
      env: { OUTREACH_QUEUE_ENABLED: "true" },
    });
    expect(on.message).toContain("Queue flag is on");
  });

  it("is red when the ping rejects (e.g. the migration has not been applied)", async () => {
    const result = await checkOutreachHealth({
      ping: async () => Promise.reject(new Error(`relation "outreach_queue_items" does not exist`)),
    });
    expect(result).toMatchObject({ id: "outreach", status: "red" });
  });

  it("is amber when DATABASE_URL is not configured", async () => {
    const result = await checkOutreachHealth({ databaseUrl: "", env: {} });
    expect(result).toMatchObject({ id: "outreach", status: "amber" });
  });

  it("never leaks X_OUTREACH_* credential values into the message", async () => {
    const result = await checkOutreachHealth({
      ping: async () => ({ rows: [] }),
      env: { X_OUTREACH_API_KEY: "super-secret-value" },
    });
    expect(result.message).not.toContain("super-secret-value");
  });
});

describe("checkSocialPostingHealth", () => {
  const now = new Date("2026-08-17T12:00:00Z");

  it("is green when the queue is reachable, a destination is configured, and the cron succeeded recently", async () => {
    const result = await checkSocialPostingHealth({
      ping: async () => ({ lastSucceededAt: new Date("2026-08-17T11:58:30Z") }),
      env: { X_SOCIAL_CONSUMER_KEY: "k", X_SOCIAL_CONSUMER_SECRET: "s" },
      now,
    });
    expect(result).toMatchObject({ id: "social-posting", status: "green" });
    expect(result.message).toContain("Only X is configured");
    expect(result.message).toContain("last completed successfully");
  });

  it("is amber when the table is reachable but neither destination is configured", async () => {
    const result = await checkSocialPostingHealth({
      ping: async () => ({ lastSucceededAt: new Date("2026-08-17T11:59:00Z") }),
      env: {},
      now,
    });
    expect(result).toMatchObject({ id: "social-posting", status: "amber" });
    expect(result.message).toContain("Dormant");
  });

  it("is amber before the first successful cron completion", async () => {
    const result = await checkSocialPostingHealth({
      ping: async () => ({ lastSucceededAt: null }),
      env: { TELEGRAM_BOT_TOKEN: "configured" },
      now,
    });
    expect(result).toMatchObject({ id: "social-posting", status: "amber" });
    expect(result.message).toContain("has not completed successfully yet");
  });

  it("is amber after three minutes and red after ten minutes without a successful run", async () => {
    const amber = await checkSocialPostingHealth({
      ping: async () => ({ lastSucceededAt: new Date("2026-08-17T11:55:00Z") }),
      env: { TELEGRAM_BOT_TOKEN: "configured" },
      now,
    });
    expect(amber).toMatchObject({ status: "amber" });

    const red = await checkSocialPostingHealth({
      ping: async () => ({ lastSucceededAt: new Date("2026-08-17T11:49:00Z") }),
      env: { TELEGRAM_BOT_TOKEN: "configured" },
      now,
    });
    expect(red).toMatchObject({ status: "red" });
    expect(red.message).toContain("cron is stale");
  });

  it("is red when the posting queue or heartbeat read rejects", async () => {
    const result = await checkSocialPostingHealth({
      ping: async () => Promise.reject(new Error(`relation "scheduled_job_heartbeats" does not exist`)),
      now,
    });
    expect(result).toMatchObject({ id: "social-posting", status: "red" });
    expect(result.message).toContain("023_scheduled_job_heartbeats.sql");
  });

  it("is amber when DATABASE_URL is not configured", async () => {
    const result = await checkSocialPostingHealth({ databaseUrl: "", env: {}, now });
    expect(result).toMatchObject({ id: "social-posting", status: "amber" });
  });

  it("never leaks credential values into the message", async () => {
    const result = await checkSocialPostingHealth({
      ping: async () => ({ lastSucceededAt: now }),
      env: { X_SOCIAL_CONSUMER_KEY: "super-secret-value", X_SOCIAL_CONSUMER_SECRET: "s" },
      now,
    });
    expect(result.message).not.toContain("super-secret-value");
  });
});

describe("checkClientErrorsHealth", () => {
  it("is green when there are no new error groups in the last 24 hours", async () => {
    const result = await checkClientErrorsHealth({ ping: async () => ({ newGroupCount: 0 }) });
    expect(result).toMatchObject({ id: "client-errors", status: "green" });
  });

  it("is amber when 1-2 new error groups appeared in the last 24 hours", async () => {
    const result = await checkClientErrorsHealth({ ping: async () => ({ newGroupCount: 2 }) });
    expect(result).toMatchObject({ id: "client-errors", status: "amber" });
  });

  it("is red when 3 or more new error groups appeared in the last 24 hours", async () => {
    const result = await checkClientErrorsHealth({ ping: async () => ({ newGroupCount: 3 }) });
    expect(result).toMatchObject({ id: "client-errors", status: "red" });
  });

  it("is red when the ping rejects (e.g. the migration has not been applied)", async () => {
    const result = await checkClientErrorsHealth({
      ping: async () => Promise.reject(new Error(`relation "client_errors" does not exist`)),
    });
    expect(result).toMatchObject({ id: "client-errors", status: "red" });
  });

  it("is amber when DATABASE_URL is not configured", async () => {
    const result = await checkClientErrorsHealth({ databaseUrl: "" });
    expect(result).toMatchObject({ id: "client-errors", status: "amber" });
  });
});

describe("checkContentFilterHealth", () => {
  it("is green and reports a positive term-list size even with no database configured", async () => {
    const result = await checkContentFilterHealth({ databaseUrl: "" });
    expect(result).toMatchObject({ id: "content-filter", status: "green" });
    expect(result.message).toMatch(/\d+ terms across \d+ categories/);
  });

  it("is green and reports the rejection count when the ping succeeds", async () => {
    const result = await checkContentFilterHealth({ ping: async () => ({ rejections24h: 4 }) });
    expect(result).toMatchObject({ id: "content-filter", status: "green" });
    expect(result.message).toContain("4 rejection(s) in the last 24 hours");
  });

  it("is amber when the rejection-count ping fails", async () => {
    const result = await checkContentFilterHealth({ ping: async () => Promise.reject(new Error("boom")) });
    expect(result).toMatchObject({ id: "content-filter", status: "amber" });
  });
});

describe("checkSupportHealth", () => {
  it("is green when the table ping succeeds, and reports whether the Telegram alert is configured", async () => {
    const unconfigured = await checkSupportHealth({
      ping: async () => ({ openCount: 0, oldestOpenAgeSeconds: null }),
      env: {},
    });
    expect(unconfigured).toMatchObject({ id: "support", status: "green" });
    expect(unconfigured.message).toContain("Owner Telegram alert is not configured");

    const configured = await checkSupportHealth({
      ping: async () => ({ openCount: 2, oldestOpenAgeSeconds: 3600 }),
      env: { TELEGRAM_ADMIN_CHAT_ID: "-100123" },
    });
    expect(configured.message).toContain("2 open ticket(s)");
    expect(configured.message).toContain("Owner Telegram alert is configured");
  });

  it("is red when the ping rejects (e.g. the migration has not been applied)", async () => {
    const result = await checkSupportHealth({
      ping: async () => Promise.reject(new Error(`relation "support_tickets" does not exist`)),
    });
    expect(result).toMatchObject({ id: "support", status: "red" });
  });

  it("is red when DATABASE_URL is not configured", async () => {
    const result = await checkSupportHealth({ databaseUrl: "", env: {} });
    expect(result).toMatchObject({ id: "support", status: "red" });
  });
});

describe("checkOperationsCostHealth", () => {
  it("is amber when the amber/red thresholds are misconfigured (red <= amber) but storage is reachable", async () => {
    const result = await checkOperationsCostHealth({
      env: { OPERATIONS_MONTHLY_COST_AMBER_USD: "250", OPERATIONS_MONTHLY_COST_RED_USD: "100" },
      ping: async () => ({ totalCostUsd: 10 }),
    });
    expect(result).toMatchObject({ id: "operations-cost", status: "amber" });
    expect(result.message).toContain("must be greater than");
  });

  it("is red — not amber — when DATABASE_URL is not configured, even with valid thresholds (issue #368 correction pass)", async () => {
    const result = await checkOperationsCostHealth({
      env: { OPERATIONS_MONTHLY_COST_AMBER_USD: "100", OPERATIONS_MONTHLY_COST_RED_USD: "250" },
      databaseUrl: "",
    });
    expect(result).toMatchObject({ id: "operations-cost", status: "red" });
  });

  it("prefers red storage-unavailable over amber invalid-thresholds: red wins when both are wrong", async () => {
    const result = await checkOperationsCostHealth({
      env: { OPERATIONS_MONTHLY_COST_AMBER_USD: "250", OPERATIONS_MONTHLY_COST_RED_USD: "100" },
      databaseUrl: "",
    });
    expect(result).toMatchObject({ id: "operations-cost", status: "red" });
    expect(result.message).not.toContain("must be greater than");
  });

  it("is green when this month's estimated cost is below the amber threshold", async () => {
    const result = await checkOperationsCostHealth({
      env: { OPERATIONS_MONTHLY_COST_AMBER_USD: "100", OPERATIONS_MONTHLY_COST_RED_USD: "250" },
      ping: async () => ({ totalCostUsd: 10 }),
    });
    expect(result).toMatchObject({ id: "operations-cost", status: "green" });
  });

  it("is amber at/above the amber threshold and below red", async () => {
    const result = await checkOperationsCostHealth({
      env: { OPERATIONS_MONTHLY_COST_AMBER_USD: "100", OPERATIONS_MONTHLY_COST_RED_USD: "250" },
      ping: async () => ({ totalCostUsd: 150 }),
    });
    expect(result).toMatchObject({ id: "operations-cost", status: "amber" });
  });

  it("is red at/above the red threshold", async () => {
    const result = await checkOperationsCostHealth({
      env: { OPERATIONS_MONTHLY_COST_AMBER_USD: "100", OPERATIONS_MONTHLY_COST_RED_USD: "250" },
      ping: async () => ({ totalCostUsd: 250 }),
    });
    expect(result).toMatchObject({ id: "operations-cost", status: "red" });
  });

  it("is red when the tables cannot be read", async () => {
    const result = await checkOperationsCostHealth({
      env: { OPERATIONS_MONTHLY_COST_AMBER_USD: "100", OPERATIONS_MONTHLY_COST_RED_USD: "250" },
      ping: async () => Promise.reject(new Error(`relation "ai_operation_costs" does not exist`)),
    });
    expect(result).toMatchObject({ id: "operations-cost", status: "red" });
  });
});

describe("getSystemHealth", () => {
  it("returns all fifteen checks, one per required area", async () => {
    const checks = await getSystemHealth({
      env: { NODE_ENV: "development" },
      database: { databaseUrl: "" },
      contracts: { chainId: 1 },
      subscribers: { databaseUrl: "" },
      hoodchat: { databaseUrl: "" },
      tokenChat: { databaseUrl: "" },
      outreach: { databaseUrl: "" },
      socialPosting: { databaseUrl: "" },
      clientErrors: { databaseUrl: "" },
      operationsCost: { databaseUrl: "" },
      contentFilter: { databaseUrl: "" },
      support: { databaseUrl: "" },
      tokenLaunches: { databaseUrl: "" },
    });
    expect(checks.map((check) => check.id).sort()).toEqual(
      [
        "buy-bot",
        "client-errors",
        "content-filter",
        "contracts",
        "database",
        "deployment",
        "hoodchat",
        "operations-cost",
        "outreach",
        "social-posting",
        "social-studio-ai",
        "subscribers",
        "support",
        "token-chat",
        "token-launches",
        "website-generation",
      ].sort(),
    );
  });

  it("threads the request OIDC token into the website-generation check", async () => {
    const checks = await getSystemHealth({
      env: { NODE_ENV: "development" },
      requestOidcToken: "runtime-oidc-token",
      database: { databaseUrl: "" },
      contracts: { chainId: 1 },
      subscribers: { databaseUrl: "" },
    });
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
    expect(byId["website-generation"].status).toBe("green");
  });

  it("keeps every other check intact when one check fails", async () => {
    const checks = await getSystemHealth({
      env: { NODE_ENV: "development" },
      database: { ping: async () => Promise.reject(new Error("down")) },
      contracts: { chainId: 1 },
      subscribers: { databaseUrl: "" },
    });
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
    expect(byId.database.status).toBe("red");
    expect(byId.deployment.status).toBe("green");
    expect(byId.contracts.status).toBe("amber");
    expect(byId["website-generation"].status).toBe("amber");
  });
});

describe("contracts RPC is never real in tests (issue #475)", () => {
  it("tests/setup.ts installs a failing client by default, so a check that injects nothing can never reach the network", async () => {
    // Deliberately injects nothing — this asserts the global default from
    // tests/setup.ts is in force. Before it existed, this call built a real
    // viem client pointed at the live Robinhood testnet RPC.
    await expect(contractsClient(46630, undefined).getChainId()).rejects.toThrow(/RPC is disabled in tests/);
  });

  it("contractsClient returns the injected client outright, so no real client is constructed even when an rpcUrl is passed", () => {
    const fake = { getChainId: async () => 46630, readContract: async () => null };
    setContractsClientForTests(fake as never);
    expect(contractsClient(46630, "https://rpc.example.invalid")).toBe(fake);
  });

  it("an uninjected contracts health check goes through that client rather than the network, and still reports red", async () => {
    let calls = 0;
    setContractsClientForTests({
      getChainId: async () => {
        calls += 1;
        throw new Error("RPC is disabled in tests");
      },
      readContract: async () => {
        calls += 1;
        throw new Error("RPC is disabled in tests");
      },
    } as never);

    const result = await checkContractsHealth();
    expect(calls).toBeGreaterThan(0);
    expect(result).toMatchObject({ id: "contracts", status: "red" });
  });
});
