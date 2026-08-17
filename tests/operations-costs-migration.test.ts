import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.join(process.cwd(), "db", "migrations", "022_operations_costs.sql");

describe("022_operations_costs.sql (issue #368)", () => {
  it("creates ai_operation_costs with every required column, snapshot price columns and non-negative constraints", async () => {
    const sql = await readFile(MIGRATION_PATH, "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ai_operation_costs");
    for (const column of [
      "id UUID PRIMARY KEY DEFAULT gen_random_uuid()",
      "occurred_at TIMESTAMPTZ",
      "feature_key VARCHAR(64) NOT NULL",
      "wallet_address VARCHAR(42)",
      "access_source VARCHAR(16) NOT NULL CHECK (access_source IN ('paid', 'test-allowlist', 'free', 'unknown'))",
      "provider VARCHAR(24) NOT NULL CHECK (provider IN ('openai', 'vercel-ai-gateway'))",
      "model VARCHAR(64) NOT NULL",
      "input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0)",
      "cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0)",
      "output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0)",
      "image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0)",
      "web_search_call_count INTEGER NOT NULL DEFAULT 0 CHECK (web_search_call_count >= 0)",
      "estimated_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0)",
    ]) {
      expect(sql).toContain(column);
    }
  });

  it("snapshots every unit price used, so historical rows stay explainable after env changes", async () => {
    const sql = await readFile(MIGRATION_PATH, "utf8");
    for (const column of [
      "input_cost_usd_per_million",
      "cached_input_cost_usd_per_million",
      "output_cost_usd_per_million",
      "web_search_cost_usd_per_call",
      "image_cost_usd_per_image",
    ]) {
      expect(sql).toContain(column);
    }
  });

  it("validates wallet_address format when non-null", async () => {
    const sql = await readFile(MIGRATION_PATH, "utf8");
    expect(sql).toContain("CHECK (wallet_address IS NULL OR wallet_address ~ '^0x[0-9a-fA-F]{40}$')");
  });

  it("creates the required aggregation indexes", async () => {
    const sql = await readFile(MIGRATION_PATH, "utf8");
    expect(sql).toContain("ai_operation_costs_occurred_at_idx");
    expect(sql).toContain("ON ai_operation_costs (occurred_at DESC)");
    expect(sql).toContain("ai_operation_costs_feature_occurred_idx");
    expect(sql).toContain("ON ai_operation_costs (feature_key, occurred_at DESC)");
    expect(sql).toContain("ai_operation_costs_wallet_occurred_idx");
    expect(sql).toContain("ON ai_operation_costs (LOWER(wallet_address), occurred_at DESC)");
    expect(sql).toContain("WHERE wallet_address IS NOT NULL");
  });

  it("creates fixed_operating_costs with cadence and positive-amount constraints", async () => {
    const sql = await readFile(MIGRATION_PATH, "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS fixed_operating_costs");
    expect(sql).toContain("amount_usd NUMERIC(12, 2) NOT NULL CHECK (amount_usd > 0)");
    expect(sql).toContain("cadence VARCHAR(8) NOT NULL CHECK (cadence IN ('monthly', 'annual'))");
    expect(sql).toContain("created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
    expect(sql).toContain("updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  });

  it("never duplicates X rows — no table named social_x_send_costs is created here (it remains 019's)", async () => {
    const sql = await readFile(MIGRATION_PATH, "utf8");
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS social_x_send_costs/);
    expect(sql).not.toContain("INSERT INTO social_x_send_costs");
  });

  it("is wrapped in a single transaction", async () => {
    const sql = await readFile(MIGRATION_PATH, "utf8");
    expect(sql.trim().startsWith("BEGIN;") || sql.includes("\nBEGIN;")).toBe(true);
    expect(sql).toContain("COMMIT;");
  });
});
