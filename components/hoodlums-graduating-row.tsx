/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import type { GraduatingFeedResult, GraduatingToken } from "@/lib/server/pumpfun-graduating";
import { GRADUATING_PANEL_COUNT } from "@/lib/token-grid-card-model";
import styles from "./hoodlums-graduating-row.module.css";

// 5 minutes (up from 30s, issue #305), matching the server-side cache TTL
// in lib/server/pumpfun-graduating.ts so the panel never polls faster than
// fresh data can actually arrive. The 30s+30s combo spent ~2,900 Bitquery
// queries/day and exhausted the free-tier point allowance in under a day;
// a "graduating now" board doesn't need sub-minute freshness, so 5 minutes
// reads identically live to a visitor while cutting usage ~10x. Do NOT
// lower further — each server refresh this triggers spends Bitquery API points
// on the free plan.
const POLL_INTERVAL_MS = 300_000;
const MIN_GRADUATING_TOKENS = 2;
// A hanging image never fires onError (seen live with an ipfs.io gateway
// URL, issue #297) — this bounds how long a card waits before giving up
// and swapping to the letter tile.
const ARTWORK_LOAD_TIMEOUT_MS = 5_000;

function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

// At the 5-minute poll cadence, "updated 240s ago" reads worse than
// "updated 4m ago" — switch to whole minutes once a minute has passed.
function formatUpdatedAgo(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function GraduatingCard({ token, rank }: { token: GraduatingToken; rank: number }) {
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
  const progress = clampPercent(token.progressPercent);

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
        <span className={styles.rank}>#{rank}</span>
        <span className={styles.progressBadge}>{Math.round(progress)}%</span>
      </div>
      <div className={styles.nameRow}>
        <b className={styles.cardName}>{token.name}</b>
        <span className={styles.source}>pump.fun ↗</span>
      </div>
      <span className={styles.cardTicker}>${token.ticker}</span>
      <div className={styles.gradRow}>
        <span>Graduation</span>
        <b>{Math.round(progress)}%</b>
      </div>
      <div className={styles.gradBar}>
        <span style={{ width: `${progress}%` }} />
      </div>
    </a>
  );
}

/**
 * The bottom row of the homepage (owner direction, 4 Sep 2026 round 2):
 * third-party pump.fun tokens racing toward graduation, one row of
 * GRADUATING_PANEL_COUNT cards in the same shape and six column tracks as
 * the Hoodlums grid above (issue #295 first put this feed here as a
 * swipeable, paged row; the paging is gone now that the row is exactly one
 * screen wide). The section always renders so the page keeps its shape:
 * with fewer than two tokens, or a feed error, it shows an honest notice
 * instead of hiding, since this feed's data source (Bitquery today, a
 * replacement decided by the owner next) can and does run dry.
 */
export function HoodlumsGraduatingRow() {
  const [tokens, setTokens] = useState<GraduatingToken[]>([]);
  const [eligible, setEligible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [updatedSecondsAgo, setUpdatedSecondsAgo] = useState(0);

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
      } finally {
        if (!cancelled) setLoaded(true);
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

  const visibleTokens = tokens.slice(0, GRADUATING_PANEL_COUNT);

  return (
    <section className={styles.section} aria-labelledby="graduating-now-title">
      <div className={styles.sectionHeader}>
        <p id="graduating-now-title" className={styles.eyebrow}>
          <span className={styles.liveDot} aria-hidden="true" />
          GRADUATING NOW · LIVE FROM PUMP.FUN
        </p>
        <p className={styles.caption}>
          live from pump.fun — Hoodlums graduations join this race at mainnet
          {updatedAt !== null ? (
            <span className={styles.updatedHint}> · updated {formatUpdatedAgo(updatedSecondsAgo)}</span>
          ) : null}
        </p>
      </div>

      {eligible ? (
        <div className={styles.track}>
          {visibleTokens.map((token, index) => (
            <GraduatingCard key={token.address} token={token} rank={index + 1} />
          ))}
        </div>
      ) : (
        <div className={styles.notice}>
          <p>{loaded ? "Graduating feed unavailable right now — it comes back on its own once the source is reachable." : "Loading graduating tokens…"}</p>
        </div>
      )}
    </section>
  );
}
