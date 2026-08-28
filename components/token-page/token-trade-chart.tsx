"use client";

import { useEffect, useRef, useState } from "react";
import { CrosshairMode, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { CANDLE_INTERVALS, bucketTradesIntoCandles, type CandleInterval } from "@/lib/candle-bucketing";
import { DEFAULT_TOKEN_DECIMALS } from "@/lib/bonding-curve-deploy-config";
import type { TokenTrade } from "@/lib/token-trade-types";
import styles from "./token-page.module.css";

const INTERVAL_LABELS: Record<CandleInterval, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h" };

/**
 * Live candlestick chart for the token page (issue #430), built on
 * TradingView's lightweight-charts (pinned 4.1.3). The chart itself always
 * mounts on render, independent of `trades` — the owner's explicit
 * requirement is axes + gridlines even at zero trades, never a placeholder
 * box — with only a text overlay layered on top for the empty/error states.
 * Candle bucketing (lib/candle-bucketing.ts) is pure and re-runs whenever
 * `trades`, `decimals` or the interval selector changes; the chart/series
 * instances themselves are created once and torn down on unmount via
 * `chart.remove()`, matching this repo's general cleanup-on-unmount
 * discipline for third-party mounted instances (CLAUDE.md rule 7's iframe
 * rule, applied here to a canvas-based library instead).
 */
export function TokenTradeChart({
  trades,
  decimals,
  error,
}: {
  trades: TokenTrade[] | null;
  decimals: number | null;
  error: string | null;
}) {
  const [interval, setInterval_] = useState<CandleInterval>("5m");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: "#929693",
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.05)" },
        horzLines: { color: "rgba(255, 255, 255, 0.05)" },
      },
      rightPriceScale: { borderColor: "rgba(255, 255, 255, 0.09)" },
      timeScale: { borderColor: "rgba(255, 255, 255, 0.09)", timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#91f0b6",
      downColor: "#ff5f56",
      borderVisible: false,
      wickUpColor: "#91f0b6",
      wickDownColor: "#ff5f56",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || trades === null) return;
    const candles = bucketTradesIntoCandles(trades, interval, decimals ?? DEFAULT_TOKEN_DECIMALS);
    series.setData(candles.map((candle) => ({ ...candle, time: candle.time as UTCTimestamp })));
    chartRef.current?.timeScale().fitContent();
  }, [trades, decimals, interval]);

  const showEmptyOverlay = !error && trades !== null && trades.length === 0;

  return (
    <>
      <div className={styles.chartHeader}>
        <span className={styles.chartPlaceholderLabel}>Live chart</span>
        <div className={styles.chartIntervalGroup} role="group" aria-label="Candle interval">
          {CANDLE_INTERVALS.map((value) => (
            <button
              key={value}
              type="button"
              className={`${styles.chartIntervalButton} ${interval === value ? styles.chartIntervalButtonActive : ""}`}
              onClick={() => setInterval_(value)}
            >
              {INTERVAL_LABELS[value]}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.chartCanvasWrap}>
        <div ref={containerRef} className={styles.chartCanvas} data-token-chart-canvas="true" />
        {showEmptyOverlay && (
          <div className={styles.chartEmptyOverlay} data-token-chart-empty="true">
            <p className={styles.chartEmptyCopy}>No trades yet — the chart fills in as this token trades.</p>
          </div>
        )}
        {error && (
          <div className={styles.chartEmptyOverlay} data-token-chart-error="true">
            <p className={styles.chartEmptyCopy}>{error}</p>
          </div>
        )}
      </div>
    </>
  );
}
