import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("social mascot image usage migration", () => {
  it("creates an idempotent per wallet + project + UTC-day counter with a non-negative count", async () => {
    const sql = await readFile(path.join(process.cwd(), "db/migrations/031_social_mascot_image_usage.sql"), "utf8");
    expect(sql).toContain("BEGIN;");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS social_mascot_image_usage");
    expect(sql).toContain("PRIMARY KEY (wallet_address, project_id, used_on)");
    expect(sql).toContain("image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0)");
    expect(sql).toContain("used_on DATE NOT NULL");
    expect(sql).toContain("COMMIT;");
  });
});
