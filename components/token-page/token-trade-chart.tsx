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
  CHART_TIMEFRAMES,
  bucketTradesIntoCandles,
  buildChartSeriesPoints,
  computeMovingAverage,
  diffCandles,
  diffChartSeriesPoints,
  diffTimeSeries,
  isCandlePoint,
  resolveChartInterval,
  tradePriceNativePerToken,
  type Candle,
  type CandleInterval,
  type ChartSeriesPoint,
  type ChartTimeframe,
  type MovingAveragePoint,
} from "@/lib/candle-bucketing";
import {
  addHorizontalLine,
  computeChartMinMove,
  expandDegeneratePriceRange,
  removeHorizontalLine,
  type ChartTool,
  type HorizontalLine,
} from "@/lib/token-chart-tools";
import { DEFAULT_TOKEN_DECIMALS } from "@/lib/bonding-curve-deploy-config";
import { formatNativePriceSixSigFigs, formatSignedPercent } from "@/lib/token-page-format";
import type { TokenTrade } from "@/lib/token-trade-types";
import styles from "./token-page.module.css";

const TIMEFRAME_LABELS: Record<ChartTimeframe, string> = {
  "5m": "5M",
  "15m": "15M",
  "1h": "1H",
  "6h": "6H",
  "1d": "1D",
  all: "ALL",
};

const UP_COLOR = "#c6f53e";
const DOWN_COLOR = "#8d918c";
const MA20_COLOR = "rgba(198, 245, 62, 0.85)";
const MA50_COLOR = "rgba(255, 255, 255, 0.4)";
const HORIZONTAL_LINE_COLOR = "#9ad4ff";
const MA20_PERIOD = 20;
const MA50_PERIOD = 50;

