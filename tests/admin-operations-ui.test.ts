import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("admin operations dashboard", () => {
  it("ships five real dashboard sections", async () => {
    const dashboard = await source("components/admin-dashboard.tsx");
    for (const label of [
      "Overview",
      "Activity",
      "Money",
      "Issues",
      "System Health",
    ]) {
      expect(dashboard).toContain(`label: "${label}"`);
    }
    expect(dashboard).toContain('useState<SectionId>("overview")');
  });

  it("explains that isolation affects only one service and cannot lock out admin", async () => {
    const sections = await source("components/admin-operations-sections.tsx");
    expect(sections).toContain("Isolation is a circuit breaker");
    expect(sections).toContain("Admin login, System Health and every other service stay online");
    expect(sections).toContain("cannot be disabled, preventing an accidental lockout");
  });

  it("enforces every circuit breaker in the affected server routes", async () => {
    const expected: Record<string, string> = {
      "app/api/generate-free-site/route.ts": "website-generation",
      "app/api/generate-site-page/route.ts": "website-generation",
      "app/api/generate-site-style/route.ts": "website-generation",
      "app/api/publish/challenge/route.ts": "public-publishing",
      "app/api/publish/route.ts": "public-publishing",
      "app/api/publish/visibility/route.ts": "public-publishing",
      "app/api/trending-robinhood/route.ts": "market-feed",
      "app/api/social/telegram/route.ts": "telegram-publishing",
      "app/api/auth/twitter/start/route.ts": "twitter-oauth",
      "app/api/auth/twitter/callback/route.ts": "twitter-oauth",
      "app/api/auth/telegram/verify/route.ts": "telegram-oauth",
    };

    for (const [file, service] of Object.entries(expected)) {
      const route = await source(file);
      expect(route).toContain("getServiceIsolationResponse");
      expect(route).toContain(`getServiceIsolationResponse("${service}")`);
    }
  });
});
