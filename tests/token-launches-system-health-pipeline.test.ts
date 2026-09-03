import { afterEach, describe, expect, it } from "vitest";
import type { AdminServiceControl } from "@/lib/admin-operations";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { CURVE_LAUNCH_PIPELINE_ADDRESSES_ENV_VAR } from "@/lib/curve-launch-pipeline-config";
import { buildTokenLaunchesPipeline } from "@/lib/server/system-health-pipeline";
import {
  resetTokenLaunchesStoreForTests,
  setTokenLaunchesStoreForTests,
  type TokenLaunchesStore,
} from "@/lib/server/token-launches-store";

function stageById(pipeline: { stages: Array<{ id: string }> }, id: string) {
  const stage = pipeline.stages.find((candidate) => candidate.id === id);
  if (!stage) throw new Error(`No stage with id ${id}`);
  return stage;
}

function activeControl(overrides: Partial<AdminServiceControl> = {}): AdminServiceControl {
  return {
    key: "token-launches",
    label: "Token launches",
    description: "",
    affectedRoutes: "",
    isolated: false,
    reason: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fakeStore(overrides: Partial<TokenLaunchesStore> = {}): TokenLaunchesStore {
  return {
    async record() {
      throw new Error("not used in this test");
    },
    async list() {
      return [];
    },
    async listForAdmin() {
      return [];
    },
    async findByTokenAddress() {
      return null;
    },
    async findTokenLaunchCreatedAtByCurveAddress() {
      return null;
    },
    async findTokenLaunchGraduatedAtByCurveAddress() {
      return null;
    },
    async markGraduated() {},
    async countLast24h() {
      return 0;
    },
    async tableExists() {
      return true;
    },
    ...overrides,
  };
}

const PIPELINE_ADDRESS = "0x1234567890123456789012345678901234567890";
const CONFIGURED_ENV = {
  [CURVE_LAUNCH_PIPELINE_ADDRESSES_ENV_VAR]: JSON.stringify({
    [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: PIPELINE_ADDRESS,
  }),
};

afterEach(() => {
  resetTokenLaunchesStoreForTests();
});

describe("buildTokenLaunchesPipeline", () => {
  it("reports the curve-deployment-config stage amber when no pipeline is configured for Robinhood testnet", async () => {
    const pipeline = await buildTokenLaunchesPipeline({
      env: {},
      getServiceControl: async () => activeControl(),
    });
    expect(stageById(pipeline, "curve-deployment-config")).toMatchObject({ status: "amber" });
  });

  it("reports the curve-deployment-config stage green with the graduation target once a pipeline is configured", async () => {
    const pipeline = await buildTokenLaunchesPipeline({
      env: CONFIGURED_ENV,
      getServiceControl: async () => activeControl(),
    });
    const stage = stageById(pipeline, "curve-deployment-config");
    expect(stage.status).toBe("green");
    expect(stage.message).toContain(PIPELINE_ADDRESS);
  });

  it("reports the DB-dependent stages amber when DATABASE_URL is not configured", async () => {
    const pipeline = await buildTokenLaunchesPipeline({
      env: {},
      getServiceControl: async () => activeControl(),
    });
    expect(stageById(pipeline, "launches-table")).toMatchObject({ status: "amber" });
    expect(stageById(pipeline, "launches-24h")).toMatchObject({ status: "amber" });
  });

  it("is green end to end once the table exists with recent launches", async () => {
    setTokenLaunchesStoreForTests(fakeStore({ tableExists: async () => true, countLast24h: async () => 3 }));
    const pipeline = await buildTokenLaunchesPipeline({
      env: { ...CONFIGURED_ENV, DATABASE_URL: "postgres://test" },
      getServiceControl: async () => activeControl(),
    });
    expect(stageById(pipeline, "launches-table")).toMatchObject({ status: "green" });
    const launches24h = stageById(pipeline, "launches-24h");
    expect(launches24h.status).toBe("green");
    expect(launches24h.message).toContain("3 launch(es)");
  });

  it("is red on launches-table and does not probe the 24h count when the table doesn't exist yet", async () => {
    setTokenLaunchesStoreForTests(fakeStore({ tableExists: async () => false }));
    const pipeline = await buildTokenLaunchesPipeline({
      env: { DATABASE_URL: "postgres://test" },
      getServiceControl: async () => activeControl(),
    });
    expect(stageById(pipeline, "launches-table")).toMatchObject({ status: "red" });
    expect(stageById(pipeline, "launches-24h")).toMatchObject({ status: "amber" });
  });

  it("reflects an isolated service on the isolation stage", async () => {
    const pipeline = await buildTokenLaunchesPipeline({
      env: {},
      getServiceControl: async () => activeControl({ isolated: true, reason: "maintenance" }),
    });
    expect(stageById(pipeline, "endpoint-reachable")).toMatchObject({ status: "amber" });
  });

  it("reports curve-progress-read amber when the cache has never been warmed", async () => {
    const pipeline = await buildTokenLaunchesPipeline({
      env: {},
      getServiceControl: async () => activeControl(),
      readCurveProgressCacheHealth: () => ({ lastReadAt: null, lastReadOk: null, ageMs: null }),
    });
    expect(stageById(pipeline, "curve-progress-read")).toMatchObject({ status: "amber" });
  });

  it("reports curve-progress-read green with the cache age after a successful read", async () => {
    const pipeline = await buildTokenLaunchesPipeline({
      env: {},
      getServiceControl: async () => activeControl(),
      readCurveProgressCacheHealth: () => ({ lastReadAt: 1000, lastReadOk: true, ageMs: 5000 }),
    });
    const stage = stageById(pipeline, "curve-progress-read");
    expect(stage.status).toBe("green");
    expect(stage.message).toContain("5s ago");
  });

  it("reports curve-progress-read red after a failed read", async () => {
    const pipeline = await buildTokenLaunchesPipeline({
      env: { DATABASE_URL: "postgres://test" },
      getServiceControl: async () => activeControl(),
      readCurveProgressCacheHealth: () => ({ lastReadAt: 1000, lastReadOk: false, ageMs: 3000 }),
    });
    expect(stageById(pipeline, "curve-progress-read")).toMatchObject({ status: "red" });
  });

  it("reports trades-read amber when the cache has never been warmed", async () => {
    const pipeline = await buildTokenLaunchesPipeline({
      env: {},
      getServiceControl: async () => activeControl(),
      readTokenTradesReadHealth: () => ({ lastReadAt: null, lastReadOk: null, ageMs: null }),
    });
    expect(stageById(pipeline, "trades-read")).toMatchObject({ status: "amber" });
  });

  it("reports trades-read green with the read age after a successful read", async () => {
    const pipeline = await buildTokenLaunchesPipeline({
      env: {},
      getServiceControl: async () => activeControl(),
      readTokenTradesReadHealth: () => ({ lastReadAt: 1000, lastReadOk: true, ageMs: 5000 }),
    });
    const stage = stageById(pipeline, "trades-read");
    expect(stage.status).toBe("green");
    expect(stage.message).toContain("5s ago");
  });

  it("reports trades-read red after a failed read", async () => {
    const pipeline = await buildTokenLaunchesPipeline({
      env: { DATABASE_URL: "postgres://test" },
      getServiceControl: async () => activeControl(),
      readTokenTradesReadHealth: () => ({ lastReadAt: 1000, lastReadOk: false, ageMs: 3000 }),
    });
    expect(stageById(pipeline, "trades-read")).toMatchObject({ status: "red" });
  });

  it("reports holder-stats-read amber when the cache has never been warmed (token page v2 part 3, rule 10)", async () => {
    const pipeline = await buildTokenLaunchesPipeline({
      env: {},
      getServiceControl: async () => activeControl(),
      readTokenHolderStatsReadHealth: () => ({ lastReadAt: null, lastReadOk: null, ageMs: null }),
    });
    expect(stageById(pipeline, "holder-stats-read")).toMatchObject({ status: "amber" });
  });

  it("reports holder-stats-read green with the read age after a successful read", async () => {
    const pipeline = await buildTokenLaunchesPipeline({
      env: {},
      getServiceControl: async () => activeControl(),
      readTokenHolderStatsReadHealth: () => ({ lastReadAt: 1000, lastReadOk: true, ageMs: 5000 }),
    });
    const stage = stageById(pipeline, "holder-stats-read");
    expect(stage.status).toBe("green");
    expect(stage.message).toContain("5s ago");
  });

  it("reports holder-stats-read red after a failed read, in both the configured and unconfigured DATABASE_URL branches", async () => {
    const configured = await buildTokenLaunchesPipeline({
      env: { DATABASE_URL: "postgres://test" },
      getServiceControl: async () => activeControl(),
      readTokenHolderStatsReadHealth: () => ({ lastReadAt: 1000, lastReadOk: false, ageMs: 3000 }),
    });
    expect(stageById(configured, "holder-stats-read")).toMatchObject({ status: "red" });
    const unconfigured = await buildTokenLaunchesPipeline({
      env: {},
      getServiceControl: async () => activeControl(),
      readTokenHolderStatsReadHealth: () => ({ lastReadAt: 1000, lastReadOk: false, ageMs: 3000 }),
    });
    expect(stageById(unconfigured, "holder-stats-read")).toMatchObject({ status: "red" });
    expect(unconfigured.stages.map((stage) => stage.id)).toEqual(configured.stages.map((stage) => stage.id));
  });
});
