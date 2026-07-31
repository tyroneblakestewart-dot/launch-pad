import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]) {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Hoodlums bonding-market studio home (issue #185)", () => {
  it("wires the market home shell around the existing entry-point components", async () => {
    const page = await source("app", "(app)", "page.tsx");

    expect(page).toContain("HoodlumsMarketHome");
    expect(page).toContain("listLiveGeneratedSites");
    expect(page).toContain("ArtworkUploadController");
    expect(page).toContain("TokenStudioWorkspace");
    expect(page).toContain('id="launch-studio"');
  });

  it("renders the topbar pulse indicator, hero copy and fact pills", async () => {
    const component = await source("components", "hoodlums-market-home.tsx");

    expect(component).toContain("5-MIN ROBINHOOD MARKET PULSE");
    expect(component).toContain("+ Create");
    expect(component).toContain("Account");
    expect(component).toContain("HOODLUMS BONDING MARKET");
    expect(component).toContain("locked liquidity.");
    expect(component).toContain("Create new token");
    expect(component).toContain("0% token tax");
    expect(component).toContain("No mint function");
    expect(component).toContain("No owner");
    expect(component).toContain("LP locked at graduation");
    expect(component).toContain("All facts on-chain");
    expect(component).toContain("HoodlumsTokenGrid");
    expect(component).toContain("RobinhoodTrendingPanel");
  });

  it("shows tabs, a graduation bar and an honest empty state on the token grid", async () => {
    const component = await source("components", "hoodlums-token-grid.tsx");

    expect(component).toContain("HOODLUMS TOKENS");
    expect(component).toContain("Bonding");
    expect(component).toContain("Graduated");
    expect(component).toContain("Be the first");
    expect(component).toContain("No Hoodlums tokens on the curve yet");
    expect(component).toContain("Be next");
  });

  it("polls the trending feed every 60 seconds and cleans up on unmount", async () => {
    const component = await source("components", "robinhood-trending-panel.tsx");

    expect(component).toContain('"use client"');
    expect(component).toContain("/api/trending-robinhood");
    expect(component).toContain("POLL_INTERVAL_MS = 60_000");
    expect(component).toContain("window.setInterval");
    expect(component).toContain("window.clearInterval");
    expect(component).toContain("Feed unavailable");
    expect(component).toContain("Not financial advice");
  });

  it("relabels sidebar step 1 as Create & Bond", async () => {
    const nav = await source("components", "app-navigation.tsx");

    expect(nav).toContain('label: "Create & Bond"');
    expect(nav).toContain("Create a token, open its market");
  });
});
