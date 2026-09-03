import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This repo's Vitest suite runs in a plain Node environment (no jsdom), so
// the hook and its wiring are covered by source-pattern assertions, matching
// tests/token-trades-hook-ui.test.ts's precedent for the exact live-refresh
// pattern this hook reuses.

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("useTokenHolderStats (token page v2 part 3)", () => {
  it("polls GET /api/token-holder-stats for the token address on a 60s timer matching the server cache", async () => {
    const hook = await source("lib/use-token-holder-stats.ts");
    expect(hook).toContain('"use client"');
    expect(hook).toContain("`/api/token-holder-stats?token=${token}`");
    expect(hook).toContain('{ cache: "no-store" }');
    expect(hook).toContain("POLL_INTERVAL_MS = 60_000");
  });

  it("follows the issue #403 live-refresh pattern exactly: visible-tab timer, focus/visibilitychange refetch, cleanup", async () => {
    const hook = await source("lib/use-token-holder-stats.ts");
    expect(hook).toContain('document.visibilityState === "visible"');
    expect(hook).toContain("window.setInterval(() => void load(), POLL_INTERVAL_MS)");
    expect(hook).toContain('document.addEventListener("visibilitychange", handleBecameVisible)');
    expect(hook).toContain('window.addEventListener("focus", handleBecameVisible)');
    expect(hook).toContain("stopTimer();");
    expect(hook).toContain('document.removeEventListener("visibilitychange", handleBecameVisible)');
    expect(hook).toContain('window.removeEventListener("focus", handleBecameVisible)');
  });

  it("refetches on the wallet's own just-confirmed trade, since a buy moves Dev/Top 10/Snipers immediately", async () => {
    const hook = await source("lib/use-token-holder-stats.ts");
    expect(hook).toContain('import { TOKEN_TRADE_CONFIRMED_EVENT } from "@/lib/token-trade-events"');
    expect(hook).toContain("window.addEventListener(TOKEN_TRADE_CONFIRMED_EVENT, handleTradeConfirmed)");
    expect(hook).toContain("window.removeEventListener(TOKEN_TRADE_CONFIRMED_EVENT, handleTradeConfirmed)");
  });

  it("does nothing for a chain with no holder-data source and never resets to loading on a background poll", async () => {
    const hook = await source("lib/use-token-holder-stats.ts");
    expect(hook).toContain('const enabled = chain === "robinhood";');
    expect(hook).toContain("if (!enabled) return;");
    // A failed background poll keeps the last good breakdown; only the error flag moves.
    expect(hook).not.toContain("setBreakdown(null);\n      setError(");
  });
});

describe("holder breakdown wiring (fetch once at the page, pass props)", () => {
  it("calls the hook exactly once, in token-page-view.tsx, and passes the result down as a prop", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).toContain('import { useTokenHolderStats } from "@/lib/use-token-holder-stats"');
    expect(view).toContain("const { breakdown: holderBreakdown } = useTokenHolderStats(chain, address);");
    expect(view).toContain("holderBreakdown={holderBreakdown}");

    const left = await source("components/token-page/token-left-column.tsx");
    const panel = await source("components/token-page/token-stats-audit-panel.tsx");
    const header = await source("components/token-page/token-header-band.tsx");
    const center = await source("components/token-page/token-center-column.tsx");
    const total = [view, left, panel, header, center].reduce((sum, file) => sum + countOccurrences(file, "useTokenHolderStats("), 0);
    expect(total).toBe(1);
    expect(panel).not.toContain("fetch(");
  });

  it("forwards the breakdown through the left column to the Stats/Audit panel untouched", async () => {
    const left = await source("components/token-page/token-left-column.tsx");
    expect(left).toContain("holderBreakdown: TokenHolderBreakdown | null;");
    expect(left).toContain('import type { TokenHolderBreakdown } from "@/lib/token-holder-stats-types"');
    expect(left).toContain("holderBreakdown={holderBreakdown}");
  });

  it("renders Top 10 % / Dev % / Snipers % at one decimal place, with null as an em dash rather than 0.0%", async () => {
    const panel = await source("components/token-page/token-stats-audit-panel.tsx");
    expect(panel).toContain("holderBreakdown: TokenHolderBreakdown | null;");
    expect(panel).toContain("{formatSharePercent(holderBreakdown?.top10Percent ?? null)}");
    expect(panel).toContain("{formatSharePercent(holderBreakdown?.devPercent ?? null)}");
    expect(panel).toContain("{formatSharePercent(holderBreakdown?.snipersPercent ?? null)}");
    // The three rows no longer carry a hard-coded dash of their own.
    const breakdownRows = panel.slice(panel.indexOf("TOP 10 %"), panel.indexOf("TOTAL FEES"));
    expect(breakdownRows).not.toContain(">—<");
    // The labels and tooltip pinned since part 1 are unchanged.
    expect(panel).toContain("TOP 10 %");
    expect(panel).toContain("DEV %");
    expect(panel).toContain("SNIPERS % ⓘ");
    expect(panel).toContain("Wallets that bought within the first 10 blocks after launch");
  });

  it("keeps the header's holder count as the single holder-count source — the breakdown response carries no holder count", async () => {
    const types = await source("lib/token-holder-stats-types.ts");
    expect(types).not.toContain("holderCount");
  });
});
