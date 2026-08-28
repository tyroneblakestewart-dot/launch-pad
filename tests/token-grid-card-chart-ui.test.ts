import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This repo's Vitest suite runs in a plain Node environment (no jsdom), so
// interactive client components/hooks are covered by source-pattern
// assertions — matching tests/token-trades-hook-ui.test.ts's precedent —
// rather than a rendered DOM.

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("useGridTokenTrades (issue #436)", () => {
  it("reuses GET /api/token-trades — the same route the token page polls — rather than a second trade-reading path", async () => {
    const hook = await source("lib/use-grid-token-trades.ts");
    expect(hook).toContain('"use client"');
    expect(hook).toContain("`/api/token-trades?curve=${curveRef.current}`");
  });

  it("polls at a much slower ~60s cadence than the token page's 12s fast path", async () => {
    const hook = await source("lib/use-grid-token-trades.ts");
    expect(hook).toContain("POLL_INTERVAL_MS = 60_000");
  });

  it("never fetches or starts a timer while inactive (off screen)", async () => {
    const hook = await source("lib/use-grid-token-trades.ts");
    const firstLoadEffect = hook.indexOf("if (!active) return;\n    void load();");
    const timerEffect = hook.indexOf("if (!active) return;\n    let timer");
    expect(firstLoadEffect).toBeGreaterThan(-1);
    expect(timerEffect).toBeGreaterThan(-1);
  });

  it("degrades quietly on a route failure (including a 429) instead of surfacing an error", async () => {
    const hook = await source("lib/use-grid-token-trades.ts");
    expect(hook).toContain("if (!response.ok) return;");
    expect(hook).toContain("catch {");
  });

  it("follows the issue #403 live-refresh pattern: visible-tab timer, focus/visibilitychange refetch, cleanup", async () => {
    const hook = await source("lib/use-grid-token-trades.ts");
    expect(hook).toContain('document.visibilityState === "visible"');
    expect(hook).toContain("window.setInterval(() => void load(), POLL_INTERVAL_MS)");
    expect(hook).toContain('document.addEventListener("visibilitychange", handleBecameVisible)');
    expect(hook).toContain('window.addEventListener("focus", handleBecameVisible)');
    expect(hook).toContain('document.removeEventListener("visibilitychange", handleBecameVisible)');
    expect(hook).toContain('window.removeEventListener("focus", handleBecameVisible)');
  });
});

describe("useInView (issue #436)", () => {
  it("uses IntersectionObserver with an SSR/unsupported-browser guard, following hoodlums-social-showcase.tsx's pattern", async () => {
    const hook = await source("lib/use-in-view.ts");
    expect(hook).toContain('"use client"');
    expect(hook).toContain('typeof IntersectionObserver === "undefined"');
    expect(hook).toContain("observer.disconnect()");
  });
});

describe("TokenGridCardChart (issue #436)", () => {
  it("reads trades only through useGridTokenTrades, gated on useInView's inView flag", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain('"use client"');
    expect(component).toContain('import { useGridTokenTrades } from "@/lib/use-grid-token-trades"');
    expect(component).toContain('import { useInView } from "@/lib/use-in-view"');
    expect(component).toContain("useGridTokenTrades(curveAddress, inView)");
  });

  it("builds both the mini and expanded chart from the one shared pure buildSparkline result", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain('import { buildSparkline, sparklineColor');
    const buildCalls = component.match(/buildSparkline\(/g) ?? [];
    expect(buildCalls).toHaveLength(1);
    expect(component).toContain("styles.sparklineMini");
    expect(component).toContain("styles.sparklineExpanded");
  });

  it("marks both chart SVGs decorative rather than double-announcing data to screen readers", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    const ariaHiddenCount = component.match(/aria-hidden="true"/g) ?? [];
    expect(ariaHiddenCount.length).toBeGreaterThanOrEqual(2);
  });
});

describe("HoodlumsTokenGrid card chart wiring (issue #436)", () => {
  it("renders TokenGridCardChart per card instead of a static initial-letter block", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).toContain('import { TokenGridCardChart } from "./token-grid-card-chart"');
    expect(component).toContain("<TokenGridCardChart tokenName={launch.tokenName} curveAddress={launch.curveAddress} />");
  });

  it("still maps each tab to the correct token_launches filter (unchanged from issue #412)", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).toContain('new: "all"');
    expect(component).toContain('bonding: "bonding"');
    expect(component).toContain('graduated: "graduated"');
  });

  it("still links each card to its published site when linked, or the trade page otherwise (unchanged from issue #412)", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).toContain("launch.siteSlug");
    expect(component).toContain("/token/robinhood/${launch.tokenAddress}");
  });
});

describe("Grid card chart CSS (issue #436)", () => {
  it("positions the expanded overlay absolutely within the card, never a layout participant", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toMatch(/\.card\s*\{[^}]*position:\s*relative;/);
    expect(css).toMatch(/\.sparklineExpanded\s*\{[^}]*position:\s*absolute;/);
    expect(css).toMatch(/\.sparklineExpanded\s*\{[^}]*inset:\s*0;/);
  });

  it("never lets the expanded overlay intercept the card's click-through navigation, in any state", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toMatch(/\.sparklineExpanded\s*\{[^}]*pointer-events:\s*none;/);
  });

  it("expands on hover only for pointer devices, and on keyboard focus regardless of pointer type", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toContain(".card:focus .sparklineExpanded,\n.card:focus-within .sparklineExpanded {");
    expect(css).toContain("@media (hover: hover) and (pointer: fine) {");
    expect(css).toContain(".card:hover .sparklineExpanded {");
  });

  it("respects prefers-reduced-motion for the hover expansion transition", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toContain("@media (prefers-reduced-motion: reduce) {");
    const reducedMotionIndex = css.indexOf("@media (prefers-reduced-motion: reduce) {");
    const block = css.slice(reducedMotionIndex, reducedMotionIndex + 200);
    expect(block).toContain(".sparklineExpanded");
    expect(block).toContain("transition: none;");
  });

  it("colours up/down consistent with the site's existing candlestick chart green/red", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toContain(".sparklineUp {\n  color: #91f0b6;\n}");
    expect(css).toContain(".sparklineDown {\n  color: #ff5f56;\n}");
  });
});
