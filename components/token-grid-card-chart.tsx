"use client";

import { useEffect, useRef, useState } from "react";
import { buildGridCandleChart, GRID_CANDLE_CHART_HEIGHT, GRID_CANDLE_CHART_WIDTH } from "@/lib/token-grid-candle-chart";
import {
  buildGridChangePill,
  computeGridMarketCapNative,
  formatGridAge,
  formatGridMarketCap,
} from "@/lib/token-grid-card-model";
import { useGridTokenTrades } from "@/lib/use-grid-token-trades";
import { useInView } from "@/lib/use-in-view";
import styles from "./hoodlums-token-grid.module.css";

/**
 * The body of one homepage token card (owner direction, 4 Sep 2026: the
 * pump.fun card shape; revised 7 Sep 2026: thin/slim 5-minute candlesticks
 * with a lime/grey glow, replacing the single performance line). The
 * recorded artwork fills the square art region edge to edge, and the
 * token's real trade history — built by the pure
 * lib/token-grid-candle-chart.ts from GET /api/token-trades via
 * lib/use-grid-token-trades.ts, the only trade-reading path — is drawn over
 * its lower half as inline SVG bars: lime when a candle closes up, the
 * design's grey when it closes down, each with a soft drop-shadow glow so
 * it stays legible over any artwork, and a brief grow-in the first time
 * data arrives. The chart layer grows a little on hover/focus (never a
 * floating preview, never a chart-library instance per card — a dozen-plus
 * on one page stays unacceptable) — the numbers a viewer wants (market cap,
 * change since launch, age) live on the card itself and update in place on
 * every poll; the market cap figure remounts whenever its value CHANGES
 * after first paint (never on the initial render, so a page load is calm)
 * and its highlight flash marks the live move, exactly the reaction
 * pump.fun's cards give. A token with no trades yet shows its art alone (no
 * flat line, no empty box) with an em-dash market cap: nothing on this card
 * is ever invented.
 */
export function TokenGridCardChart({
  tokenName,
  ticker,
  curveAddress,
  artworkThumbnail,
  wholeTokenSupply,
  launchedAt,
  graduated,
  progressLabel,
  progressWidthPercent,
}: {
  tokenName: string;
  ticker: string;
  curveAddress: string;
  artworkThumbnail?: string | null;
  wholeTokenSupply: string;
  launchedAt: string | null;
  graduated: boolean;
  progressLabel: string;
  progressWidthPercent: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const { trades } = useGridTokenTrades(curveAddress, inView);
  const chart = buildGridCandleChart(trades ?? []);
  const pill = buildGridChangePill(chart.changePercent);
  const marketCap = formatGridMarketCap(computeGridMarketCapNative(chart.lastPrice, wholeTokenSupply));
  const letter = tokenName.trim().slice(0, 1).toUpperCase() || "?";
  const flashKey = useMarketCapFlash(marketCap);

  return (
    <>
      <div ref={ref} className={styles.art} data-token-grid-chart="true">
        {artworkThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.artImage} src={artworkThumbnail} alt="" />
        ) : (
          <span className={styles.artInitial}>{letter}</span>
        )}
        {chart.hasData && (
          <div className={styles.candleOverlay} aria-hidden="true">
            <svg
              className={styles.candleSvg}
              viewBox={`0 0 ${GRID_CANDLE_CHART_WIDTH} ${GRID_CANDLE_CHART_HEIGHT}`}
              preserveAspectRatio="none"
            >
              {chart.bars.map((bar, index) => (
                <g
                  key={index}
                  className={bar.tone === "up" ? styles.candleUp : styles.candleDown}
                  style={{ animationDelay: `${Math.min(index * 20, 300)}ms` }}
                >
                  <line
                    x1={bar.wickX}
                    x2={bar.wickX}
                    y1={bar.wickTop}
                    y2={bar.wickBottom}
                    className={styles.candleWick}
                    vectorEffect="non-scaling-stroke"
                  />
                  <rect
                    x={bar.x}
                    y={bar.bodyTop}
                    width={bar.bodyWidth}
                    height={bar.bodyHeight}
                    className={styles.candleBody}
                  />
                </g>
              ))}
            </svg>
          </div>
        )}
      </div>

      <div className={styles.nameRow}>
        <b className={styles.cardName}>{tokenName}</b>
        {pill && (
          <span
            className={`${styles.changePill} ${
              pill.direction === "down" ? styles.changeDown : pill.direction === "up" ? styles.changeUp : styles.changeFlat
            }`}
          >
            {pill.label}
          </span>
        )}
      </div>
      <div className={styles.tickerRow}>
        <span className={styles.cardTicker}>${ticker}</span>
        <span className={styles.age}>{formatGridAge(launchedAt)}</span>
      </div>
      <div className={styles.capRow}>
        <b key={flashKey} className={flashKey > 0 ? `${styles.cardCap} ${styles.cardCapFlash}` : styles.cardCap}>
          {marketCap}
        </b>
        <span className={styles.cardCapLabel}>MCAP</span>
      </div>
      <div className={styles.gradRow}>
        <span>{graduated ? "Graduated" : "Graduation"}</span>
        <b>{progressLabel}</b>
      </div>
      <div className={styles.gradBar}>
        <span style={{ width: `${progressWidthPercent}%` }} />
      </div>
    </>
  );
}

/**
 * Counts genuine market-cap changes after the first render. The count is
 * used as the figure's React key, so each live move remounts the element and
 * replays its CSS flash; the initial value (and a null-to-null poll) never
 * flashes.
 */
function useMarketCapFlash(marketCap: string): number {
  const previous = useRef<string | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (previous.current !== null && previous.current !== marketCap) {
      setFlashKey((key) => key + 1);
    }
    previous.current = marketCap;
  }, [marketCap]);
  return flashKey;
}
