import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This repo's Vitest suite runs in a plain Node environment (no jsdom), so
// interactive client components/hooks are covered by source-pattern
// assertions — matching tests/token-launches-grid-ui.test.ts's precedent
// for the exact same live-refresh/own-action-refetch shape this issue
// reuses — rather than a rendered DOM.

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("components/token-page/token-chart.tsx (issue #430)", () => {
  it("always mounts the chart with createChart/addCandlestickSeries on mount, independent of trade count", async () => {
    const component = await source("components/token-page/token-chart.tsx");
    expect(component).toContain('"use client"');
    expect(component).toContain('import { createChart');
    expect(component).toContain("from \"lightweight-charts\"");
    expect(component).toContain("chart.addCandlestickSeries(");
    // The chart-mounting effect has no dependency on `trades`/`candles`, so
    // it never skips creating the chart just because there's nothing to plot.
    const effectStart = component.indexOf("useEffect(() => {\n    const container = containerRef.current;");
    const effectDepsIndex = component.indexOf("}, []);", effectStart);
    expect(effectStart).toBeGreaterThan(-1);
    expect(effectDepsIndex).toBeGreaterThan(effectStart);
  });

  it("renders an empty-state overlay layered on top of the (still-mounted) chart, never a placeholder box in its place", async () => {
    const component = await source("components/token-page/token-chart.tsx");
    expect(component).toContain('data-token-chart-canvas="true"');
    expect(component).toContain("const isEmpty = candles.length === 0;");
    expect(component).toContain('data-token-chart-empty="true"');
    // The canvas div and the conditional overlay are siblings inside the
    // same wrapper — the overlay never replaces the canvas.
    const wrapStart = component.indexOf("styles.chartCanvasWrap");
    const canvasIndex = component.indexOf('data-token-chart-canvas="true"', wrapStart);
    const overlayIndex = component.indexOf('data-token-chart-empty="true"', wrapStart);
    expect(canvasIndex).toBeGreaterThan(wrapStart);
    expect(overlayIndex).toBeGreaterThan(canvasIndex);
  });

  it("buckets candles from lib/candle-bucketing.ts, not ad-hoc math, and offers 1m/5m/15m/1h interval selection", async () => {
    const component = await source("components/token-page/token-chart.tsx");
    expect(component).toContain('import { bucketTradesIntoCandles, type CandleInterval } from "@/lib/candle-bucketing"');
    expect(component).toContain("bucketTradesIntoCandles(trades ?? [], activeInterval)");
    expect(component).toContain('{ id: "1m", label: "1m" }');
    expect(component).toContain('{ id: "5m", label: "5m" }');
    expect(component).toContain('{ id: "15m", label: "15m" }');
    expect(component).toContain('{ id: "1h", label: "1h" }');
  });

  it("cleans up the chart instance and resize listener on unmount", async () => {
    const component = await source("components/token-page/token-chart.tsx");
    expect(component).toContain("chart.remove();");
    expect(component).toContain('window.removeEventListener("resize", handleResize)');
  });
});

describe("lib/use-token-trades.ts (issue #430)", () => {
  it("polls GET /api/token-trades with the curve/chainId query params every ~12s", async () => {
    const hook = await source("lib/use-token-trades.ts");
    expect(hook).toContain('"use client"');
    expect(hook).toContain("POLL_INTERVAL_MS = 12_000");
    expect(hook).toContain("/api/token-trades?curve=${encodeURIComponent(curve)}&chainId=${chainIdRef.current}");
  });

  it("follows the token-launches grid's issue #412/#403 live-refresh pattern exactly: visible-tab timer, focus/visibilitychange refetch, cleanup", async () => {
    const hook = await source("lib/use-token-trades.ts");
    expect(hook).toContain('document.visibilityState === "visible"');
    expect(hook).toContain("window.setInterval(() => void load(), POLL_INTERVAL_MS)");
    expect(hook).toContain('document.addEventListener("visibilitychange", handleBecameVisible)');
    expect(hook).toContain('window.addEventListener("focus", handleBecameVisible)');
    expect(hook).toContain("stopTimer();");
    expect(hook).toContain('document.removeEventListener("visibilitychange", handleBecameVisible)');
    expect(hook).toContain('window.removeEventListener("focus", handleBecameVisible)');
  });

  it("refetches immediately on the wallet's own just-confirmed trade instead of waiting for the next poll tick", async () => {
    const hook = await source("lib/use-token-trades.ts");
    expect(hook).toContain('import { TOKEN_TRADE_CONFIRMED_EVENT } from "@/lib/token-trade-events"');
    expect(hook).toContain("window.addEventListener(TOKEN_TRADE_CONFIRMED_EVENT, handleTradeConfirmed)");
  });

  it("never resets trades to null on a background refresh — only overwrites it in place, keeping error state independent", async () => {
    const hook = await source("lib/use-token-trades.ts");
    expect(hook).not.toContain("setTrades(null)");
    expect(hook).toContain("setError(null)");
  });
});

describe("lib/token-trade-events.ts (issue #430)", () => {
  it("dispatches a window CustomEvent, mirroring lib/token-launch-events.ts's pattern", async () => {
    const events = await source("lib/token-trade-events.ts");
    expect(events).toContain('export const TOKEN_TRADE_CONFIRMED_EVENT = "launchpad:token-trade-confirmed";');
    expect(events).toContain("new CustomEvent<TokenTradeConfirmedDetail>(TOKEN_TRADE_CONFIRMED_EVENT");
  });
});
