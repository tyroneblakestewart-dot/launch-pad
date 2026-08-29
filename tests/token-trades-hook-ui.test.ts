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

  it("merges every poll through the pure keyed-merge helper instead of replacing the array wholesale (issue #445)", async () => {
    const hook = await source("lib/use-token-trades.ts");
    expect(hook).toContain('import { mergeTokenTrades } from "@/lib/token-trades-merge"');
    expect(hook).toContain("mergeTokenTrades(previousTrades, body.trades)");
  });

  it("skips setTrades entirely when the merge finds nothing new, keeping the reference stable across identical polls", async () => {
    const hook = await source("lib/use-token-trades.ts");
    expect(hook).toContain("if (merged !== previousTrades) {");
    const guardStart = hook.indexOf("if (merged !== previousTrades) {");
    const guardEnd = hook.indexOf("}", guardStart);
    const guardBody = hook.slice(guardStart, guardEnd);
    expect(guardBody).toContain("setTrades(merged);");
  });

  it("exposes a stale flag for a poll failure after data already loaded, distinct from a genuine never-loaded error, plus a retry function", async () => {
    const hook = await source("lib/use-token-trades.ts");
    expect(hook).toContain("const [stale, setStale] = useState(false);");
    expect(hook).toContain("if (tradesRef.current === null) {");
    expect(hook).toContain('setError("Could not load trade history. Try again shortly.");');
    expect(hook).toContain("setStale(true);");
    expect(hook).toContain("setStale(false);");
    expect(hook).toContain("return { trades, error, stale, retry: load };");
  });
});

describe("lib/token-trade-events.ts", () => {
  it("dispatches a window CustomEvent, mirroring lib/token-launch-events.ts's pattern", async () => {
    const events = await source("lib/token-trade-events.ts");
    expect(events).toContain('export const TOKEN_TRADE_CONFIRMED_EVENT = "launchpad:token-trade-confirmed";');
    expect(events).toContain("new CustomEvent<TokenTradeConfirmedDetail>(TOKEN_TRADE_CONFIRMED_EVENT");
  });
});

