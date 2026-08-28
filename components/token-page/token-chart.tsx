"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { bucketTradesIntoCandles, type CandleInterval } from "@/lib/candle-bucketing";
import type { TokenTradeItem } from "@/lib/token-trade-view";
import styles from "./token-page.module.css";

const CHART_HEIGHT_PX = 280;

const INTERVAL_OPTIONS: { id: CandleInterval; label: string }[] = [
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1h" },
];

/**
 * Live candlestick chart for the token page (issue #430), built on
 * TradingView's open-source lightweight-charts. `createChart` and
 * `addCandlestickSeries` always run on mount, independent of whether any
 * trades exist yet — the owner's explicit requirement is that the chart
 * renders with its axes at all times, and an empty-state overlay layers on
 * top only when there's nothing to plot, never a placeholder box in its
 * place. `trades` is `null` while the first load is still in flight (no
 * overlay is shown yet in that case — an empty candle set reads the same
 * as "loading" until the caller's own empty-state copy distinguishes them
 * elsewhere, e.g. the Recent trades tab).
 */
export function TokenChart({ trades }: { trades: TokenTradeItem[] | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [activeInterval, setActiveInterval] = useState<CandleInterval>("5m");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: { background: { color: "transparent" }, textColor: "#9aa0a6" },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.12)" },
      timeScale: { borderColor: "rgba(255,255,255,0.12)" },
      width: container.clientWidth,
      height: CHART_HEIGHT_PX,
    });
    const series = chart.addCandlestickSeries({
      upColor: "#c6f53e",
      downColor: "#ff5c5c",
      borderVisible: false,
      wickUpColor: "#c6f53e",
      wickDownColor: "#ff5c5c",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    function handleResize() {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    }
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  const candles = useMemo(() => bucketTradesIntoCandles(trades ?? [], activeInterval), [trades, activeInterval]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(candles.map((candle) => ({ ...candle, time: candle.time as UTCTimestamp })));
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  const isEmpty = candles.length === 0;

  return (
    <div className={styles.chartPanel} data-token-chart="true">
      <div className={styles.chartToolbar}>
        {INTERVAL_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`${styles.chartIntervalButton} ${activeInterval === option.id ? styles.chartIntervalButtonActive : ""}`}
            onClick={() => setActiveInterval(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className={styles.chartCanvasWrap}>
        <div ref={containerRef} className={styles.chartCanvas} data-token-chart-canvas="true" />
        {isEmpty ? (
          <div className={styles.chartEmptyOverlay} data-token-chart-empty="true">
            <span>No trades yet — the chart will populate once trading starts.</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
