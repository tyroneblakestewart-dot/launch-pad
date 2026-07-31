import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string) {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("desktop create and bonding home", () => {
  it("combines token creation, honest bonding status and Robinhood discovery", async () => {
    const workspace = await source("components/token-studio-workspace.tsx");

    expect(workspace).toContain("CREATE · BOND · GRADUATE");
    expect(workspace).toContain("<RobinhoodTrendingPanel />");
    expect(workspace).toContain("No Hoodlums bonding tokens are live yet.");
    expect(workspace).toContain("rather than invented Hoodlums trades");
    expect(workspace).toContain("Create new token");
    expect(workspace).toContain("Open saved launches");
    expect(workspace).toContain("<TokenStudio />");
  });

  it("keeps the GMGN key on the server and queries Robinhood at five minutes", async () => {
    const client = await source("lib/gmgn-trending.ts");
    const route = await source("app/api/market/trending/route.ts");

    expect(client).toContain("process.env.GMGN_API_KEY");
    expect(client).not.toContain("NEXT_PUBLIC_GMGN_API_KEY");
    expect(client).toContain('url.searchParams.set("chain", "robinhood")');
    expect(client).toContain('url.searchParams.set("interval", "5m")');
    expect(client).toContain('"X-APIKEY": apiKey');
    expect(route).toContain("s-maxage=30");
    expect(route).not.toContain("GMGN_API_KEY");
  });

  it("aborts obsolete requests and removes the refresh timer on unmount", async () => {
    const panel = await source("components/robinhood-trending-panel.tsx");

    expect(panel).toContain("activeRequest?.abort()");
    expect(panel).toContain("window.clearInterval(interval)");
    expect(panel).toContain("disposed = true");
    expect(panel).toContain("These are not Hoodlums launches or financial advice");
  });
});
