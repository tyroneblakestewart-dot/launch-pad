/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent } from "react";
import type { GraduatingFeedResult, GraduatingToken } from "@/lib/server/pumpfun-graduating";
import { clampShowcaseIndex, swipeDeltaToStep } from "@/lib/social-showcase";
import styles from "./hoodlums-graduating-row.module.css";

// 30s (down from 60s, issue #297), matching the server-side cache TTL in
// lib/server/pumpfun-graduating.ts so the panel never polls faster than
// fresh data can actually arrive. Do NOT lower further — each server
// refresh this triggers spends Bitquery API points on the free plan.
const POLL_INTERVAL_MS = 30_000;
const MIN_GRADUATING_TOKENS = 2;
const TOKENS_PER_PAGE = 4;
// A hanging image never fires onError (seen live with an ipfs.io gateway
// URL, issue #297) — this bounds how long a card waits before giving up
// and swapping to the letter tile.
const ARTWORK_LOAD_TIMEOUT_MS = 5_000;

function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function GraduatingCard({ token }: { token: GraduatingToken }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">(
    token.artworkUrl ? "loading" : "failed",
  );
  // Resets `status` when the card is reused for a different artworkUrl
  // (same token address, refreshed feed row) — adjusted during render per
  // https://react.dev/learn/you-might-not-need-an-effect, so it doesn't
  // trigger the extra render + setState-in-effect cascade a useEffect reset
  // would.
  const [trackedArtworkUrl, setTrackedArtworkUrl] = useState(token.artworkUrl);
  if (token.artworkUrl !== trackedArtworkUrl) {
    setTrackedArtworkUrl(token.artworkUrl);
    setStatus(token.artworkUrl ? "loading" : "failed");
  }

  useEffect(() => {
    if (status !== "loading") return;
    const timeout = window.setTimeout(() => {
      setStatus((prev) => (prev === "loading" ? "failed" : prev));
    }, ARTWORK_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [status]);

  const showImage = status !== "failed" && Boolean(token.artworkUrl);

  return (
    <a href={token.url} target="_blank" rel="noreferrer" className={styles.card}>
      <div className={styles.art}>
        <span>{initial(token.name)}</span>
        {showImage ? (
          <img
            src={token.artworkUrl}
            alt=""
            className={status === "loaded" ? styles.artImageLoaded : styles.artImageLoading}
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("failed")}
          />
        ) : null}
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
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [updatedSecondsAgo, setUpdatedSecondsAgo] = useState(0);
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
        setUpdatedAt(Date.now());
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

  // Ticks the "updated Xs ago" hint once a second rather than re-deriving it
  // inline at render time, so it advances between polls instead of only
  // jumping when a new feed result lands.
  useEffect(() => {
    if (updatedAt === null) return;
    const tick = () => setUpdatedSecondsAgo(Math.max(0, Math.round((Date.now() - updatedAt) / 1000)));
    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [updatedAt]);

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

      <p className={styles.caption}>
        live from pump.fun — Hoodlums graduations join this race at mainnet
        {updatedAt !== null ? (
          <span className={styles.updatedHint}> · updated {updatedSecondsAgo}s ago</span>
        ) : null}
      </p>
    </section>
  );
}
