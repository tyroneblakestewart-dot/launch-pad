"use client";

import { useEffect, useRef, useState } from "react";
import { buildSparkline, SPARKLINE_HEIGHT, SPARKLINE_WIDTH } from "@/lib/token-sparkline";
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
 * pump.fun card shape). The recorded artwork fills the square art region
 * edge to edge, and the token's real performance line — built by the pure
 * lib/token-sparkline.ts from GET /api/token-trades via
 * lib/use-grid-token-trades.ts, the only trade-reading path — is drawn over
 * its lower half as inline SVG: lime when up, the design's grey when down,
 * with a soft area fill and a short draw-in each time the line changes.
 * Never a chart-library instance per card (twelve on one page is not
 * acceptable), never candles, and never a floating hover preview — the
 * numbers a viewer wants (market cap, change since launch, age) live on the
 * card itself and update in place on every poll; the market cap figure
 * remounts whenever its value CHANGES after first paint (never on the
 * initial render, so a page load is calm) and its highlight flash marks the
 * live move, exactly the reaction pump.fun's cards give. A token with no trades yet shows its art
 * alone (no flat line, no empty box) with an em-dash market cap: nothing on
 * this card is ever invented.
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
  const sparkline = buildSparkline(trades ?? [], { paddingY: 4 });
  const tone = sparkline.trend === "down" ? styles.sparklineDown : styles.sparklineUp;
  const pill = buildGridChangePill(sparkline.changePercent);
  const marketCap = formatGridMarketCap(computeGridMarketCapNative(sparkline.lastPrice, wholeTokenSupply));
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
        {sparkline.hasData && (
          <div className={`${styles.sparkOverlay} ${tone}`} aria-hidden="true">
            <svg
              className={styles.sparkSvg}
              viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
              preserveAspectRatio="none"
            >
              <path className={styles.sparkArea} d={sparkline.areaPath} />
              <path
                key={sparkline.linePath}
                className={styles.sparkLine}
                d={sparkline.linePath}
                pathLength={100}
                vectorEffect="non-scaling-stroke"
              />
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
