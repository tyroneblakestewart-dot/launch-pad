"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CrosshairMode,
  LineStyle,
  createChart,
  type AutoscaleInfoProvider,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  CANDLE_INTERVAL_SECONDS,
  CHART_TIMEFRAMES,
  resolveChartInterval,
  tradeSpotPriceNativePerToken,
  type ChartTimeframe,
} from "@/lib/candle-bucketing";
import {
  addHorizontalLine,
  computeChartMinMove,
  computeChartPriceDecimals,
  expandDegeneratePriceRange,
  removeHorizontalLine,
  type ChartTool,
  type HorizontalLine,
} from "@/lib/token-chart-tools";
import {
  applyChartResize,
  applyTokenTradeChartUpdate,
  createInitialTokenTradeChartRenderState,
  type TokenTradeChartRenderState,
  type TokenTradeChartSeriesBundle,
} from "@/lib/token-trade-chart-render";
import { DEFAULT_TOKEN_DECIMALS } from "@/lib/bonding-curve-deploy-config";
import {
  formatNativeAmountSixSigFigsTrimmed,
  formatNativePriceAtDecimals,
  formatNativePriceSixSigFigs,
  formatSignedPercent,
} from "@/lib/token-page-format";
import type { TokenTrade } from "@/lib/token-trade-types";
import styles from "./token-page.module.css";

const TIMEFRAME_LABELS: Record<ChartTimeframe, string> = {
  "1s": "1S",
  "15s": "15S",
  "1m": "1M",
  "5m": "5M",
  "15m": "15M",
  "1h": "1H",
  "6h": "6H",
  "1d": "1D",
  all: "ALL",
};

/** Only these two chips show seconds — a 1H/1D-labelled timestamp would misleadingly imply second-level precision it doesn't have (issue #470 item 4). */
function showsSecondsForTimeframe(timeframe: ChartTimeframe): boolean {
  return timeframe === "1s" || timeframe === "15s";
}

const UP_COLOR = "#c6f53e";
const DOWN_COLOR = "#e2564b";
const MA20_COLOR = "#c6f53e";
const MA50_COLOR = "#ffffff";
const HORIZONTAL_LINE_COLOR = "#9ad4ff";

// The candlestick series' priceFormat before any real data has resolved a
// minMove of its own (issue #464 item 2) — kept as one pair of constants so
// the mount-time priceFormat and the initial `priceDecimals` state below
// agree with each other from the very first render.
const INITIAL_CHART_MIN_MOVE = 0.00000001;
const INITIAL_CHART_PRICE_DECIMALS = computeChartPriceDecimals(INITIAL_CHART_MIN_MOVE);

