import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_SERVICE_DEFINITIONS, SYSTEM_HEALTH_CHECK_IDS } from "@/lib/admin-operations";
import { SOCIAL_STUDIO_ACTION_PURPOSES } from "@/lib/server/social-studio-action-auth";
import { checkBuyBotHealth, evaluateScheduledJobFreshness, evaluateSocialPostingCronFreshness } from "@/lib/server/system-health";
import { buildBuyBotPipeline, buildServicePipeline } from "@/lib/server/system-health-pipeline";
import { createMemoryBuyBotStore } from "./buy-bot-test-helpers";

const NOW = new Date("2026-09-05T12:00:00Z");
const ENV = { TELEGRAM_BOT_TOKEN: "12345:token-aaaaaaaaaaaaaaaaaaaa", SOCIAL_CREDENTIALS_ENCRYPTION_KEY: "a".repeat(44), DATABASE_URL: "postgres://x" };

const notIsolated = async (key: string) => ({
  key,
  label: key,
  description: "",
  affectedRoutes: "",
  isolated: false,
  reason: "",
  updatedAt: NOW.toISOString(),
}) as never;

describe("Buy Bot registration in the admin cockpit (rule 10)", () => {
  it("adds the buy-bot service key, health check id and the three wallet-signed action purposes", () => {
    const definition = ADMIN_SERVICE_DEFINITIONS.find((item) => item.key === "buy-bot");
    expect(definition?.label).toBe("Buy Bot");
    expect(definition?.affectedRoutes).toContain("/api/cron/buy-bot");
    expect(definition?.affectedRoutes).toContain("/api/social/buy-bot");
    expect(SYSTEM_HEALTH_CHECK_IDS).toContain("buy-bot");
    expect(SOCIAL_STUDIO_ACTION_PURPOSES).toEqual(expect.arrayContaining(["social:buy-bot-enable", "social:buy-bot-update", "social:buy-bot-disable"]));
  });

  it("declares the four new Activity log kinds", async () => {
    const source = await readFile(path.join(process.cwd(), "lib/admin-operations.ts"), "utf8");
    for (const kind of ["buy-bot-enabled", "buy-bot-updated", "buy-bot-disabled", "buy-bot-reconnect-needed"]) {
      expect(source).toContain(`| "${kind}"`);
    }
  });
});

describe("evaluateScheduledJobFreshness", () => {
  it("names the job in the two job-specific messages and keeps the social-posting wording byte-for-byte via the delegating wrapper", () => {
    expect(evaluateScheduledJobFreshness(null, NOW, "buy-bot").message).toBe("The buy-bot cron has not completed successfully yet.");
    expect(evaluateScheduledJobFreshness("garbage", NOW, "buy-bot").message).toBe("The stored buy-bot cron heartbeat is invalid.");
    expect(evaluateSocialPostingCronFreshness(null, NOW)).toEqual(evaluateScheduledJobFreshness(null, NOW, "social-posting"));
    expect(evaluateSocialPostingCronFreshness(null, NOW).message).toBe("The social-posting cron has not completed successfully yet.");
  });

  it("uses the same green/amber/red thresholds for every job", () => {
    expect(evaluateScheduledJobFreshness(new Date(NOW.getTime() - 60_000), NOW, "buy-bot").status).toBe("green");
    expect(evaluateScheduledJobFreshness(new Date(NOW.getTime() - 5 * 60_000), NOW, "buy-bot").status).toBe("amber");
    expect(evaluateScheduledJobFreshness(new Date(NOW.getTime() - 30 * 60_000), NOW, "buy-bot").status).toBe("red");
  });
});

describe("checkBuyBotHealth", () => {
  it("is amber with no DATABASE_URL and no ping", async () => {
    const check = await checkBuyBotHealth({ env: {} });
    expect(check).toMatchObject({ id: "buy-bot", label: "Buy Bot", status: "amber" });
    expect(check.message).toContain("DATABASE_URL is not configured");
    expect(check.message).toContain("Dormant");
  });

  it("is green with a fresh heartbeat and Telegram configured, reporting the counts", async () => {
    const check = await checkBuyBotHealth({
      env: ENV,
      now: NOW,
      ping: async () => ({ lastSucceededAt: new Date(NOW.getTime() - 30_000), counts: { active: 2, paused: 1, reconnect_needed: 0 } }),
    });
    expect(check.status).toBe("green");
    expect(check.message).toContain("2 active, 1 paused, 0 need re-adding");
  });

  it("is amber (never green) when Telegram is unset even with a fresh heartbeat, and red when the ping fails", async () => {
    const dormant = await checkBuyBotHealth({
      env: { ...ENV, TELEGRAM_BOT_TOKEN: "" },
      now: NOW,
      ping: async () => ({ lastSucceededAt: NOW, counts: { active: 0, paused: 0, reconnect_needed: 0 } }),
    });
    expect(dormant.status).toBe("amber");
    const broken = await checkBuyBotHealth({
      env: ENV,
      ping: async () => {
        throw new Error("relation social_buy_bots does not exist");
      },
    });
    expect(broken.status).toBe("red");
    expect(broken.message).toContain("032_social_buy_bots.sql");
  });
});

