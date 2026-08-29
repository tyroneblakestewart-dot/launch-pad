"use client";

import { useEffect, useRef } from "react";
import { formatNativeAmount, formatPriceChange, formatTimeAgoSeconds } from "@/lib/token-page-format";
import { buildCandleGeometry, CANDLE_CHART_HEIGHT, CANDLE_CHART_WIDTH } from "@/lib/token-candle-geometry";
import { buildSparkline } from "@/lib/token-sparkline";
import { computePreviewPosition, PREVIEW_HEIGHT, PREVIEW_WIDTH } from "@/lib/token-grid-preview-position";
import { useGridTokenTrades } from "@/lib/use-grid-token-trades";
import { useInView } from "@/lib/use-in-view";
import styles from "./hoodlums-token-grid.module.css";

/**
 * Live mini candle chart + floating hover preview for a homepage token grid
 * card (issue #440, redesigning issue #436's line sparkline), drawn from the
 * token's real trades (GET /api/token-trades — see
 * lib/use-grid-token-trades.ts, the only trade-reading path). The mini
 * candles are inline SVG bars built by the pure lib/token-candle-geometry.ts
 * (never a lightweight-charts instance per card — 24 chart instances on one
 * page is not acceptable) drawn once and reused for both the small in-art
 * chart and the bigger floating preview, exactly like issue #436's single
 * shared buildSparkline call.
 *
 * The floating preview's show/hide is still pure CSS (:hover/:focus-within in
 * hoodlums-token-grid.module.css, gated to `(hover: hover) and (pointer:
 * fine)` for the hover half so touch devices only ever see the mini chart),
 * so it can never intercept the card anchor's own click-through navigation.
 * Its *position*, though, can't be pure CSS: the panel must stay inside the
 * viewport for cards on the grid's left/right edges and last row, which needs
 * the anchor's real on-screen rect. A small effect measures the enclosing
 * `<a class="card">` (found via `.closest("a")` rather than a prop, since the
 * anchor is rendered by hoodlums-token-grid.tsx, not this component) on
 * mouseenter/focusin and writes the result as CSS custom properties the
 * panel's `left`/`top` reference — never React state, so a hover never
 * triggers a re-render of the whole card.
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
  const previewRef = useRef<HTMLDivElement>(null);
  const { trades } = useGridTokenTrades(curveAddress, inView);
  const sparkline = buildSparkline(trades ?? []);
  const candles = buildCandleGeometry(trades ?? []);
  const color = sparkline.trend === "down" ? styles.sparklineDown : styles.sparklineUp;
  const change = formatPriceChange(sparkline.changePercent);
  const sinceLabel = sparkline.firstTimestamp !== null ? formatTimeAgoSeconds(sparkline.firstTimestamp) : null;
  const letter = tokenName.trim().slice(0, 1).toUpperCase() || "?";

  useEffect(() => {
    const artNode = ref.current;
    const preview = previewRef.current;
    const anchor = artNode?.closest("a");
    if (!anchor || !preview) return;

    function updatePosition() {
      if (!anchor || !preview || typeof window === "undefined") return;
      const anchorRect = anchor.getBoundingClientRect();
      const position = computePreviewPosition({
        anchorLeft: anchorRect.left,
        anchorTop: anchorRect.top,
        anchorWidth: anchorRect.width,
        anchorHeight: anchorRect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        previewWidth: PREVIEW_WIDTH,
        previewHeight: PREVIEW_HEIGHT,
      });
      preview.style.setProperty("--preview-left", `${position.left}px`);
      preview.style.setProperty("--preview-top", `${position.top}px`);
    }

    function handleEnter() {
      updatePosition();
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
    }

    function handleLeave() {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    }

    anchor.addEventListener("mouseenter", handleEnter);
    anchor.addEventListener("focusin", handleEnter);
    anchor.addEventListener("mouseleave", handleLeave);
    anchor.addEventListener("focusout", handleLeave);

    return () => {
      anchor.removeEventListener("mouseenter", handleEnter);
      anchor.removeEventListener("focusin", handleEnter);
      anchor.removeEventListener("mouseleave", handleLeave);
      anchor.removeEventListener("focusout", handleLeave);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [ref]);

  return (
    <>
      <div ref={ref} className={styles.art} data-token-grid-chart="true">
        {artworkThumbnail ? (
          <img className={styles.artImage} src={artworkThumbnail} alt="" />
        ) : (
          <span className={styles.artInitial}>{letter}</span>
        )}
        {candles.hasData && (
          <div className={styles.candleOverlay} aria-hidden="true">
            <svg
              className={styles.candleSvg}
              viewBox={`0 0 ${CANDLE_CHART_WIDTH} ${CANDLE_CHART_HEIGHT}`}
              preserveAspectRatio="none"
            >
              {candles.bars.map((bar, index) => (
                <g key={index}>
                  <line
                    x1={bar.wickX}
                    x2={bar.wickX}
                    y1={bar.wickTop}
                    y2={bar.wickBottom}
                    stroke={bar.color}
                    strokeWidth={0.6}
                    vectorEffect="non-scaling-stroke"
                  />
                  <rect x={bar.x} y={bar.bodyTop} width={bar.bodyWidth} height={bar.bodyHeight} fill={bar.color} />
                </g>
              ))}
            </svg>
          </div>
        )}
      </div>
      <div ref={previewRef} className={styles.preview} aria-hidden="true">
        <svg
          className={styles.previewChart}
          viewBox={`0 0 ${CANDLE_CHART_WIDTH} ${CANDLE_CHART_HEIGHT}`}
          preserveAspectRatio="none"
        >
          {candles.bars.map((bar, index) => (
            <g key={index}>
              <line
                x1={bar.wickX}
                x2={bar.wickX}
                y1={bar.wickTop}
                y2={bar.wickBottom}
                stroke={bar.color}
                strokeWidth={0.6}
                vectorEffect="non-scaling-stroke"
              />
              <rect x={bar.x} y={bar.bodyTop} width={bar.bodyWidth} height={bar.bodyHeight} fill={bar.color} />
            </g>
          ))}
        </svg>
        <div className={styles.previewMeta}>
          <span className={styles.previewPrice}>{formatNativeAmount(candles.lastPrice)}</span>
          {sparkline.hasData ? <span className={color}>{change?.label ?? "—"}</span> : <span>No trades yet</span>}
          {sinceLabel && <span>{sinceLabel} span</span>}
        </div>
      </div>
    </>
  );
}
