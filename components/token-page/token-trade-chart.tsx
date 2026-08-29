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
  computeMovingAverage,
  diffCandles,
  diffTimeSeries,
  resolveChartInterval,
  tradePriceNativePerToken,
  type Candle,
  type ChartTimeframe,
  type MovingAveragePoint,
} from "@/lib/candle-bucketing";
import {
  addHorizontalLine,
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
 * very first load and on a timeframe change; every other update diffs the
 * freshly-rebucketed candles/MAs/volume against what's already rendered
 * (lib/candle-bucketing.ts's diffCandles/diffTimeSeries) and calls
 * `series.update()` for just the mutated last bar and any newly appended
 * ones — `update()` extends the series without touching the current visible
 * range, which is what keeps a scrolled-back user's view stable while still
 * following the latest bar for a viewer already at the right edge. Sizing is
 * driven by a manually guarded ResizeObserver instead of `autoSize: true`:
 * the deployed page's ~1s candle jump traced back to that option's own
 * observer re-firing on sub-pixel layout noise and feeding straight back
 * into another reflow — resizing only when the rounded pixel size actually
 * changes breaks that loop.
 *
 * Bar width (issue #449 item 2): the time scale's own `barSpacing`/
 * `minBarSpacing` are fixed constants, so pixel width per candle stays
 * constant regardless of chart width or candle count — no code path ever
 * calls `setVisibleLogicalRange` or `fitContent` to force a window (the
 * deployed bug: forcing a 120-bar window on a low-trade-count token spread
 * candles to ~3x the design's width). `scrollToRealTime()` after
 * `setData()` is what puts the latest bar at the right edge instead.
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
  const renderedCandlesRef = useRef<Candle[]>([]);
  const renderedMa20Ref = useRef<MovingAveragePoint[]>([]);
  const renderedMa50Ref = useRef<MovingAveragePoint[]>([]);
  const renderedTimeframeRef = useRef<ChartTimeframe | null>(null);
  const toolRef = useRef<ChartTool>(tool);
  const lastAppliedSizeRef = useRef<{ width: number; height: number } | null>(null);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

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
        setHoverInfo(null);
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
      renderedCandlesRef.current = [];
      renderedMa20Ref.current = [];
      renderedMa50Ref.current = [];
      renderedTimeframeRef.current = null;
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

    const isFirstLoadOrTimeframeChange =
      renderedCandlesRef.current.length === 0 || renderedTimeframeRef.current !== timeframe;

    if (isFirstLoadOrTimeframeChange) {
      candleSeries.setData(candles.map(candleToBar));
      ma20Series.setData(ma20.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
      ma50Series.setData(ma50.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
      volumeSeries.setData(
        candles.map((candle) => ({ time: candle.time as UTCTimestamp, value: candle.volume, color: volumeBarColor(candle) })),
      );

      chartRef.current?.timeScale().scrollToRealTime();
    } else {
      const candleDiff = diffCandles(renderedCandlesRef.current, candles);
      for (const candle of [...candleDiff.updated, ...candleDiff.appended]) {
        candleSeries.update(candleToBar(candle));
        volumeSeries.update({ time: candle.time as UTCTimestamp, value: candle.volume, color: volumeBarColor(candle) });
      }

      const ma20Diff = diffTimeSeries(renderedMa20Ref.current, ma20, (a, b) => a.value === b.value);
      for (const point of [...ma20Diff.updated, ...ma20Diff.appended]) {
        ma20Series.update({ time: point.time as UTCTimestamp, value: point.value });
      }

      const ma50Diff = diffTimeSeries(renderedMa50Ref.current, ma50, (a, b) => a.value === b.value);
      for (const point of [...ma50Diff.updated, ...ma50Diff.appended]) {
        ma50Series.update({ time: point.time as UTCTimestamp, value: point.value });
      }
    }

    renderedCandlesRef.current = candles;
    renderedMa20Ref.current = ma20;
    renderedMa50Ref.current = ma50;
    renderedTimeframeRef.current = timeframe;
  }, [trades, decimals, resolvedInterval, timeframe]);

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
          {horizontalLines.map((line) => (
            <button
              key={line.id}
              type="button"
              className={styles.chartLineChip}
              onClick={() => setHorizontalLines((current) => removeHorizontalLine(current, line.id))}
              title="Remove this line"
              data-token-chart-remove-line={line.id}
            >
              {formatNativePriceSixSigFigs(line.price)} ×
            </button>
          ))}
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