describe("TokenTradeChart (issue #430, rebuilt in issue #445)", () => {
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

  it("cleans up the chart instance and the ResizeObserver on unmount", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("resizeObserver.disconnect();");
    expect(component).toContain("chart.remove();");
    expect(component).toContain("chartRef.current = null;");
  });

  it("only overlays empty/error copy on top of the always-mounted canvas, gated on a genuine zero-trade or error response", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain('data-token-chart-canvas="true"');
    expect(component).toContain("showEmptyOverlay");
    expect(component).toContain("trades !== null && trades.length === 0");
    expect(component).toContain('data-token-chart-empty="true"');
    expect(component).toContain("No trades yet — the first buy starts the chart");
    expect(component).toContain('data-token-chart-error="true"');
    expect(component).toContain("hasLoadError");
  });

  it("offers the design's 5M/15M/1H/6H/1D/ALL timeframe rail, defaulting to 1H", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain('useState<ChartTimeframe>("1h")');
    expect(component).toContain("CHART_TIMEFRAMES.map");
    expect(component).toContain('all: "ALL"');
  });

  it("never calls fitContent to force a visible window — bar width is fixed via barSpacing instead (issue #449 item 2: the 3x-wide-candle defect)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).not.toContain("fitContent(");
    expect(component).not.toContain("resolveInitialVisibleRange");
  });

  it("only calls setVisibleLogicalRange once, to restore the user's prior view immediately after the crash-safe full-resync fallback — never on the normal setData or incremental-update paths (issue #451 follow-up)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    const occurrences = component.match(/setVisibleLogicalRange\(/g) ?? [];
    expect(occurrences.length).toBe(1);

    const resyncStart = component.indexOf("if (needsFullResync) {");
    expect(resyncStart).toBeGreaterThan(-1);
    const readIndex = component.indexOf(
      "const visibleLogicalRange = chartRef.current?.timeScale().getVisibleLogicalRange() ?? null;",
    );
    const restoreIndex = component.indexOf("chartRef.current?.timeScale().setVisibleLogicalRange(visibleLogicalRange);");
    expect(readIndex).toBeGreaterThan(resyncStart);
    expect(restoreIndex).toBeGreaterThan(readIndex);
  });

  it("routes a trade landing in a bucket older than the whitespace timeline's current tail to a full resync instead of an out-of-order series.update() (issue #451 follow-up crash fix)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain(
      "renderedPointsRef.current.length > 0 ? renderedPointsRef.current[renderedPointsRef.current.length - 1].time : null",
    );
    expect(component).toContain(
      "lastRenderedTime !== null && pointsDiff.updated.some((point) => point.time < lastRenderedTime)",
    );
    expect(component).toContain("let needsFullResync = hasOutOfOrderUpdate;");
  });

  it("also catches an update() throw the pre-check doesn't anticipate and falls back the same way, instead of letting it break the effect", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    const elseStart = component.indexOf("if (!needsFullResync) {");
    expect(elseStart).toBeGreaterThan(-1);
    const tryStart = component.indexOf("try {", elseStart);
    const catchIndex = component.indexOf("} catch {", tryStart);
    const resyncFlagSet = component.indexOf("needsFullResync = true;", catchIndex);
    expect(tryStart).toBeGreaterThan(elseStart);
    expect(catchIndex).toBeGreaterThan(tryStart);
    expect(resyncFlagSet).toBeGreaterThan(catchIndex);
  });

  it("only calls series.setData on first load or a timeframe change; every other update diffs and calls series.update over the whitespace-inclusive timeline (issue #451 item 2)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("resolveChartInterval(timeframe, trades, decimals ?? DEFAULT_TOKEN_DECIMALS)");
    expect(component).toContain("bucketTradesIntoCandles(trades, resolvedInterval, decimals ?? DEFAULT_TOKEN_DECIMALS)");
    expect(component).toContain("buildChartSeriesPoints(candles, resolvedInterval, nowTick)");
    expect(component).toContain("!hasRenderedOnceRef.current || renderedTimeframeRef.current !== timeframe");
    expect(component).toContain("candleSeries.setData(points.map(pointToSeriesDatum));");
    expect(component).toContain("diffChartSeriesPoints(renderedPointsRef.current, points)");
    expect(component).toContain("candleSeries.update(pointToSeriesDatum(point));");
    // Volume stays keyed off real candles only, unaffected by whitespace.
    expect(component).toContain("diffCandles(renderedCandlesRef.current, candles)");
  });

  it("advances the whitespace-inclusive timeline with the clock via a coarse timer, independent of new trades arriving", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("useState(() => Math.floor(Date.now() / 1000))");
    expect(component).toContain("window.setInterval(() => setNowTick(Math.floor(Date.now() / 1000)), 30_000)");
  });

  it("scrolls to real time after setData instead of forcing a visible logical range (issue #449 item 2)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("chartRef.current?.timeScale().scrollToRealTime();");
  });

  it("fixes bar spacing/right offset to a constant pixel width, independent of chart width or candle count (issue #449 item 2)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("rightOffset: 4");
    expect(component).toContain("barSpacing: 6");
    expect(component).toContain("minBarSpacing: 3");
  });

  it("sizes the chart via a manually-guarded ResizeObserver, never passing autoSize as a chart option (the traced cause of the ~1s candle jump)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).not.toContain("createChart(container, {\n      autoSize: true");
    expect(component).toContain("new ResizeObserver(");
    expect(component).toContain("Math.abs(lastApplied.width - width) < 1 && Math.abs(lastApplied.height - height) < 1");
    expect(component).toContain("chart.resize(width, height);");
  });

  it("configures a custom six-significant-figure priceFormat shared with the header's own formatter, so the axis never reads 0.00", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain('import { formatNativePriceSixSigFigs, formatSignedPercent } from "@/lib/token-page-format"');
    expect(component).toContain('type: "custom"');
    expect(component).toContain("formatter: (price: number) => formatNativePriceSixSigFigs(price)");
  });

  it("re-derives minMove from the data's own magnitude and re-applies it only when it changes, instead of a fixed value below real testnet prices (issue #451 item 1)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("computeChartMinMove,");
    expect(component).toContain('from "@/lib/token-chart-tools"');
    expect(component).toContain(
      "candles.length > 0 ? Math.max(...candles.map((candle) => candle.high)) : startingPriceNativePerToken",
    );
    expect(component).toContain("computeChartMinMove(maxPrice)");
    expect(component).toContain("if (minMove !== appliedMinMoveRef.current) {");
    expect(component).toContain("candleSeries.applyOptions({");
  });

  it("draws a dashed lime last-price line via the series' built-in price line, so the crosshair/axis tag share one formatter automatically", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("priceLineVisible: true");
    expect(component).toContain("priceLineStyle: LineStyle.Dashed");
    expect(component).toContain("priceLineColor: UP_COLOR");
  });

  it("never computes its own separate last price — it derives from the same shared trades/starting-price source as the header", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("tradePriceNativePerToken(trades[0], decimals ?? DEFAULT_TOKEN_DECIMALS)");
    expect(component).toContain(": startingPriceNativePerToken;");
  });

  it("overlays MA20 (lime) and MA50 (white) lines computed from the pure moving-average function", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("computeMovingAverage(candles, MA20_PERIOD)");
    expect(component).toContain("computeMovingAverage(candles, MA50_PERIOD)");
    expect(component).toContain("chart.addLineSeries({\n      color: MA20_COLOR");
    expect(component).toContain("chart.addLineSeries({\n      color: MA50_COLOR");
  });

  it("adds a volume histogram pane hidden by default, with a toggle button", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("chart.addHistogramSeries(");
    expect(component).toContain("visible: false,");
    expect(component).toContain("const [showVolume, setShowVolume] = useState(false);");
    expect(component).toContain("volumeSeriesRef.current?.applyOptions({ visible: showVolume });");
  });

  it("offers a crosshair (default) and horizontal-line drawing tool; clicking with the line tool active adds a removable price line", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain('useState<ChartTool>("crosshair")');
    expect(component).toContain('data-token-chart-tool="crosshair"');
    expect(component).toContain('data-token-chart-tool="horizontal-line"');
    expect(component).toContain("chart.subscribeClick(");
    expect(component).toContain("candleSeries.coordinateToPrice(param.point.y)");
    expect(component).toContain("addHorizontalLine(current, price,");
    expect(component).toContain("series.createPriceLine({");
    expect(component).toContain("removeHorizontalLine(current, line.id)");
    expect(component).toContain("series.removePriceLine(priceLine);");
  });

  it("shows a thin amber stale banner with a working RETRY wired to the hook's retry function", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain('data-token-chart-stale="true"');
    expect(component).toContain("Live data paused — showing last known prices");
    expect(component).toContain("onClick={retry}");
  });

  it("shows a crosshair tooltip with time (UTC), change %, OHLC at six significant figures, and VOL in ETH", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("chart.subscribeCrosshairMove(");
    expect(component).toContain('data-token-chart-tooltip="true"');
    expect(component).toContain("formatUtcTime(hoverInfo.time)");
    expect(component).toContain("formatSignedPercent(hoverChangePercent, 2)");
    expect(component).toContain("{hoverInfo.volume.toFixed(1)} ETH");
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

describe("useTokenCurveStatus stale-while-revalidate (issue #449 item 1: the swap panel flash)", () => {
  it("only shows the loading status before a curve's first resolved read — a second load() for the same curve never resets to loading", async () => {
    const hook = await source("lib/use-token-curve-status.ts");
    expect(hook).toContain("const loadedCurveRef = useRef<Address | null>(null);");
    const loadStart = hook.indexOf("async (curve: Address) => {");
    expect(loadStart).toBeGreaterThan(-1);
    expect(hook.indexOf('if (loadedCurveRef.current !== curve) {\n        setStatus({ kind: "loading" });\n      }')).toBeGreaterThan(
      loadStart,
    );
  });

  it("keeps the same status object reference when a poll resolves to identical values instead of forcing a re-render", async () => {
    const hook = await source("lib/use-token-curve-status.ts");
    expect(hook).toContain("function statusesEqual(a: TokenCurveStatus, b: TokenCurveStatus): boolean {");
    expect(hook).toContain("setStatus((current) => (statusesEqual(current, next) ? current : next));");
    expect(hook).toContain('setStatus((current) => (current.kind === "wrong-token" ? current : { kind: "wrong-token" }));');
  });

  it("keeps the last known status on a failed refresh and sets a separate stale flag instead of clobbering it back to an error, mirroring lib/use-token-trades.ts", async () => {
    const hook = await source("lib/use-token-curve-status.ts");
    expect(hook).toContain("const [stale, setStale] = useState(false);");
    expect(hook).toContain("if (loadedCurveRef.current === curve) {");
    expect(hook).toContain("setStale(true);");
    expect(hook).toContain("return { status, stale };");
  });

  it("threads the new { status, stale } return shape through token-page-view.tsx's single call site", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).toContain("const { status: curveStatus } = useTokenCurveStatus(address, curveAddress, decimals);");
  });
});