describe("buildBuyBotPipeline", () => {
  it("reports every stage amber with a plain reason when DATABASE_URL is unset, without touching a pool", async () => {
    const pipeline = await buildBuyBotPipeline({ env: { TELEGRAM_BOT_TOKEN: "t" }, getServiceControl: notIsolated });
    expect(pipeline.id).toBe("buy-bot");
    expect(pipeline.stages.map((stage) => stage.id)).toEqual([
      "endpoint-reachable",
      "telegram-configured",
      "encryption-key",
      "table-exists",
      "cron-heartbeat",
      "bot-counts",
      "alerts-24h",
    ]);
    expect(pipeline.stages.find((stage) => stage.id === "table-exists")?.status).toBe("amber");
    expect(pipeline.stages.find((stage) => stage.id === "encryption-key")?.status).toBe("red");
  });

  it("goes red on a missing table and does not probe the dependent stages", async () => {
    const store = createMemoryBuyBotStore();
    store.tableExists = async () => false;
    const pipeline = await buildBuyBotPipeline({
      env: ENV,
      getServiceControl: notIsolated,
      getStore: () => store,
      getPool: () => ({ totalCount: 0, idleCount: 0, waitingCount: 0, query: async () => ({ rows: [] }) }) as never,
    });
    expect(pipeline.stages.find((stage) => stage.id === "table-exists")).toMatchObject({ status: "red" });
    expect(pipeline.stages.find((stage) => stage.id === "table-exists")?.message).toContain("032_social_buy_bots.sql");
    for (const id of ["cron-heartbeat", "bot-counts", "alerts-24h"]) {
      expect(pipeline.stages.find((stage) => stage.id === id)?.message).toContain("Not probed");
    }
  });

  it("reads counts and the buy-bot heartbeat row when the table exists, flagging bots that need re-adding as amber", async () => {
    const store = createMemoryBuyBotStore();
    await store.upsert({
      walletAddress: "0x1",
      chainId: 46630,
      tokenAddress: "0xa",
      curveAddress: "0xc",
      channelDisplayName: "d",
      channelExternalId: "@c",
      channel: "{}",
      thresholdWei: "10000000000000000",
      cursorBlockNumber: "0",
      cursorLogIndex: -1,
    });
    await store.markReconnectNeeded((await store.get("0x1", 46630, "0xa"))!.id, "gone");
    const queries: string[] = [];
    const pipeline = await buildBuyBotPipeline({
      env: ENV,
      now: NOW,
      getServiceControl: notIsolated,
      getStore: () => store,
      getPool: () =>
        ({
          totalCount: 0,
          idleCount: 0,
          waitingCount: 0,
          query: async (text: string, params?: unknown[]) => {
            queries.push(`${text} ${JSON.stringify(params)}`);
            return { rows: [{ last_succeeded_at: new Date(NOW.getTime() - 20_000) }] };
          },
        }) as never,
    });
    expect(queries.some((query) => query.includes("scheduled_job_heartbeats") && query.includes('["buy-bot"]'))).toBe(true);
    expect(pipeline.stages.find((stage) => stage.id === "cron-heartbeat")).toMatchObject({ status: "green" });
    expect(pipeline.stages.find((stage) => stage.id === "bot-counts")).toMatchObject({ status: "amber" });
    expect(pipeline.stages.find((stage) => stage.id === "bot-counts")?.message).toContain("1 need re-adding");
  });

  it("is reachable through the generic drill-down dispatcher", async () => {
    const pipeline = await buildServicePipeline("buy-bot", { env: {}, buyBot: { getServiceControl: notIsolated } });
    expect(pipeline.id).toBe("buy-bot");
  });
});
