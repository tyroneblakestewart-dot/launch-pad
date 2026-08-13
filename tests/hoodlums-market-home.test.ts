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
    expect(component).toContain("HoodlumsGraduatingRow");
  });

  it("places the graduating row below the HOODLUMS TOKENS / trending layout, full-width (issue #295)", async () => {
    const component = await source("components", "hoodlums-market-home.tsx");

    const layoutOpen = component.indexOf('<div className={styles.layout}>');
    const layoutClose = component.indexOf("</div>", component.indexOf("RobinhoodTrendingPanel"));
    const gridIndex = component.indexOf("<HoodlumsTokenGrid", layoutOpen);
    const graduatingRowIndex = component.indexOf("<HoodlumsGraduatingRow");

    expect(layoutOpen).toBeGreaterThan(-1);
    expect(gridIndex).toBeGreaterThan(layoutOpen);
    expect(graduatingRowIndex).toBeGreaterThan(layoutClose);
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
  });

  it("drops the dashed 'Be next' placeholder card and adds a compact Create-token button to the section header instead (issue #295)", async () => {
    const component = await source("components", "hoodlums-token-grid.tsx");
    const styles = await source("components", "hoodlums-token-grid.module.css");

    expect(component).not.toContain("Be next");
    expect(component).not.toContain("beNextCard");
    expect(styles).not.toContain(".beNextCard");

    expect(component).toContain("styles.headerActions");
    expect(component).toContain("styles.createTokenButton");
    expect(component).toContain('requestWorkspaceOpen("new")');
    // The button sits alongside the New/Bonding/Graduated filter tabs in the section header.
    const headerActionsIndex = component.indexOf("styles.headerActions");
    const tabsIndex = component.indexOf("styles.tabs", headerActionsIndex);
    const createButtonIndex = component.indexOf("createTokenButton", tabsIndex);
    expect(tabsIndex).toBeGreaterThan(headerActionsIndex);
    expect(createButtonIndex).toBeGreaterThan(tabsIndex);
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

  it("no longer renders a 'Graduating now' tab inside the trending sidebar (issue #295)", async () => {
    const component = await source("components", "robinhood-trending-panel.tsx");

    expect(component).not.toContain("feed=graduating");
    expect(component).not.toContain("graduating");
    expect(component).not.toContain("Graduating now");
    expect(component).not.toContain("GraduatingToken");
    expect(component).toContain('type TrendingTab = "solana" | "robinhood";');
  });

  it("renders the graduating-now feed as a full-width row of pump.fun cards below the token grid, hiding until eligible (issue #295)", async () => {
    const component = await source("components", "hoodlums-graduating-row.tsx");
    const styles = await source("components", "hoodlums-graduating-row.module.css");

    expect(component).toContain('"use client"');
    expect(component).toContain("feed=graduating");
    expect(component).toContain("MIN_GRADUATING_TOKENS = 2");
    expect(component).toContain("window.setInterval");
    expect(component).toContain("window.clearInterval");
    expect(component).toContain("GRADUATING NOW · LIVE FROM PUMP.FUN");
    expect(component).toContain("live from pump.fun — Hoodlums graduations join this race at mainnet");
    // Hides itself entirely (not just visually) below the eligibility bar or on error.
    expect(component).toContain("if (!eligible) return null;");
    expect(styles).toContain(".gradBar");
    expect(styles).toContain("#bce759");
  });

  it("caps the graduating row at 6 tokens, 4 per page (max 2 pages), and reuses the social-showcase swipe/index helpers (issue #295)", async () => {
    const component = await source("components", "hoodlums-graduating-row.tsx");

    expect(component).toContain("TOKENS_PER_PAGE = 4");
    expect(component).toContain('import { clampShowcaseIndex, swipeDeltaToStep } from "@/lib/social-showcase";');
    expect(component).toContain("swipeDeltaToStep(");
    expect(component).toContain("clampShowcaseIndex(");
    // Mouse-drag and touch-swipe both drive the same page-stepping logic.
    expect(component).toContain("onTouchStart={handleTouchStart}");
    expect(component).toContain("onTouchEnd={handleTouchEnd}");
    expect(component).toContain("onMouseDown={handleMouseDown}");
    expect(component).toContain("onMouseUp={handleMouseUp}");
    expect(component).toContain('role="tablist"');
    expect(component).toContain("aria-label=\"Graduating now pages\"");
  });

  it("shows the graduating card artwork with a lime first-letter fallback tile when artwork is missing or errors (issue #295)", async () => {
    const component = await source("components", "hoodlums-graduating-row.tsx");
    const styles = await source("components", "hoodlums-graduating-row.module.css");

    expect(component).toContain("function initial(name: string): string");
    expect(component).toContain("onError={() => setArtworkFailed(true)}");
    expect(component).toContain("showArt ? (");
    expect(component).toContain("{initial(token.name)}");
    expect(styles).toContain(".art {");
    expect(styles).toContain("color: #bce759;");
  });

  it("shows the mainnet caption and adapts the card grid down to 1 column at a 390px mobile width (issue #295)", async () => {
    const styles = await source("components", "hoodlums-graduating-row.module.css");

    expect(styles).toContain("@media (max-width: 1099px)");
    expect(styles).toContain("@media (max-width: 390px)");
  });

  it("relabels sidebar step 1 as Create & Bond", async () => {
    const nav = await source("components", "app-navigation.tsx");

    expect(nav).toContain('label: "Create & Bond"');
    expect(nav).toContain("Create a token, open its market");
  });
});
