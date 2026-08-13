/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent } from "react";
import type { GraduatingFeedResult, GraduatingToken } from "@/lib/server/pumpfun-graduating";
import { clampShowcaseIndex, swipeDeltaToStep } from "@/lib/social-showcase";
import styles from "./hoodlums-graduating-row.module.css";

const POLL_INTERVAL_MS = 60_000;
const MIN_GRADUATING_TOKENS = 2;
const TOKENS_PER_PAGE = 4;

function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function GraduatingCard({ token }: { token: GraduatingToken }) {
  const [artworkFailed, setArtworkFailed] = useState(false);
  const showArt = Boolean(token.artworkUrl) && !artworkFailed;

  return (
    <a href={token.url} target="_blank" rel="noreferrer" className={styles.card}>
      <div className={styles.art}>
        {showArt ? (
          <img src={token.artworkUrl} alt="" onError={() => setArtworkFailed(true)} />
        ) : (
          <span>{initial(token.name)}</span>
        )}
      </div>
      <b className={styles.cardName}>{token.name}</b>
      <span className={styles.cardTicker}>${token.ticker}</span>
      <div className={styles.gradRow}>
        <span>Graduation</span>
        <b>{Math.round(Math.min(100, Math.max(0, token.progressPercent)))}%</b>
      </div>
      <div className={styles.gradBar}>
        <span style={{ width: `${Math.min(100, Math.max(0, token.progressPercent))}%` }} />
      </div>
    </a>
  );
}

/**
 * Full-width row of pump.fun tokens racing toward graduation, placed below
 * the HOODLUMS TOKENS grid (issue #295) rather than tucked into the narrow
 * trending sidebar. Same eligibility contract as before: hides itself
 * unless the feed returns at least two tokens with no error.
 */
export function HoodlumsGraduatingRow() {
  const [tokens, setTokens] = useState<GraduatingToken[]>([]);
  const [eligible, setEligible] = useState(false);
  const [page, setPage] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const dragStartX = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/trending-robinhood?feed=graduating", { cache: "no-store" });
        const result = (await response.json()) as GraduatingFeedResult;
        if (cancelled) return;
        const isEligible = !result.error && result.tokens.length >= MIN_GRADUATING_TOKENS;
        setTokens(isEligible ? result.tokens : []);
        setEligible(isEligible);
      } catch {
        if (!cancelled) {
          setTokens([]);
          setEligible(false);
        }
      }
    }

    load();
    const interval = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const pageCount = Math.max(1, Math.ceil(tokens.length / TOKENS_PER_PAGE));
  // Clamped at render time rather than mirrored into state: `page` can go
  // stale for one tick after the feed reloads with fewer pages, and this
  // avoids a setState-in-effect cascade for it.
  const currentPage = clampShowcaseIndex(page, pageCount);

  function goToPage(index: number) {
    setPage(clampShowcaseIndex(index, pageCount));
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null) return;
    const endX = event.changedTouches[0]?.clientX ?? startX;
    const step = swipeDeltaToStep(endX - startX);
    if (step !== 0) goToPage(currentPage + step);
  }

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    dragStartX.current = event.clientX;
  }

  function handleMouseUp(event: ReactMouseEvent<HTMLDivElement>) {
    const startX = dragStartX.current;
    dragStartX.current = null;
    if (startX === null) return;
    const step = swipeDeltaToStep(event.clientX - startX);
    if (step !== 0) goToPage(currentPage + step);
  }

  if (!eligible) return null;

  const visibleTokens = tokens.slice(
    currentPage * TOKENS_PER_PAGE,
    currentPage * TOKENS_PER_PAGE + TOKENS_PER_PAGE,
  );

  return (
    <section className={styles.section} aria-labelledby="graduating-now-title">
      <div className={styles.sectionHeader}>
        <p id="graduating-now-title" className={styles.eyebrow}>
          GRADUATING NOW · LIVE FROM PUMP.FUN
        </p>
      </div>

      <div
        className={styles.track}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        {visibleTokens.map((token) => (
          <GraduatingCard key={token.address} token={token} />
        ))}
      </div>

      {pageCount > 1 ? (
        <div className={styles.dots} role="tablist" aria-label="Graduating now pages">
          {Array.from({ length: pageCount }, (_, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === currentPage}
              aria-label={`Show page ${index + 1}`}
              className={index === currentPage ? styles.dotActive : styles.dot}
              onClick={() => goToPage(index)}
            />
          ))}
        </div>
      ) : null}

      <p className={styles.caption}>live from pump.fun — Hoodlums graduations join this race at mainnet</p>
    </section>
  );
}