type HoverInfo = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function formatUtcTime(unixSeconds: number, includeSeconds: boolean): string {
  const date = new Date(unixSeconds * 1000);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  if (!includeSeconds) return `${hh}:${mm} UTC`;
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss} UTC`;
}

/**
 * Live candlestick chart for the token page (issue #430), rebuilt to the
 * design and to genuinely in-place live updates (issue #445), built on
 * TradingView's lightweight-charts (pinned 4.1.3). The chart itself always
 * mounts on render, independent of `trades` — the owner's explicit
 * requirement is axes + gridlines even at zero trades, never a placeholder
 * box — with only a text overlay layered on top for the empty/error states.
 *
 * `series.setData()` (which resets the visible range) only ever runs on the
 * very first load, on a timeframe change, and in one crash-safe fallback
 * (below); every other update diffs the freshly-rebucketed candles/MAs/
 * volume against what's already rendered (lib/candle-bucketing.ts's
 * diffCandles/diffTimeSeries) and calls `series.update()` for just the
 * mutated last bar and any newly appended ones — `update()` extends the
 * series without touching the current visible range, which is what keeps a
 * scrolled-back user's view stable while still following the latest bar for
 * a viewer already at the right edge. Sizing is driven by a manually
 * guarded ResizeObserver instead of `autoSize: true`: the deployed page's
 * ~1s candle jump traced back to that option's own observer re-firing on
 * sub-pixel layout noise and feeding straight back into another reflow —
 * resizing only when the rounded pixel size actually changes breaks that
 * loop.
 *
 * Bar width (issue #449 item 2): the time scale's own `barSpacing`/
 * `minBarSpacing` are fixed constants, so pixel width per candle stays
 * constant regardless of chart width or candle count — nothing here ever
 * calls `fitContent` to force a window (the deployed bug: forcing a
 * 120-bar window on a low-trade-count token spread candles to ~3x the
 * design's width).
 *
 * Positioning on "now" (issue #467 item 1): the old `scrollToRealTime` call
 * this component used to make, and the timeScale's own `shiftVisibleRangeOnNewBar` (explicitly disabled below),
 * both act on the last bar that carries real series data and ignore
 * trailing whitespace bars — since `buildChartSeriesPoints` extends the
 * timeline with whitespace all the way to the current bucket, those
 * built-ins left the view scrolled to the last real candle while the axis
 * never reached the present on a token with a long trade-free tail, making
 * the chart look permanently frozen. `lib/token-trade-chart-render.ts`'s
 * `applyTokenTradeChartUpdate` positions and follows the timeline itself
 * instead, via `setVisibleLogicalRange` — this component only supplies the
 * chart's real container width (`lastAppliedSizeRef`, already tracked by the
 * guarded ResizeObserver below) as `chartWidthPx`, and re-invokes the same
 * resize-follow logic (`applyChartResize`) whenever that width itself
 * changes, independent of any data poll.
 *
 * Out-of-order update crash (issue #451 follow-up): the whitespace
 * timeline's tail advances on its own clock, independent of when a trade is
 * fetched, so a trade landing in a bucket that tail has already moved past
 * produces an `update()` target that's no longer the last bar —
 * lightweight-charts throws "Cannot update oldest data" for that. The
 * incremental branch inside `applyTokenTradeChartUpdate` detects this (and
 * catches any update() throw it doesn't anticipate) and falls back to a full
 * `setData()` for every series: it reads `getVisibleLogicalRange()` first
 * and restores it right after, so the user's view still doesn't jump.
 */
export function TokenTradeChart({
  trades,
  decimals,
  error,
  stale,
  retry,
  startingPriceNativePerToken,
  launchedAtUnixSeconds,
  pairLabel,
}: {
  trades: TokenTrade[] | null;
  decimals: number | null;
  error: string | null;
  stale: boolean;
  retry: () => void;
  startingPriceNativePerToken: number | null;
  /** Unix seconds the token launched, when known — caps how far the pre-trade whitespace padding can reach (issue #458 item 5). */
  launchedAtUnixSeconds: number | null;
  pairLabel: string;
}) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1h");
  const [showVolume, setShowVolume] = useState(false);
  const [tool, setTool] = useState<ChartTool>("crosshair");
  const [horizontalLines, setHorizontalLines] = useState<HorizontalLine[]>([]);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  const plotRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const lastPriceLineRef = useRef<IPriceLine | null>(null);
  const renderStateRef = useRef<TokenTradeChartRenderState>(createInitialTokenTradeChartRenderState());
  const appliedMinMoveRef = useRef<number | null>(null);
  const toolRef = useRef<ChartTool>(tool);
  const lastAppliedSizeRef = useRef<{ width: number; height: number } | null>(null);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  // Every chart price display (axis, crosshair, tooltip, last-price tag)
  // renders at this fixed decimal count, re-derived from the chart's own
  // current minMove whenever it changes (issue #464 item 2) — see the
  // data-flow effect below, where it's set alongside appliedMinMoveRef.
  const [priceDecimals, setPriceDecimals] = useState(INITIAL_CHART_PRICE_DECIMALS);

  const resolvedInterval = useMemo(() => {
    if (trades === null) return null;
    return resolveChartInterval(timeframe, trades, decimals ?? DEFAULT_TOKEN_DECIMALS);
  }, [trades, decimals, timeframe]);

  // Whitespace bars advance the visible timeline "with the clock" (issue
  // #451 item 2) even when no new trade has arrived to otherwise trigger a
  // re-render. The tick itself is min(intervalSeconds, 30) — 1s on 1S, 15s on
  // 15S, and the prior fixed 30s everywhere from 1M up (issue #470 item 3):
  // a coarse timeframe never needs a live-second clock, but a sub-minute one
  // does, or its own current-bucket whitespace bar would lag up to 30
  // buckets behind "now". Falls back to 1H's 30s cadence before the first
  // trades response has resolved an interval at all. Browsers suspend or
  // heavily throttle background-tab timers, so the interval alone left a tab
  // backgrounded overnight showing the chart frozen at its last trade (issue
  // #464 item 1); updating immediately on mount, on the tab becoming visible
  // again, and on window focus makes the clock catch up the moment it's
  // actually looked at again, while the interval keeps it ticking for an
  // already-foregrounded tab.
  const clockIntervalSeconds = Math.min(CANDLE_INTERVAL_SECONDS[resolvedInterval ?? "1h"], 30);
  const [nowTick, setNowTick] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const updateNowTick = () => setNowTick(Math.floor(Date.now() / 1000));
    updateNowTick();
    const timer = window.setInterval(updateNowTick, clockIntervalSeconds * 1000);
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") updateNowTick();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", updateNowTick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", updateNowTick);
    };
  }, [clockIntervalSeconds]);

  // Mount once: create the chart + every series instance, independent of
  // trade count. A manual ResizeObserver replaces `autoSize: true` (see the
  // component doc comment above) — it only calls `chart.resize()` when the
  // rounded pixel size genuinely changed, so it can never feed a resize loop.
  useEffect(() => {
    const container = plotRef.current;
    if (!container) return;
    const priceLines = priceLinesRef.current;

    const chart = createChart(container, {
      layout: {
        background: { color: "transparent" },
        textColor: "#6f746e",
        fontFamily: "'IBM Plex Mono', monospace",
      },
      grid: {
        // Horizontal/vertical grid lines carry deliberately different
        // opacities per the design (issue #460 section 7).
        vertLines: { color: "rgba(255, 255, 255, 0.035)" },
        horzLines: { color: "rgba(255, 255, 255, 0.045)" },
      },
      rightPriceScale: { borderColor: "rgba(255, 255, 255, 0.07)" },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.07)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 6,
        minBarSpacing: 3,
        // Positioning/following is owned by lib/token-trade-chart-render.ts's
        // explicit setVisibleLogicalRange calls (issue #467 items 1-2), never
        // this built-in — see the component doc comment above.
        shiftVisibleRangeOnNewBar: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(255, 255, 255, 0.35)", style: LineStyle.Dashed, labelBackgroundColor: "#2b302c" },
        horzLine: { color: "rgba(255, 255, 255, 0.35)", style: LineStyle.Dashed, labelBackgroundColor: "#2b302c" },
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderVisible: false,
      wickUpColor: "rgba(198, 245, 62, 0.9)",
      wickDownColor: "rgba(226, 86, 75, 0.9)",
      priceFormat: {
        type: "custom",
        minMove: INITIAL_CHART_MIN_MOVE,
        formatter: (price: number) => formatNativePriceAtDecimals(price, INITIAL_CHART_PRICE_DECIMALS),
      },
      // Single last-price indicator (issue #458 item 2): the series' own
      // built-in price line/last-value tag are disabled so there is exactly
      // one dashed last-price line on the chart, driven by the same shared
      // spot price as the header (see the lastPriceLineRef effect below) —
      // the built-in one previously mutated independently of that shared
      // value and could show a stale pre-trade price after an incremental
      // update.
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // A single candle (or any window where every visible bar shares one
    // price) makes lightweight-charts' default autoscale compute a
    // zero-height price range, which suppresses every tick label except the
    // last-price tag — percentage scaleMargins can't fix a percentage of
    // zero (see expandDegeneratePriceRange's own doc comment). This only
    // ever pads that genuinely-flat case; a real multi-price range is
    // returned untouched.
    const autoscaleInfoProvider: AutoscaleInfoProvider = (original) => {
      const info = original();
      if (!info) return info;
      const { minValue, maxValue } = expandDegeneratePriceRange(info.priceRange.minValue, info.priceRange.maxValue);
      return { ...info, priceRange: { minValue, maxValue } };
    };
    candleSeries.applyOptions({ autoscaleInfoProvider });

    const ma20Series = chart.addLineSeries({
      color: MA20_COLOR,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const ma50Series = chart.addLineSeries({
      color: MA50_COLOR,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "chart-volume",
      visible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chart.subscribeClick((param: MouseEventParams) => {
      if (toolRef.current !== "horizontal-line" || !param.point) return;
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price === null) return;
      setHorizontalLines((current) => addHorizontalLine(current, price, `hline-${Date.now()}-${current.length}`));
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        setHoverInfo(null);
        return;
      }
      const bar = param.seriesData.get(candleSeries) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (!bar) {
        // A whitespace bar has a time/point but no OHLC — preserve the last
        // valid hover info instead of flickering the tooltip closed while
        // the crosshair is still genuinely over the chart (issue #453
        // area 3).
        return;
      }
      const volumeBar = param.seriesData.get(volumeSeries) as { value: number } | undefined;
      setHoverInfo({
        time: Number(param.time),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: volumeBar?.value ?? 0,
      });
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    ma20SeriesRef.current = ma20Series;
    ma50SeriesRef.current = ma50Series;
    volumeSeriesRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width <= 0 || height <= 0) return;
      const lastApplied = lastAppliedSizeRef.current;
      if (lastApplied && Math.abs(lastApplied.width - width) < 1 && Math.abs(lastApplied.height - height) < 1) return;
      lastAppliedSizeRef.current = { width, height };
      chart.resize(width, height);

      // Re-derives the visible range from the new width while the viewer is
      // at the right edge (issue #467 item 1) — independent of any data
      // poll, since a resize alone (e.g. rotating a phone) can otherwise
      // leave the old range's bar count wrong for the new width.
      const lastPointIndex = renderStateRef.current.points.length - 1;
      if (renderStateRef.current.hasRenderedOnce) {
        applyChartResize(
          {
            timeScale: {
              getVisibleLogicalRange: () => chart.timeScale().getVisibleLogicalRange(),
              setVisibleLogicalRange: (range) => chart.timeScale().setVisibleLogicalRange(range),
            },
          },
          lastPointIndex,
          width,
        );
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      ma20SeriesRef.current = null;
      ma50SeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLines.clear();
      lastPriceLineRef.current = null;
      renderStateRef.current = createInitialTokenTradeChartRenderState();
      appliedMinMoveRef.current = null;
      lastAppliedSizeRef.current = null;
    };
  }, []);

  // Seconds only ever show on 1S/15S (issue #470 item 4) — every coarser
  // timeframe keeps the existing HH:MM axis. The chart is already created by
  // the mount effect above by the time this one first runs (same commit,
  // declared after it), and applyOptions on an already-mounted time scale
  // takes effect immediately, unlike the createChart-time option above,
  // which only sets the *initial* value.
  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { secondsVisible: showsSecondsForTimeframe(timeframe) } });
  }, [timeframe]);

  // The one shared spot price (issue #458 item 1) — never a second,
  // independently-computed last price. Every on-chart price indicator (the
  // small label above, the dashed last-price line below, and the candle
  // bucketing itself inside applyTokenTradeChartUpdate) traces back to this
  // same value or to `startingPriceNativePerToken`, the same source the
  // header band uses.
  const lastPrice =
    trades && trades.length > 0
      ? tradeSpotPriceNativePerToken(trades[0], decimals ?? DEFAULT_TOKEN_DECIMALS)
      : startingPriceNativePerToken;

  // Data flow (issue #445 items 2–3, extracted to a pure, unit-testable
  // engine in issue #458 item 3): setData (which resets the visible range)
  // only on first load or a timeframe change; every later poll diffs against
  // what's already rendered and calls series.update() for just the mutated
  // last bar / newly appended bars, which never disturbs the user's current
  // scroll position. The actual decision logic (including the out-of-order
  // pre-check and the crash-safe full-resync fallback, issue #451 follow-up)
  // lives in lib/token-trade-chart-render.ts's applyTokenTradeChartUpdate —
  // this effect only adapts the real lightweight-charts series/time-scale
  // into that pure function's duck-typed interface.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const ma20Series = ma20SeriesRef.current;
    const ma50Series = ma50SeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !ma20Series || !ma50Series || !volumeSeries || trades === null || resolvedInterval === null) {
      return;
    }

    const seriesBundle: TokenTradeChartSeriesBundle = {
      candleSeries: {
        setData: (data) =>
          candleSeries.setData(
            data.map((point) =>
              "open" in point
                ? { time: point.time as UTCTimestamp, open: point.open, high: point.high, low: point.low, close: point.close }
                : { time: point.time as UTCTimestamp },
            ),
          ),
        update: (point) =>
          candleSeries.update(
            "open" in point
              ? { time: point.time as UTCTimestamp, open: point.open, high: point.high, low: point.low, close: point.close }
              : { time: point.time as UTCTimestamp },
          ),
      },
      ma20Series: {
        setData: (data) => ma20Series.setData(data.map((point) => ({ time: point.time as UTCTimestamp, value: point.value }))),
        update: (point) => ma20Series.update({ time: point.time as UTCTimestamp, value: point.value }),
      },
      ma50Series: {
        setData: (data) => ma50Series.setData(data.map((point) => ({ time: point.time as UTCTimestamp, value: point.value }))),
        update: (point) => ma50Series.update({ time: point.time as UTCTimestamp, value: point.value }),
      },
      volumeSeries: {
        setData: (data) =>
          volumeSeries.setData(data.map((point) => ({ time: point.time as UTCTimestamp, value: point.value, color: point.color }))),
        update: (point) => volumeSeries.update({ time: point.time as UTCTimestamp, value: point.value, color: point.color }),
      },
      timeScale: {
        getVisibleLogicalRange: () => chartRef.current?.timeScale().getVisibleLogicalRange() ?? null,
        setVisibleLogicalRange: (range) => chartRef.current?.timeScale().setVisibleLogicalRange(range),
      },
    };

    const nextState = applyTokenTradeChartUpdate(seriesBundle, renderStateRef.current, {
      trades,
      decimals: decimals ?? DEFAULT_TOKEN_DECIMALS,
      interval: resolvedInterval,
      timeframe,
      nowUnixSeconds: nowTick,
      startingPriceNativePerToken,
      launchedAtUnixSeconds,
      // The same real container width the guarded ResizeObserver above
      // tracks (issue #467 item 1) — 0 only in the sliver of time before
      // that observer's first callback has fired, in which case the engine
      // simply sets an empty range that the observer's own follow-up call
      // immediately corrects.
      chartWidthPx: lastAppliedSizeRef.current?.width ?? 0,
    });

    const maxPrice =
      nextState.candles.length > 0 ? Math.max(...nextState.candles.map((candle) => candle.high)) : startingPriceNativePerToken;
    if (maxPrice !== null && maxPrice > 0) {
      const minMove = computeChartMinMove(maxPrice);
      if (minMove !== appliedMinMoveRef.current) {
        const decimals = computeChartPriceDecimals(minMove);
        candleSeries.applyOptions({
          priceFormat: { type: "custom", minMove, formatter: (price: number) => formatNativePriceAtDecimals(price, decimals) },
        });
        appliedMinMoveRef.current = minMove;
        setPriceDecimals(decimals);
      }
    }

    renderStateRef.current = nextState;
  }, [trades, decimals, resolvedInterval, timeframe, nowTick, startingPriceNativePerToken, launchedAtUnixSeconds]);

  // Single last-price indicator (issue #458 item 2): the one dashed
  // last-price line on the chart, driven by the exact same spot price the
  // header/last-price label use — never the series' own built-in price line
  // (disabled above), which could independently lag after an incremental
  // update.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    if (lastPrice === null || lastPrice === undefined || !(lastPrice > 0)) {
      if (lastPriceLineRef.current) {
        candleSeries.removePriceLine(lastPriceLineRef.current);
        lastPriceLineRef.current = null;
      }
      return;
    }
    if (lastPriceLineRef.current) {
      lastPriceLineRef.current.applyOptions({ price: lastPrice });
    } else {
      lastPriceLineRef.current = candleSeries.createPriceLine({
        price: lastPrice,
        color: UP_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "",
      });
    }
  }, [lastPrice]);

  // Volume pane visibility toggle (hidden by default) never touches the
  // data-flow effect above, so flipping it can't trigger a setData/re-range.
  useEffect(() => {
    volumeSeriesRef.current?.applyOptions({ visible: showVolume });
  }, [showVolume]);

  // Reconciles the horizontal-line tool's client-side state onto the chart's
  // actual price lines: adds any newly drawn line, removes any deleted one.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const remainingIds = new Set(priceLinesRef.current.keys());

    for (const line of horizontalLines) {
      if (!priceLinesRef.current.has(line.id)) {
        const priceLine = series.createPriceLine({
          price: line.price,
          color: HORIZONTAL_LINE_COLOR,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: "",
        });
        priceLinesRef.current.set(line.id, priceLine);
      }
      remainingIds.delete(line.id);
    }

    for (const staleId of remainingIds) {
      const priceLine = priceLinesRef.current.get(staleId);
      if (priceLine) series.removePriceLine(priceLine);
      priceLinesRef.current.delete(staleId);
    }
  }, [horizontalLines]);

  const showEmptyOverlay = !error && trades !== null && trades.length === 0;
  const hasLoadError = Boolean(error) && trades === null;

  const lastPriceLabel =
    lastPrice !== null && lastPrice !== undefined ? `${formatNativePriceAtDecimals(lastPrice, priceDecimals)} ETH` : "—";

  const hoverChangePercent = hoverInfo && hoverInfo.open > 0 ? ((hoverInfo.close - hoverInfo.open) / hoverInfo.open) * 100 : null;

  return (
    <>
      <div className={styles.chartHeader}>
        <div className={styles.chartPairInfo}>
          <span className={styles.chartPlaceholderLabel}>{pairLabel}</span>
          <span className={styles.chartLastPrice}>{lastPriceLabel}</span>
        </div>
        <div className={styles.chartHeaderControls}>
          <button
            type="button"
            className={`${styles.chartVolumeToggle} ${showVolume ? styles.chartVolumeToggleActive : ""}`}
            onClick={() => setShowVolume((current) => !current)}
            aria-pressed={showVolume}
          >
            Vol
          </button>
          <div className={styles.chartIntervalGroup} role="group" aria-label="Chart timeframe">
            {CHART_TIMEFRAMES.map((value) => (
              <button
                key={value}
                type="button"
                className={`${styles.chartIntervalButton} ${timeframe === value ? styles.chartIntervalButtonActive : ""}`}
                onClick={() => setTimeframe(value)}
              >
                {TIMEFRAME_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.chartBody}>
        <div className={styles.chartToolRail} role="group" aria-label="Drawing tools">
          <button
            type="button"
            className={`${styles.chartToolButton} ${tool === "crosshair" ? styles.chartToolButtonActive : ""}`}
            onClick={() => setTool("crosshair")}
            title="Crosshair"
            aria-pressed={tool === "crosshair"}
            data-token-chart-tool="crosshair"
          >
            +
          </button>
          <button
            type="button"
            className={`${styles.chartToolButton} ${tool === "horizontal-line" ? styles.chartToolButtonActive : ""}`}
            onClick={() => setTool("horizontal-line")}
            title="Horizontal line"
            aria-pressed={tool === "horizontal-line"}
            data-token-chart-tool="horizontal-line"
          >
            —
          </button>
          {horizontalLines.map((line) => {
            // A compact fixed-size remove control (issue #453 area 8):
            // the full price-text chip this replaces could overflow the
            // narrow tool rail at some prices/digit counts. The exact
            // price still reaches assistive tech via aria-label/title
            // instead of being dropped.
            const removeLabel = `Remove horizontal line at ${formatNativePriceSixSigFigs(line.price)}`;
            return (
              <button
                key={line.id}
                type="button"
                className={styles.chartLineChip}
                onClick={() => setHorizontalLines((current) => removeHorizontalLine(current, line.id))}
                title={removeLabel}
                aria-label={removeLabel}
                data-token-chart-remove-line={line.id}
              >
                ×
              </button>
            );
          })}
        </div>

        <div className={styles.chartCanvasWrap}>
          {stale && (
            <div className={styles.chartStaleBanner} data-token-chart-stale="true">
              <span>Live data paused — showing last known prices</span>
              <button type="button" className={styles.chartStaleRetry} onClick={retry}>
                RETRY
              </button>
            </div>
          )}

          <div ref={plotRef} className={styles.chartCanvas} data-token-chart-canvas="true" />

          {showEmptyOverlay && (
            <div className={styles.chartEmptyOverlay} data-token-chart-empty="true">
              <p className={styles.chartEmptyCopy}>No trades yet — the first buy starts the chart</p>
            </div>
          )}
          {hasLoadError && (
            <div className={styles.chartEmptyOverlay} data-token-chart-error="true">
              <p className={styles.chartEmptyCopy}>{error}</p>
            </div>
          )}

          {hoverInfo && (
            <div className={styles.chartTooltip} data-token-chart-tooltip="true">
              <div className={styles.chartTooltipHeader}>
                <span>{formatUtcTime(hoverInfo.time, showsSecondsForTimeframe(timeframe))}</span>
                {hoverChangePercent !== null && (
                  <span className={hoverChangePercent >= 0 ? styles.priceChangeUp : styles.priceChangeDown}>
                    {formatSignedPercent(hoverChangePercent, 2)}
                  </span>
                )}
              </div>
              <div className={styles.chartTooltipRow}>
                <span>O</span>
                <span>{formatNativePriceAtDecimals(hoverInfo.open, priceDecimals)}</span>
              </div>
              <div className={styles.chartTooltipRow}>
                <span>H</span>
                <span>{formatNativePriceAtDecimals(hoverInfo.high, priceDecimals)}</span>
              </div>
              <div className={styles.chartTooltipRow}>
                <span>L</span>
                <span>{formatNativePriceAtDecimals(hoverInfo.low, priceDecimals)}</span>
              </div>
              <div className={styles.chartTooltipRow}>
                <span>C</span>
                <span>{formatNativePriceAtDecimals(hoverInfo.close, priceDecimals)}</span>
              </div>
              <div className={styles.chartTooltipRow}>
                <span>VOL</span>
                <span>{formatNativeAmountSixSigFigsTrimmed(hoverInfo.volume)} ETH</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
