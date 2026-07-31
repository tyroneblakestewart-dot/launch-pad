import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]) {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("studio home bonding market redesign", () => {
  it("adds the topbar, hero copy, CTAs and fact pills the issue specifies", async () => {
    const home = await source("components", "hoodlums-market-home.tsx");

    expect(home).toContain("5-MIN ROBINHOOD MARKET PULSE");
    expect(home).toContain("+ Create");
    expect(home).toContain('href="/account"');
    expect(home).toContain("HOODLUMS BONDING MARKET");
    expect(home).toContain("locked liquidity.");
    expect(home).toContain("Create new token");
    expect(home).toContain("Open saved launches");
    expect(home).toContain("0% token tax");
    expect(home).toContain("No mint function");
    expect(home).toContain("No owner");
    expect(home).toContain("LP locked at graduation");
    expect(home).toContain("All facts on-chain");
  });

  it("uses the shared HOODLUMS wordmark image, not a text or SVG approximation", async () => {
    const navigation = await source("components", "app-navigation.tsx");
    expect(navigation).toContain("HOODLUMS_WORDMARK_IMAGE");
    expect(navigation).toContain('from "@/lib/hoodlums-wordmark-image"');
  });

  it("relabels sidebar step 1 as Create & Bond", async () => {
    const navigation = await source("components", "app-navigation.tsx");
    expect(navigation).toContain('label: "Create & Bond"');
    expect(navigation).toContain('description: "Create a token, open its market"');
    expect(navigation).not.toContain('label: "Studio"');
  });

  it("wires the market home into the studio page above the untouched launch-studio flow", async () => {
    const page = await source("app", "(app)", "page.tsx");
    expect(page).toContain("HoodlumsMarketHome");
    expect(page).toContain("listLiveGeneratedSites");
    expect(page).toContain('id="launch-studio"');
    expect(page).toContain("<TokenStudioWorkspace />");
  });

  it("shows a truthful token-grid empty state and a Be next prompt", async () => {
    const grid = await source("components", "hoodlums-token-grid.tsx");
    expect(grid).toContain("No Hoodlums tokens on the curve yet.");
    expect(grid).toContain("Be the first — create a token and open its bonding market.");
    expect(grid).toContain("Be next");
    expect(grid).toContain("Graduation");
  });

  it("polls the trending endpoint every 60 seconds and cleans up the interval", async () => {
    const panel = await source("components", "robinhood-trending-panel.tsx");
    expect(panel).toContain("POLL_INTERVAL_MS = 60_000");
    expect(panel).toContain("window.setInterval(load, POLL_INTERVAL_MS)");
    expect(panel).toContain("window.clearInterval(timer)");
    expect(panel).toContain("Feed unavailable");
    expect(panel).toContain('target="_blank"');
    expect(panel).toContain('rel="noopener noreferrer"');
  });
});
