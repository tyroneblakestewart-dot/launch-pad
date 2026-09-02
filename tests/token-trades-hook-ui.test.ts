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
    expect(hook).toContain("POLL_INTERVAL_MS = 5_000");
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

  it("never resets to a loading state on a background refresh inside load() — only ever overwrites the trades array in place; a reset to null happens only outside load(), on a genuine curve switch", async () => {
    const hook = await source("lib/use-token-trades.ts");
    const loadStart = hook.indexOf("const load = useCallback(async () => {");
    const loadEnd = hook.indexOf("}, []);", loadStart);
    expect(loadStart).toBeGreaterThan(-1);
    const loadBody = hook.slice(loadStart, loadEnd);
    expect(loadBody).not.toContain("setTrades(null)");
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

describe("useTokenTrades curve-bound reset + stale-response guard (issue #453 area 2)", () => {
  it("resets trades/error/stale to their initial state only when curveAddress genuinely changes value, not on every same-value re-render", async () => {
    const hook = await source("lib/use-token-trades.ts");
    const resetEffectStart = hook.indexOf("if (curveRef.current === curveAddress) return;");
    expect(resetEffectStart).toBeGreaterThan(-1);
    const resetEffectEnd = hook.indexOf("}, [curveAddress]);", resetEffectStart);
    const resetEffectBody = hook.slice(resetEffectStart, resetEffectEnd);
    expect(resetEffectBody).toContain("curveRef.current = curveAddress;");
    expect(resetEffectBody).toContain("tradesRef.current = null;");
    expect(resetEffectBody).toContain("setTrades(null);");
    expect(resetEffectBody).toContain("setError(null);");
    expect(resetEffectBody).toContain("setStale(false);");
  });

  it("discards a response for a curve that's no longer current, both on success and on a failed poll, instead of merging it in or clobbering the new curve's error/stale state", async () => {
    const hook = await source("lib/use-token-trades.ts");
    const loadStart = hook.indexOf("const load = useCallback(async () => {");
    const loadEnd = hook.indexOf("}, []);", loadStart);
    const loadBody = hook.slice(loadStart, loadEnd);
    const guardOccurrences = loadBody.match(/if \(curveRef\.current !== curve\) return;/g) ?? [];
    expect(guardOccurrences.length).toBe(2);
    // One guard must sit after the await/parse (success path), the other in the catch block.
    const successGuardIndex = loadBody.indexOf("if (curveRef.current !== curve) return;");
    const catchIndex = loadBody.indexOf("} catch {");
    const catchGuardIndex = loadBody.indexOf("if (curveRef.current !== curve) return;", catchIndex);
    expect(successGuardIndex).toBeGreaterThan(-1);
    expect(successGuardIndex).toBeLessThan(catchIndex);
    expect(catchGuardIndex).toBeGreaterThan(catchIndex);
  });

  it("dedupes a focus + visibilitychange event pair into one in-flight request instead of two concurrent ones, scoped per-curve so it can never block a different (newly switched-to) curve's own load", async () => {
    const hook = await source("lib/use-token-trades.ts");
    expect(hook).toContain("const inFlightCurveRef = useRef<string | null>(null);");
    expect(hook).toContain("if (inFlightCurveRef.current === curve) return;");
    expect(hook).toContain("inFlightCurveRef.current = curve;");
    const loadStart = hook.indexOf("const load = useCallback(async () => {");
    const loadEnd = hook.indexOf("}, []);", loadStart);
    const loadBody = hook.slice(loadStart, loadEnd);
    expect(loadBody).toContain("} finally {\n      if (inFlightCurveRef.current === curve) inFlightCurveRef.current = null;\n    }");
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

  it("offers the extended 1S/15S/1M/5M/15M/1H/6H/1D/ALL timeframe rail (issue #470 item 1), defaulting to 1H", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain('useState<ChartTimeframe>("1h")');
    expect(component).toContain("CHART_TIMEFRAMES.map");
    expect(component).toContain('"1s": "1S"');
    expect(component).toContain('"15s": "15S"');
    expect(component).toContain('"1m": "1M"');
    expect(component).toContain('all: "ALL"');

    const bucketing = await source("lib/candle-bucketing.ts");
    expect(bucketing).toContain('export const CANDLE_INTERVALS: readonly CandleInterval[] = ["1s", "15s", "1m", "5m", "15m", "1h", "6h", "1d"];');
    // The rail itself renders CHART_TIMEFRAMES directly (see the assertion
    // above), and CHART_TIMEFRAMES's own length (nine: eight intervals plus
    // ALL) is covered directly in tests/candle-bucketing.test.ts.
  });

  it("never calls fitContent to force a visible window — bar width is fixed via barSpacing instead (issue #449 item 2: the 3x-wide-candle defect)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).not.toContain("fitContent(");
    expect(component).not.toContain("resolveInitialVisibleRange");
  });

  it("never calls scrollToRealTime — positioning on the timeline's last point (including trailing whitespace) is owned by the pure engine's explicit visible-logical-range calls instead (issue #467 item 1)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).not.toContain("scrollToRealTime(");
    const engine = await source("lib/token-trade-chart-render.ts");
    expect(engine).not.toContain("scrollToRealTime(");
  });

  it("disables the built-in shiftVisibleRangeOnNewBar — the component owns following the clock itself (issue #467 item 2)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("shiftVisibleRangeOnNewBar: false");
  });

  // The out-of-order pre-check, the try/catch full-resync fallback, and the
  // "only setData on first load/timeframe change, otherwise diff+update"
  // decision (issue #445/#451 follow-up) were extracted to a pure,
  // unit-tested engine in issue #458 item 3 — see
  // tests/token-trade-chart-render.test.ts for behavioural coverage
  // (including the incremental sell-candle fixture) against a fake series
  // object. This component-level test only pins that the effect wires the
  // real series/time-scale into that engine instead of re-implementing the
  // decision inline.
  it("delegates the whole update/resync decision to the pure engine instead of re-implementing it inline", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain(
      'import {\n  applyChartResize,\n  applyTokenTradeChartUpdate,\n  createInitialTokenTradeChartRenderState,\n  type ChartBar,\n  type TokenTradeChartRenderState,\n  type TokenTradeChartSeriesBundle,\n} from "@/lib/token-trade-chart-render";',
    );
    expect(component).toContain("applyTokenTradeChartUpdate(seriesBundle, renderStateRef.current, {");
    expect(component).not.toContain("needsFullResync");
    expect(component).not.toContain("diffChartSeriesPoints(");
  });

  it("advances the flat-filled timeline with the clock via a per-interval timer, independent of new trades arriving (issue #470 item 3)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("useState(() => Math.floor(Date.now() / 1000))");
    expect(component).toContain("const updateNowTick = () => setNowTick(Math.floor(Date.now() / 1000));");
    expect(component).toContain("const tickMs = chartTickIntervalMs(resolvedInterval);");
    expect(component).toContain("window.setInterval(updateNowTick, tickMs)");
    expect(component).toContain(
      'import {\n  addHorizontalLine,\n  chartIntervalShowsSeconds,\n  chartTickIntervalMs,',
    );
  });

  it("re-arms the tick timer whenever the resolved interval changes, so 1S ticks every second and 15S every 15s (issue #470 item 3)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    const effectStart = component.indexOf("const updateNowTick = () => setNowTick(Math.floor(Date.now() / 1000));");
    expect(effectStart).toBeGreaterThan(-1);
    const effectEnd = component.indexOf("}, [resolvedInterval]);", effectStart);
    expect(effectEnd).toBeGreaterThan(effectStart);
    const effectBody = component.slice(effectStart, effectEnd);
    expect(effectBody).toContain("chartTickIntervalMs(resolvedInterval)");

    const toolsModule = await source("lib/token-chart-tools.ts");
    expect(toolsModule).toContain("export function chartTickIntervalMs(interval: CandleInterval | null): number {");
  });

  it("catches the clock up immediately on mount, tab-visible and window-focus, instead of waiting on the interval alone (issue #464 item 1: the background-tab clock-freeze defect)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    const effectStart = component.indexOf("const updateNowTick = () => setNowTick(Math.floor(Date.now() / 1000));");
    expect(effectStart).toBeGreaterThan(-1);
    const effectEnd = component.indexOf("}, [resolvedInterval]);", effectStart);
    const effectBody = component.slice(effectStart, effectEnd);

    // Immediate call on mount, before the interval is ever registered.
    expect(effectBody.indexOf("updateNowTick();")).toBeLessThan(effectBody.indexOf("window.setInterval("));

    expect(effectBody).toContain('function handleVisibilityChange() {\n      if (document.visibilityState === "visible") updateNowTick();\n    }');
    expect(effectBody).toContain('document.addEventListener("visibilitychange", handleVisibilityChange)');
    expect(effectBody).toContain('window.addEventListener("focus", updateNowTick)');

    // Both listeners and the interval are torn down on unmount.
    expect(effectBody).toContain("window.clearInterval(timer);");
    expect(effectBody).toContain('document.removeEventListener("visibilitychange", handleVisibilityChange);');
    expect(effectBody).toContain('window.removeEventListener("focus", updateNowTick);');
  });

  it("enables secondsVisible on the time axis for 1S/15S only, applied reactively as the resolved interval changes (issue #470 item 4)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain(
      "chartRef.current?.applyOptions({ timeScale: { secondsVisible: chartIntervalShowsSeconds(resolvedInterval) } });",
    );
    const toolsModule = await source("lib/token-chart-tools.ts");
    expect(toolsModule).toContain('return interval === "1s" || interval === "15s";');
  });

  it("shows seconds in the crosshair tooltip time only for 1S/15S, via the same chartIntervalShowsSeconds helper", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("function formatUtcTime(unixSeconds: number, showSeconds: boolean): string {");
    expect(component).toContain("{formatUtcTime(hoverInfo.time, chartIntervalShowsSeconds(resolvedInterval))}");
  });

  it("positions on the timeline's last point via an explicit width-derived visible logical range on the first load/timeframe-change branch, sourced from the guarded ResizeObserver's own tracked width (issue #467 item 1)", async () => {
    const engine = await source("lib/token-trade-chart-render.ts");
    expect(engine).toContain("series.timeScale.setVisibleLogicalRange(computeInitialVisibleLogicalRange(lastPointIndex, chartWidthPx));");
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("chartWidthPx: lastAppliedSizeRef.current?.width ?? 0,");
  });

  it("re-derives the visible range on resize while at the right edge, via the same pure applyChartResize helper the data-flow effect's positioning shares", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    const resizeStart = component.indexOf("const resizeObserver = new ResizeObserver((entries) => {");
    expect(resizeStart).toBeGreaterThan(-1);
    const resizeEnd = component.indexOf("resizeObserver.observe(container);", resizeStart);
    const resizeBody = component.slice(resizeStart, resizeEnd);
    expect(resizeBody).toContain("applyChartResize(");
    expect(resizeBody).toContain("renderStateRef.current.hasRenderedOnce");
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

  it("configures a custom priceFormat clamped to the chart's own magnitude-derived decimal count, so a near-zero crosshair position never reads two dozen digits (issue #464 item 2)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain(
      'import {\n  formatNativeAmountSixSigFigsTrimmed,\n  formatNativePriceAtDecimals,\n  formatNativePriceSixSigFigs,\n  formatSignedPercent,\n} from "@/lib/token-page-format";',
    );
    expect(component).toContain('type: "custom"');
    expect(component).toContain("formatter: (price: number) => formatNativePriceAtDecimals(price, INITIAL_CHART_PRICE_DECIMALS)");
  });

  it("re-derives minMove from the data's own magnitude and re-applies it only when it changes, instead of a fixed value below real testnet prices (issue #451 item 1)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("computeChartMinMove,");
    expect(component).toContain("computeChartPriceDecimals,");
    expect(component).toContain('from "@/lib/token-chart-tools"');
    expect(component).toContain(
      "nextState.points.length > 0 ? Math.max(...nextState.points.map((point) => point.high)) : startingPriceNativePerToken",
    );
    expect(component).toContain("computeChartMinMove(maxPrice)");
    expect(component).toContain("if (minMove !== appliedMinMoveRef.current) {");
    expect(component).toContain("candleSeries.applyOptions({");
  });

  it("re-derives the shared price-decimals count alongside minMove, and applies it to the tooltip and the top last-price label, not just the axis (issue #464 item 2)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("const decimals = computeChartPriceDecimals(minMove);");
    expect(component).toContain(
      'priceFormat: { type: "custom", minMove, formatter: (price: number) => formatNativePriceAtDecimals(price, decimals) },',
    );
    expect(component).toContain("setPriceDecimals(decimals);");
    expect(component).toContain(
      '`${formatNativePriceAtDecimals(lastPrice, priceDecimals)} ETH`',
    );
    expect(component).toContain("formatNativePriceAtDecimals(hoverInfo.open, priceDecimals)");
    expect(component).toContain("formatNativePriceAtDecimals(hoverInfo.high, priceDecimals)");
    expect(component).toContain("formatNativePriceAtDecimals(hoverInfo.low, priceDecimals)");
    expect(component).toContain("formatNativePriceAtDecimals(hoverInfo.close, priceDecimals)");
  });

  it("disables the candle series' own built-in price line/last-value tag — there must be exactly one last-price indicator on the chart (issue #458 item 2)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("priceLineVisible: false");
    expect(component).toContain("lastValueVisible: false");
    expect(component).not.toContain("priceLineVisible: true");
    expect(component).not.toContain("lastValueVisible: true");
  });

  it("draws the one dashed lime last-price line itself, keyed off the same shared spot price as the header, and keeps it in sync via applyOptions rather than recreating it every render (issue #458 item 2)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    const effectStart = component.indexOf("useEffect(() => {\n    const candleSeries = candleSeriesRef.current;\n    if (!candleSeries) return;");
    expect(effectStart).toBeGreaterThan(-1);
    const effectEnd = component.indexOf("}, [lastPrice]);", effectStart);
    const effectBody = component.slice(effectStart, effectEnd);
    expect(effectBody).toContain("lastPriceLineRef.current.applyOptions({ price: lastPrice });");
    expect(effectBody).toContain("candleSeries.createPriceLine({");
    expect(effectBody).toContain("lineStyle: LineStyle.Dashed");
    expect(effectBody).toContain("color: UP_COLOR");
    expect(effectBody).toContain("candleSeries.removePriceLine(lastPriceLineRef.current);");
  });

  it("never computes its own separate last price — it derives from the same shared trades/starting-price source as the header, using the curve's actual post-trade spot price (issue #458 item 1)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain('import {\n  CHART_TIMEFRAMES,\n  resolveChartInterval,\n  tradeSpotPriceNativePerToken,');
    expect(component).toContain("tradeSpotPriceNativePerToken(trades[0], decimals ?? DEFAULT_TOKEN_DECIMALS)");
    expect(component).toContain(": startingPriceNativePerToken;");
  });

  it("overlays MA20 (lime) and MA50 (white) line series, fed by the pure engine's own moving-average computation", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("chart.addLineSeries({\n      color: MA20_COLOR");
    expect(component).toContain("chart.addLineSeries({\n      color: MA50_COLOR");
    const engine = await source("lib/token-trade-chart-render.ts");
    expect(engine).toContain("computeMovingAverage(points, MA20_PERIOD)");
    expect(engine).toContain("computeMovingAverage(points, MA50_PERIOD)");
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

  it("shows a crosshair tooltip with time (UTC), change %, OHLC at the chart's clamped decimal precision, and VOL in ETH", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("chart.subscribeCrosshairMove(");
    expect(component).toContain('data-token-chart-tooltip="true"');
    expect(component).toContain("formatUtcTime(hoverInfo.time, chartIntervalShowsSeconds(resolvedInterval))");
    expect(component).toContain("formatSignedPercent(hoverChangePercent, 2)");
    expect(component).toContain("{formatNativeAmountSixSigFigsTrimmed(hoverInfo.volume)} ETH");
  });

  it("preserves the last valid tooltip over a whitespace bar (time/point present, no OHLC) instead of clearing it — only a genuine crosshair leave clears it (issue #453 area 3)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    const subscribeStart = component.indexOf("chart.subscribeCrosshairMove((param) => {");
    expect(subscribeStart).toBeGreaterThan(-1);
    const subscribeEnd = component.indexOf("});", subscribeStart);
    const subscribeBody = component.slice(subscribeStart, subscribeEnd);

    const leaveGuardIndex = subscribeBody.indexOf("if (!param.time || !param.point) {");
    const leaveClearIndex = subscribeBody.indexOf("setHoverInfo(null);", leaveGuardIndex);
    expect(leaveGuardIndex).toBeGreaterThan(-1);
    expect(leaveClearIndex).toBeGreaterThan(leaveGuardIndex);

    const noBarGuardIndex = subscribeBody.indexOf("if (!bar) {");
    expect(noBarGuardIndex).toBeGreaterThan(leaveGuardIndex);
    const noBarBlockEnd = subscribeBody.indexOf("}", noBarGuardIndex);
    const noBarBlock = subscribeBody.slice(noBarGuardIndex, noBarBlockEnd);
    expect(noBarBlock).not.toContain("setHoverInfo(null)");
    expect(noBarBlock).toContain("return;");
  });

  // The rendered-interval tracking that treats a resolved-interval change
  // while staying on ALL as a real timeframe change (issue #453 area 4), and
  // the volume series sharing the exact same real candle timestamps as the
  // candlestick series (issue #453 area 5), both now live inside
  // lib/token-trade-chart-render.ts's TokenTradeChartRenderState/
  // applyTokenTradeChartUpdate — see tests/token-trade-chart-render.test.ts.

  it("re-derives resolvedInterval from the current trades on every render, including a fresh ALL re-selection, instead of a stale memoised value", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain(
      "const resolvedInterval = useMemo(() => {\n    if (trades === null) return null;\n    return resolveChartInterval(timeframe, trades, decimals ?? DEFAULT_TOKEN_DECIMALS);\n  }, [trades, decimals, timeframe]);",
    );
  });

  it("gives the volume series its own named price scale, distinct from the candlestick series' scale, without an independent time source", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain('priceScaleId: "chart-volume"');
    const engine = await source("lib/token-trade-chart-render.ts");
    expect(engine).toContain("volumeBarColor(point)");
  });

  it("never touches horizontal price lines from the data-flow/timeframe effect — the lines effect depends only on horizontalLines, so a timeframe change can't clear or move a drawn line (issue #453 area 6)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    const linesEffectStart = component.indexOf("const remainingIds = new Set(priceLinesRef.current.keys());");
    expect(linesEffectStart).toBeGreaterThan(-1);
    const linesEffectDepsIndex = component.indexOf("}, [horizontalLines]);", linesEffectStart);
    expect(linesEffectDepsIndex).toBeGreaterThan(linesEffectStart);
    // The exact same numeric price is what gets persisted/recreated — never
    // re-derived from the chart's current view.
    expect(component).toContain("series.createPriceLine({\n          price: line.price,");
  });

  it("uses a compact, fixed-size remove control for a drawn line instead of a variable-width price-text chip that could overflow the tool rail — the exact price still reaches assistive tech via aria-label/title (issue #453 area 8)", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("const removeLabel = `Remove horizontal line at ${formatNativePriceSixSigFigs(line.price)}`;");
    expect(component).toContain("title={removeLabel}");
    expect(component).toContain("aria-label={removeLabel}");
    expect(component).not.toContain("{formatNativePriceSixSigFigs(line.price)} ×");
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

  it("renders a design-matching TYPE/WALLET/AMOUNT/ETH/TIME table: a dedicated ETH column from the post-fee native amount, coloured by side, right-aligned alongside AMOUNT (issue #467 item 4)", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain("import { formatEther } from \"viem\";");
    expect(component).toContain("function formatTradeEthAmount(nativeAmountRaw: string): string {");
    expect(component).toContain("formatTradeEthAmount(trade.nativeAmountRaw)");

    // Header row: five columns in the design's order, AMOUNT/ETH/TIME right-aligned.
    const headerStart = component.indexOf("<div className={`${styles.activityHeaderRow} ${styles.tradesGridCols}`}>");
    expect(headerStart).toBeGreaterThan(-1);
    const headerEnd = component.indexOf("</div>", headerStart);
    const headerBlock = component.slice(headerStart, headerEnd);
    expect(headerBlock).toContain("<span>Type</span>");
    expect(headerBlock).toContain("<span>Wallet</span>");
    expect(headerBlock).toContain("<span className={styles.tradesCellRight}>Amount</span>");
    expect(headerBlock).toContain("<span className={styles.tradesCellRight}>ETH</span>");
    expect(headerBlock).toContain("<span className={styles.tradesCellRight}>Time</span>");

    // The ETH cell shares the same buy/sell colour class as the TYPE badge — never an independent colour decision.
    expect(component).toContain("const directionColorClass = trade.direction === \"buy\" ? styles.tradeTypeBuy : styles.tradeTypeSell;");
    expect(component).toContain("<span className={directionColorClass}>{trade.direction === \"buy\" ? \"▲ BUY\" : \"▼ SELL\"}</span>");
    expect(component).toContain("<span className={`${directionColorClass} ${styles.tradesCellRight}`}>");
  });

  it("sizes the trades grid columns to the design's exact widths (TYPE/WALLET/AMOUNT/ETH/TIME)", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const colsStart = css.indexOf(".tradesGridCols {");
    const colsEnd = css.indexOf("}", colsStart);
    expect(css.slice(colsStart, colsEnd)).toContain("grid-template-columns: 64px 1fr 110px 96px 56px;");
  });

  it("renders a small POOL badge on a post-graduation pool-swap row, inside the wallet cell (issue #466)", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain('trade.venue === "pool" ? <span className={styles.poolBadge}>POOL</span> : null');

    // The badge lives inside a flex-wrapping wallet cell, not a new grid
    // column — the trades table's fixed five-column layout is unchanged.
    const walletCellStart = component.indexOf("<span className={styles.tradeWalletCell}>");
    expect(walletCellStart).toBeGreaterThan(-1);
    const walletCellEnd = component.indexOf("styles.bodyText", walletCellStart);
    const walletCellBlock = component.slice(walletCellStart, walletCellEnd);
    expect(walletCellBlock).toContain("{shortenAddress(trade.wallet)}");
    expect(walletCellBlock).toContain("poolBadge");

    const css = await source("components/token-page/token-page.module.css");
    expect(css).toContain(".poolBadge {");
    expect(css).toContain(".tradeWalletCell {");
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
