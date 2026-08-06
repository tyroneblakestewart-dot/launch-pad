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
    const accountShell = await source("components", "account-overlay-shell.tsx");

    expect(component).toContain("5-MIN ROBINHOOD MARKET PULSE");
    expect(component).not.toContain("+ Create");
    expect(component).toContain("Open saved launches");
    expect(component).toContain("requestWorkspaceOpen(\"saved\")");
    expect(component).not.toContain('href="/account"');
    expect(accountShell).toContain("AccountOverlay");
    expect(accountShell).toContain("styles.accountDock");
    expect(component).toContain("BUILD. TEST. LAUNCH.");
    expect(component).toContain("Launch a meme token");
    expect(component).toContain("without the clutter.");
    expect(component).toContain("Create new token");
    expect(component).toContain("requestWorkspaceOpen(\"new\")");
    expect(component).toContain("0% token tax");
    expect(component).toContain("No mint function");
    expect(component).toContain("No owner");
    expect(component).toContain("LP locked at graduation");
    expect(component).toContain("All facts on-chain");
    expect(component).toContain("HoodlumsTokenGrid");
    expect(component).toContain("RobinhoodTrendingPanel");
  });

  it("orders token status tabs by lifecycle and defaults to New", async () => {
    const component = await source("components", "hoodlums-token-grid.tsx");
    const newIndex = component.indexOf('{ key: "new", label: "New" }');
    const bondingIndex = component.indexOf('{ key: "bonding", label: "Bonding" }');
    const graduatedIndex = component.indexOf('{ key: "graduated", label: "Graduated" }');

    expect(component).toContain('useState<Tab>("new")');
    expect(newIndex).toBeGreaterThan(-1);
    expect(bondingIndex).toBeGreaterThan(newIndex);
    expect(graduatedIndex).toBeGreaterThan(bondingIndex);
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

  it("shows a live Solana tab (default) and a Robinhood Chain coming-soon tab", async () => {
    const component = await source("components", "robinhood-trending-panel.tsx");

    expect(component).toContain('useState<TrendingTab>("solana")');
    expect(component).toContain("feed=solana");
    expect(component).toContain("TRENDING · SOLANA");
    expect(component).toContain("Coming soon");
    expect(component).toContain("Robinhood Chain trending is coming soon.");
    expect(component).toContain("via Dexscreener");
  });

  it("relabels sidebar step 1 as Create & Bond", async () => {
    const nav = await source("components", "app-navigation.tsx");

    expect(nav).toContain('label: "Create & Bond"');
    expect(nav).toContain("Create a token, open its market");
  });
});
