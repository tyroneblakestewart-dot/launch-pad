"use client";

import { formatPriceChange, formatTimeAgoSeconds } from "@/lib/token-page-format";
import { buildSparkline, sparklineColor, SPARKLINE_HEIGHT, SPARKLINE_WIDTH } from "@/lib/token-sparkline";
import { useGridTokenTrades } from "@/lib/use-grid-token-trades";
import { useInView } from "@/lib/use-in-view";
import styles from "./hoodlums-token-grid.module.css";

/**
 * Live mini price chart for a homepage token grid card (issue #436),
 * pump.fun-style: a minimal SVG sparkline drawn from the token's real trades
 * (GET /api/token-trades — see lib/use-grid-token-trades.ts, the only
 * trade-reading path), expanding into a bigger preview on hover/focus. The
 * expansion is pure CSS (:hover/:focus-within in
 * hoodlums-token-grid.module.css, gated to `(hover: hover) and
 * (pointer: fine)` for the hover half so touch devices only ever see the
 * mini chart) rather than React state, so it can never intercept the card
 * anchor's own click-through navigation and never shifts the surrounding
 * grid — the expanded overlay is `position: absolute; inset: 0` within the
 * card, not a layout participant. Both the mini and expanded views render
 * the same pure `buildSparkline` output at different sizes, so there is only
 * ever one shape of "no data yet" (a flat baseline, not an error box).
 */
export function TokenGridCardChart({
  tokenName,
  curveAddress,
  artworkThumbnail,
}: {
  tokenName: string;
  curveAddress: string;
  artworkThumbnail?: string | null;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const { trades } = useGridTokenTrades(curveAddress, inView);
  const sparkline = buildSparkline(trades ?? []);
  const color = sparklineColor(sparkline.trend);
  const change = formatPriceChange(sparkline.changePercent);
  const sinceLabel = sparkline.firstTimestamp !== null ? formatTimeAgoSeconds(sparkline.firstTimestamp) : null;
  const letter = tokenName.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <>
      <div ref={ref} className={styles.art} data-token-grid-chart="true">
        {artworkThumbnail ? (
          <img className={styles.artImage} src={artworkThumbnail} alt="" />
        ) : (
          <span className={styles.artInitial}>{letter}</span>
        )}
        <svg
          className={styles.sparklineMini}
          viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={sparkline.areaPath} fill={color} fillOpacity={0.2} stroke="none" />
          <path d={sparkline.linePath} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className={styles.sparklineExpanded} aria-hidden="true">
        <svg
          className={styles.sparklineExpandedSvg}
          viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
          preserveAspectRatio="none"
        >
          <path d={sparkline.areaPath} fill={color} fillOpacity={0.22} stroke="none" />
          <path d={sparkline.linePath} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className={styles.sparklineExpandedMeta}>
          {sparkline.hasData ? (
            <span className={sparkline.trend === "down" ? styles.sparklineDown : styles.sparklineUp}>
              {change?.label ?? "—"}
            </span>
          ) : (
            <span>No trades yet</span>
          )}
          {sinceLabel && <span>{sinceLabel} span</span>}
        </div>
      </div>
    </>
  );
}
