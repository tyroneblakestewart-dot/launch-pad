import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This repo's Vitest suite runs in a plain Node environment (no jsdom), so
// interactive client components/hooks are covered by source-pattern
// assertions — matching tests/support-hub-ui.test.ts's precedent for the
// exact live-refresh pattern this hook reuses — rather than a rendered DOM.

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("useTokenLaunches (issue #412 Part 1)", () => {
  it("polls the homepage-grid read route with the filter/limit query params", async () => {
    const hook = await source("lib/use-token-launches.ts");
    expect(hook).toContain('"use client"');
    expect(hook).toContain("`/api/token-launches?filter=${filterRef.current}&limit=${limitRef.current}`");
    expect(hook).toContain("POLL_INTERVAL_MS = 30_000");
  });

  it("follows the /support issue #403 live-refresh pattern exactly: visible-tab timer, focus/visibilitychange refetch, cleanup", async () => {
    const hook = await source("lib/use-token-launches.ts");
    expect(hook).toContain("document.visibilityState === \"visible\"");
    expect(hook).toContain("window.setInterval(() => void load(), POLL_INTERVAL_MS)");
    expect(hook).toContain('document.addEventListener("visibilitychange", handleBecameVisible)');
    expect(hook).toContain('window.addEventListener("focus", handleBecameVisible)');
    expect(hook).toContain("stopTimer();");
    expect(hook).toContain('document.removeEventListener("visibilitychange", handleBecameVisible)');
    expect(hook).toContain('window.removeEventListener("focus", handleBecameVisible)');
  });

  it("refetches immediately on the wallet's own just-completed launch instead of waiting for the next poll tick", async () => {
    const hook = await source("lib/use-token-launches.ts");
    expect(hook).toContain('import { TOKEN_LAUNCH_COMPLETED_EVENT } from "@/lib/token-launch-events"');
    expect(hook).toContain("window.addEventListener(TOKEN_LAUNCH_COMPLETED_EVENT, handleLaunchCompleted)");
  });

  it("never resets to a loading state on a background refresh — only ever overwrites the launches array in place", async () => {
    const hook = await source("lib/use-token-launches.ts");
    expect(hook).not.toContain("setLaunches(null)");
  });
});

describe("lib/token-launch-events.ts", () => {
  it("dispatches a window CustomEvent, mirroring lib/workspace-open-request.ts's pattern", async () => {
    const events = await source("lib/token-launch-events.ts");
    expect(events).toContain('export const TOKEN_LAUNCH_COMPLETED_EVENT = "launchpad:token-launch-completed";');
    expect(events).toContain("new CustomEvent<TokenLaunchCompletedDetail>(TOKEN_LAUNCH_COMPLETED_EVENT");
  });
});

describe("HoodlumsTokenGrid on token_launches (issue #412 Part 1)", () => {
  it("reads from useTokenLaunches instead of rendering liveSites as fake grid cards", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).toContain('import { useTokenLaunches } from "@/lib/use-token-launches"');
    expect(component).toContain("useTokenLaunches(TAB_TO_FILTER[tab])");
  });

  it("maps each tab to the correct token_launches filter", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).toContain('new: "all"');
    expect(component).toContain('bonding: "bonding"');
    expect(component).toContain('graduated: "graduated"');
  });

  it("links each card to its published site when linked, or the trade page otherwise", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).toContain("launch.siteSlug");
    expect(component).toContain("/token/robinhood/${launch.tokenAddress}");
  });

  it("renders live progress from progressBps rather than a hardcoded 0%", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).not.toContain('<b>0%</b>');
    expect(component).toContain("formatGraduationProgressPercent");
  });
});
