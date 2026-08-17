import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

type VercelConfig = {
  functions: Record<string, { maxDuration?: number }>;
  crons: Array<{ path: string; schedule: string }>;
};

describe("Vercel cron configuration", () => {
  it("keeps the existing schedules and runs Social Studio posting every minute", async () => {
    const source = await readFile(path.join(process.cwd(), "vercel.json"), "utf8");
    const config = JSON.parse(source) as VercelConfig;

    expect(config.crons).toEqual([
      { path: "/api/cron/subscription-lifecycle", schedule: "0 9 * * *" },
      { path: "/api/cron/outreach", schedule: "*/30 * * * *" },
      { path: "/api/cron/social-posting", schedule: "* * * * *" },
    ]);
    expect(config.functions["app/api/cron/social-posting/route.ts"]?.maxDuration).toBe(60);
    expect(config.functions["app/api/cron/subscription-lifecycle/route.ts"]?.maxDuration).toBe(60);
    expect(config.functions["app/api/cron/outreach/route.ts"]?.maxDuration).toBe(60);
  });
});
