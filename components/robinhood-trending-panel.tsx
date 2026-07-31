"use client";

import { useEffect, useState } from "react";
import type { TrendingFeedResult, TrendingToken } from "@/lib/server/robinhood-trending";
import styles from "./robinhood-trending-panel.module.css";

const POLL_INTERVAL_MS = 60_000;

function formatMarketCap(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return value > 0 ? `$${value.toFixed(0)}` : "—";
}

function formatChange(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

export function RobinhoodTrendingPanel() {
  const [tokens, setTokens] = useState<TrendingToken[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/trending-robinhood", { cache: "no-store" });
        const result = (await response.json()) as TrendingFeedResult;
        if (cancelled) return;
        setTokens(result.tokens);
        setUnavailable(Boolean(result.error));
      } catch {
        if (!cancelled) setUnavailable(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <aside className={styles.panel} aria-label="Robinhood Chain trending tokens">
      <div className={styles.header}>
        <div>
          <b>TRENDING NOW</b>
          <span className={styles.pulseRow}>
            <span className={styles.dot} /> Robinhood Chain
          </span>
        </div>
        <span className={styles.window}>5-min window · via GMGN</span>
      </div>

      <div className={styles.feed}>
        {unavailable ? (
          <p className={styles.empty}>Feed unavailable</p>
        ) : loading ? (
          <p className={styles.empty}>Loading trending tokens…</p>
        ) : tokens.length === 0 ? (
          <p className={styles.empty}>No trending tokens right now.</p>
        ) : (
          tokens.map((token) => (
            <a
              key={token.address || token.rank}
              href={token.url}
              target="_blank"
              rel="noreferrer"
              className={styles.row}
            >
              <span className={styles.rank}>{token.rank}</span>
              {token.artworkUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={token.artworkUrl} alt="" className={styles.art} />
              ) : (
                <span className={styles.artFallback}>{initials(token.name)}</span>
              )}
              <span className={styles.name}>
                <b>{token.name}</b>
                <small>${token.ticker}</small>
              </span>
              <span className={styles.stats}>
                <b>{formatMarketCap(token.marketCapUsd)}</b>
                <small className={token.priceChangePercent >= 0 ? styles.up : styles.dn}>
                  {formatChange(token.priceChangePercent)}
                </small>
              </span>
            </a>
          ))
        )}
      </div>

      <p className={styles.footer}>
        External market data via GMGN. Not Hoodlums launches. Not financial advice. Refreshes every
        60s.
      </p>
    </aside>
  );
}
