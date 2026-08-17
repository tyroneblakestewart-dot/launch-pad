import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("scheduled job heartbeat migration", () => {
  it("uses one primary-keyed row per job and stores only bounded outcome metadata", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/023_scheduled_job_heartbeats.sql"),
      "utf8",
    );

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS scheduled_job_heartbeats");
    expect(sql).toMatch(/job_key\s+VARCHAR\(64\)\s+PRIMARY KEY/i);
    expect(sql).toContain("last_succeeded_at TIMESTAMPTZ");
    expect(sql).toContain("last_status IN ('never', 'running', 'succeeded', 'failed')");
    expect(sql).toContain("last_processed INTEGER");
    expect(sql).not.toContain("error_message");
    expect(sql).not.toContain("post_body");
  });
});