type HoverInfo = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function candleToBar(candle: Candle) {
  return {
    time: candle.time as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

/** Converts a whitespace-inclusive timeline point to what the candlestick series expects: an OHLC bar, or a bare-time WhitespaceData point. */
function pointToSeriesDatum(point: ChartSeriesPoint) {
  return isCandlePoint(point) ? candleToBar(point) : { time: point.time as UTCTimestamp };
}

function volumeBarColor(candle: Candle): string {
  return candle.close >= candle.open ? "rgba(198, 245, 62, 0.35)" : "rgba(141, 145, 140, 0.35)";
}

function formatUtcTime(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
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
 * constant regardless of chart width or candle count — no normal code path
 * ever calls `setVisibleLogicalRange` or `fitContent` to force a window
 * (the deployed bug: forcing a 120-bar window on a low-trade-count token
 * spread candles to ~3x the design's width). `scrollToRealTime()` after
 * `setData()` is what puts the latest bar at the right edge instead.
 *
 * Out-of-order update crash (issue #451 follow-up): the whitespace
 * timeline's tail advances on its own clock, independent of when a trade is
 * fetched, so a trade landing in a bucket that tail has already moved past
 * produces an `update()` target that's no longer the last bar —
 * lightweight-charts throws "Cannot update oldest data" for that. The
 * incremental branch below detects this (and catches any update() throw it
 * doesn't anticipate) and falls back to a full `setData()` for every series,
 * the one exception to the no-forced-range rule above: it reads
 * `getVisibleLogicalRange()` first and restores it right after, so the
 * user's view still doesn't jump.
 */
export function TokenTradeChart({
  trades,
  decimals,
  error,
  stale,
  retry,
  startingPriceNativePerToken,
  pairLabel,
}: {
  trades: TokenTrade[] | null;
  decimals: number | null;
  error: string | null;
  stale: boolean;
  retry: () => void;
  startingPriceNativePerToken: number | null;
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
  const renderedPointsRef = useRef<ChartSeriesPoint[]>([]);
  const renderedCandlesRef = useRef<Candle[]>([]);
  const renderedMa20Ref = useRef<MovingAveragePoint[]>([]);
  const renderedMa50Ref = useRef<MovingAveragePoint[]>([]);
  const renderedTimeframeRef = useRef<ChartTimeframe | null>(null);
  const renderedResolvedIntervalRef = useRef<CandleInterval | null>(null);
  const hasRenderedOnceRef = useRef(false);
  const appliedMinMoveRef = useRef<number | null>(null);
  const toolRef = useRef<ChartTool>(tool);
  const lastAppliedSizeRef = useRef<{ width: number; height: number } | null>(null);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  // Whitespace bars advance the visible timeline "with the clock" (issue
  // #451 item 2) even when no new trade has arrived to otherwise trigger a
  // re-render — a slow, deliberately coarse tick, not a live-second clock.
  const [nowTick, setNowTick] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(timer);
  }, []);

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
        textColor: "#8d918c",
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.045)" },
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
      },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderVisible: false,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
      priceFormat: {
        type: "custom",
        minMove: 0.00000001,
        formatter: (price: number) => formatNativePriceSixSigFigs(price),
      },
      priceLineVisible: true,
      priceLineWidth: 1,
      priceLineColor: UP_COLOR,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
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
      renderedPointsRef.current = [];
      renderedCandlesRef.current = [];
      renderedMa20Ref.current = [];
      renderedMa50Ref.current = [];
      renderedTimeframeRef.current = null;
      renderedResolvedIntervalRef.current = null;
      hasRenderedOnceRef.current = false;
      appliedMinMoveRef.current = null;
      lastAppliedSizeRef.current = null;
    };
  }, []);

  const resolvedInterval = useMemo(() => {
    if (trades === null) return null;
    return resolveChartInterval(timeframe, trades, decimals ?? DEFAULT_TOKEN_DECIMALS);
  }, [trades, decimals, timeframe]);

  // Data flow (issue #445 items 2–3): setData (which resets the visible
  // range) only on first load or a timeframe change; every later poll diffs
  // against what's already rendered and calls series.update() for just the
  // mutated last bar / newly appended bars, which never disturbs the user's
  // current scroll position.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const ma20Series = ma20SeriesRef.current;
    const ma50Series = ma50SeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !ma20Series || !ma50Series || !volumeSeries || trades === null || resolvedInterval === null) {
      return;
    }

    const candles = bucketTradesIntoCandles(trades, resolvedInterval, decimals ?? DEFAULT_TOKEN_DECIMALS);
    const ma20 = computeMovingAverage(candles, MA20_PERIOD);
    const ma50 = computeMovingAverage(candles, MA50_PERIOD);

    // Gap-filling + axis fix (issue #451 items 1-2): the series itself is
    // fed this whitespace-inclusive timeline, never the sparse real-candle
    // list alone — that's what keeps a trade an hour old from sitting
    // directly beside one from seconds ago. MA/volume stay on real candles
    // only (`candles`, computed above), untouched.
    const points = buildChartSeriesPoints(candles, resolvedInterval, nowTick);

    const maxPrice = candles.length > 0 ? Math.max(...candles.map((candle) => candle.high)) : startingPriceNativePerToken;
    if (maxPrice !== null && maxPrice > 0) {
      const minMove = computeChartMinMove(maxPrice);
      if (minMove !== appliedMinMoveRef.current) {
        candleSeries.applyOptions({
          priceFormat: { type: "custom", minMove, formatter: (price: number) => formatNativePriceSixSigFigs(price) },
        });
        appliedMinMoveRef.current = minMove;
      }
    }

    // Staying on "ALL" while a newly arrived trade changes ALL's own
    // resolved fixed interval (issue #453 area 4) — e.g. enough new trades
    // arrive to push resolveAllTimeframeInterval from "5m" to "15m" — is a
    // real effective timeframe change, not a normal poll: diffing candles
    // bucketed at two different widths against each other would compare
    // incompatible bucket boundaries. `renderedTimeframeRef` alone can't
    // detect this since the UI-facing `timeframe` value ("all") never
    // changes, so the actually-rendered bucket width is tracked separately.
    const isFirstLoadOrTimeframeChange =
      !hasRenderedOnceRef.current || renderedTimeframeRef.current !== timeframe || renderedResolvedIntervalRef.current !== resolvedInterval;

    if (isFirstLoadOrTimeframeChange) {
      candleSeries.setData(points.map(pointToSeriesDatum));
      ma20Series.setData(ma20.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
      ma50Series.setData(ma50.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
      volumeSeries.setData(
        candles.map((candle) => ({ time: candle.time as UTCTimestamp, value: candle.volume, color: volumeBarColor(candle) })),
      );

      chartRef.current?.timeScale().scrollToRealTime();
    } else {
      const pointsDiff = diffChartSeriesPoints(renderedPointsRef.current, points);
      const candleDiff = diffCandles(renderedCandlesRef.current, candles);
      const ma20Diff = diffTimeSeries(renderedMa20Ref.current, ma20, (a, b) => a.value === b.value);
      const ma50Diff = diffTimeSeries(renderedMa50Ref.current, ma50, (a, b) => a.value === b.value);

      // The whitespace timeline's tail advances on its own clock (the
      // 30s nowTick above), independent of when a trade is actually
      // fetched. A trade whose block time falls in a bucket the tail has
      // already moved past — any trade near a bucket boundary that's
      // polled after that boundary passes — produces an "updated" point
      // that is no longer the chart's last rendered bar.
      // lightweight-charts' series.update() only accepts the last bar or a
      // genuinely newer one; anything older throws "Cannot update oldest
      // data", which would otherwise break this whole effect. A pre-check
      // routes the obvious case straight to a full resync, and a try/catch
      // around the incremental path itself catches anything that check
      // doesn't anticipate — both fall back the same way.
      const lastRenderedTime =
        renderedPointsRef.current.length > 0 ? renderedPointsRef.current[renderedPointsRef.current.length - 1].time : null;
      const hasOutOfOrderUpdate =
        lastRenderedTime !== null && pointsDiff.updated.some((point) => point.time < lastRenderedTime);

      let needsFullResync = hasOutOfOrderUpdate;
      if (!needsFullResync) {
        try {
          for (const point of [...pointsDiff.updated, ...pointsDiff.appended]) {
            candleSeries.update(pointToSeriesDatum(point));
          }
          for (const candle of [...candleDiff.updated, ...candleDiff.appended]) {
            volumeSeries.update({ time: candle.time as UTCTimestamp, value: candle.volume, color: volumeBarColor(candle) });
          }
          for (const point of [...ma20Diff.updated, ...ma20Diff.appended]) {
            ma20Series.update({ time: point.time as UTCTimestamp, value: point.value });
          }
          for (const point of [...ma50Diff.updated, ...ma50Diff.appended]) {
            ma50Series.update({ time: point.time as UTCTimestamp, value: point.value });
          }
        } catch {
          needsFullResync = true;
        }
      }

      if (needsFullResync) {
        // Only this fallback ever forces the visible range — reading it
        // right before setData and restoring it right after keeps the
        // chart from jumping, while leaving the "never force a range on a
        // normal update" rule (issue #449 item 2) untouched everywhere else.
        const visibleLogicalRange = chartRef.current?.timeScale().getVisibleLogicalRange() ?? null;
        candleSeries.setData(points.map(pointToSeriesDatum));
        ma20Series.setData(ma20.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
        ma50Series.setData(ma50.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
        volumeSeries.setData(
          candles.map((candle) => ({ time: candle.time as UTCTimestamp, value: candle.volume, color: volumeBarColor(candle) })),
        );
        if (visibleLogicalRange) {
          chartRef.current?.timeScale().setVisibleLogicalRange(visibleLogicalRange);
        }
      }
    }

    renderedPointsRef.current = points;
    renderedCandlesRef.current = candles;
    renderedMa20Ref.current = ma20;
    renderedMa50Ref.current = ma50;
    renderedTimeframeRef.current = timeframe;
    renderedResolvedIntervalRef.current = resolvedInterval;
    hasRenderedOnceRef.current = true;
  }, [trades, decimals, resolvedInterval, timeframe, nowTick, startingPriceNativePerToken]);

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

  const lastPrice =
    trades && trades.length > 0
      ? tradePriceNativePerToken(trades[0], decimals ?? DEFAULT_TOKEN_DECIMALS)
      : startingPriceNativePerToken;
  const lastPriceLabel = lastPrice !== null && lastPrice !== undefined ? `${formatNativePriceSixSigFigs(lastPrice)} ETH` : "—";

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
                <span>{formatUtcTime(hoverInfo.time)}</span>
                {hoverChangePercent !== null && (
                  <span className={hoverChangePercent >= 0 ? styles.priceChangeUp : styles.priceChangeDown}>
                    {formatSignedPercent(hoverChangePercent, 2)}
                  </span>
                )}
              </div>
              <div className={styles.chartTooltipRow}>
                <span>O</span>
                <span>{formatNativePriceSixSigFigs(hoverInfo.open)}</span>
              </div>
              <div className={styles.chartTooltipRow}>
                <span>H</span>
                <span>{formatNativePriceSixSigFigs(hoverInfo.high)}</span>
              </div>
              <div className={styles.chartTooltipRow}>
                <span>L</span>
                <span>{formatNativePriceSixSigFigs(hoverInfo.low)}</span>
              </div>
              <div className={styles.chartTooltipRow}>
                <span>C</span>
                <span>{formatNativePriceSixSigFigs(hoverInfo.close)}</span>
              </div>
              <div className={styles.chartTooltipRow}>
                <span>VOL</span>
                <span>{hoverInfo.volume.toFixed(1)} ETH</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
