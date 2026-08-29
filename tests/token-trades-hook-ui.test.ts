import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This repo's Vitest suite runs in a plain Node environment (no jsdom), so
// interactive client components/hooks are covered by source-pattern
// assertions — matching tests/token-launches-grid-ui.test.ts's precedent for
// the exact live-refresh pattern this hook reuses — rather than a rendered
// DOM or real fake-timer-driven execution.

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("useTokenTrades (issue #430)", () => {
  it("polls GET /api/token-trades with the resolved curve address", async () => {
    const hook = await source("lib/use-token-trades.ts");
    expect(hook).toContain('"use client"');
    expect(hook).toContain("`/api/token-trades?curve=${curve}`");
    expect(hook).toContain("POLL_INTERVAL_MS = 12_000");
  });

  it("follows the issue #403 live-refresh pattern exactly: visible-tab timer, focus/visibilitychange refetch, cleanup", async () => {
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

  it("never resets to a loading state on a background refresh — only ever overwrites the trades array in place", async () => {
    const hook = await source("lib/use-token-trades.ts");
    expect(hook).not.toContain("setTrades(null)");
  });

  it("resolves to an empty list with no fetch when no curve is configured for this token", async () => {
    const hook = await source("lib/use-token-trades.ts");
    expect(hook).toContain("if (!curve) {");
    expect(hook).toContain("setTrades([]);");
  });
});

describe("lib/token-trade-events.ts", () => {
  it("dispatches a window CustomEvent, mirroring lib/token-launch-events.ts's pattern", async () => {
    const events = await source("lib/token-trade-events.ts");
    expect(events).toContain('export const TOKEN_TRADE_CONFIRMED_EVENT = "launchpad:token-trade-confirmed";');
    expect(events).toContain("new CustomEvent<TokenTradeConfirmedDetail>(TOKEN_TRADE_CONFIRMED_EVENT");
  });
});

describe("TokenTradeChart (issue #430)", () => {
  it("always mounts the chart unconditionally, independent of trade count — never a placeholder box", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain('"use client"');
    // The createChart()/addCandlestickSeries() effect must not be gated on
    // trades.length, or a zero-trade token would get no axes at all.
    const effectStart = component.indexOf("useEffect(() => {\n    const container");
    const effectEnd = component.indexOf("}, []);", effectStart);
    expect(effectStart).toBeGreaterThan(-1);
    const effectBody = component.slice(effectStart, effectEnd);
    expect(effectBody).toContain("createChart(container");
    expect(effectBody).toContain("chart.addCandlestickSeries(");
    expect(effectBody).not.toContain("trades.length");
  });

  it("cleans up the chart instance on unmount", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("chart.remove();");
    expect(component).toContain("chartRef.current = null;");
  });

  it("only overlays empty/error copy on top of the always-mounted canvas, gated on a genuine zero-trade or error response", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("data-token-chart-canvas=\"true\"");
    expect(component).toContain("showEmptyOverlay");
    expect(component).toContain("trades !== null && trades.length === 0");
    expect(component).toContain('data-token-chart-empty="true"');
    expect(component).toContain('data-token-chart-error="true"');
  });

  it("offers a 1m/5m/15m/1h interval selector defaulting to 5m", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain('useState<CandleInterval>("5m")');
    expect(component).toContain("CANDLE_INTERVALS.map");
  });

  it("re-buckets candles from the shared trades list via the pure bucketing function, not ad-hoc math", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("bucketTradesIntoCandles(trades, interval, decimals ?? DEFAULT_TOKEN_DECIMALS)");
    expect(component).toContain("series.setData(");
  });
});

describe("TokenCenterColumn live trade wiring (issue #430)", () => {
  it("uses the real trades response's direction/wallet/amount/tx fields instead of the removed Blockscout heuristic", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain("trade.direction === \"buy\"");
    expect(component).toContain("shortenAddress(trade.wallet)");
    expect(component).toContain("formatTokenAmount(trade.tokenAmountRaw, decimals)");
    expect(component).toContain("formatTimeAgoSeconds(trade.blockTimestamp)");
  });

  it("links each trade row out to the chain explorer's tx page", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain('explorerBaseUrl.replace("/address/", "/tx/")');
    expect(component).toContain("`${explorerTxBaseUrl}${trade.txHash}`");
  });
});

describe("TokenLeftColumn live curve polling and own-trade signal (issue #430, lifted to the shared page-level poll in issue #444)", () => {
  it("no longer runs its own curve poll — that timer now lives in the page-level shared lib/use-token-curve-status.ts", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).not.toContain('window.setInterval(() => void loadCurve');
    expect(component).not.toContain("const loadCurve = useCallback");

    const hook = await source("lib/use-token-curve-status.ts");
    expect(hook).toContain("window.setInterval(() => void load(resolvedCurveAddress), 12_000)");
    expect(hook).toContain('document.addEventListener("visibilitychange", handleBecameVisible)');
    expect(hook).toContain('window.addEventListener("focus", handleBecameVisible)');
  });

  it("notifies TOKEN_TRADE_CONFIRMED_EVENT only on a genuine (non-reverted) trade confirmation, inside the success branch", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('import { notifyTokenTradeConfirmed } from "@/lib/token-trade-events"');
    const successBranchStart = component.indexOf('setStatusMessage("Trade confirmed.")');
    const notifyIndex = component.indexOf("notifyTokenTradeConfirmed({ curveAddress: curveView.curve })");
    const resetIndex = component.indexOf('setAmount("");\n        setReceiveRaw(null);\n        setSellFeeRaw(null);');
    expect(successBranchStart).toBeGreaterThan(-1);
    expect(notifyIndex).toBeGreaterThan(successBranchStart);
    expect(notifyIndex).toBeLessThan(resetIndex);
  });
});
