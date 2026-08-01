import { describe, expect, it } from "vitest";
import {
  checkContractsHealth,
  checkDatabaseHealth,
  checkDeploymentHealth,
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
    const result = await checkDatabaseHealth({ ping: () => new Promise(() => {}) });
    expect(result).toMatchObject({ id: "database", status: "red" });
  }, 10_000);

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

describe("getSystemHealth", () => {
  it("returns all four checks, one per required area", async () => {
    const checks = await getSystemHealth({
      env: { NODE_ENV: "development" },
      database: { databaseUrl: "" },
      contracts: { chainId: 1 },
    });
    expect(checks.map((check) => check.id).sort()).toEqual(
      ["contracts", "database", "deployment", "website-generation"].sort(),
    );
  });

  it("keeps every other check intact when one check fails", async () => {
    const checks = await getSystemHealth({
      env: { NODE_ENV: "development" },
      database: { ping: async () => Promise.reject(new Error("down")) },
      contracts: { chainId: 1 },
    });
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
    expect(byId.database.status).toBe("red");
    expect(byId.deployment.status).toBe("green");
    expect(byId.contracts.status).toBe("amber");
    expect(byId["website-generation"].status).toBe("amber");
  });
});
