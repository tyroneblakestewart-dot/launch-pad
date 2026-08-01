import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("Robinhood Chain Pulse UI wiring", () => {
  it("mounts the live feed on the bonding page", async () => {
    const page = await source("app/(app)/bonding-curve/page.tsx");
    expect(page).toContain('import { RobinhoodTrendingFeed } from "@/components/robinhood-trending-feed"');
    expect(page).toContain("<RobinhoodTrendingFeed />");
  });

  it("posts the 5m or 1h interval, refreshes every minute and aborts obsolete requests", async () => {
    const component = await source("components/robinhood-trending-feed.tsx");
    expect(component).toContain('fetch("/api/market/robinhood-trending"');
    expect(component).toContain('method: "POST"');
    expect(component).toContain('{ value: "5m", label: "5 MIN" }');
    expect(component).toContain('{ value: "1h", label: "1 HOUR" }');
    expect(component).toContain("const REFRESH_INTERVAL_MS = 60_000");
    expect(component).toContain("new AbortController()");
    expect(component).toContain("activeController?.abort()");
    expect(component).toContain("window.clearInterval(refreshTimer)");
  });

  it("reuses the existing client secret bridge and keeps GMGN credentials server-side", async () => {
    const bridge = await source("components/generate-site-style-auth-bridge.tsx");
    const route = await source("app/api/market/robinhood-trending/route.ts");
    const envExample = await source(".env.example");

    expect(bridge).toContain('"/api/market/robinhood-trending"');
    expect(route).toContain("process.env.GMGN_API_KEY");
    expect(route).not.toContain("NEXT_PUBLIC_GMGN_API_KEY");
    expect(route).not.toContain("GMGN_PRIVATE_KEY");
    expect(envExample).toContain("GMGN_API_KEY=");
    expect(envExample).not.toContain("NEXT_PUBLIC_GMGN_API_KEY");
  });
});
