"use client";

import { useEffect, useState } from "react";
import {
  fetchRobinhoodTrending,
  formatCompactUsd,
  formatPercentChange,
  type TrendingToken,
} from "@/lib/robinhood-trending-client";
import styles from "./robinhood-trending-panel.module.css";

const POLL_INTERVAL_MS = 60_000;

function TokenArtwork({ token }: { token: TrendingToken }) {
  if (token.artworkUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={token.artworkUrl} alt="" className={styles.artwork} />;
  }
  return (
    <span className={styles.artworkFallback} aria-hidden="true">
      {token.ticker.slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

export function RobinhoodTrendingPanel() {
  const [tokens, setTokens] = useState<TrendingToken[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      const result = await fetchRobinhoodTrending(controller.signal).catch(() => ({
        tokens: [] as TrendingToken[],
        error: true,
      }));
      if (cancelled) return;
      setTokens(result.tokens);
      setStatus(result.error ? "unavailable" : "ready");
    }

    load();
    const timer = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <aside className={styles.panel} aria-label="Robinhood Chain trending tokens">
      <div className={styles.header}>
        <p className={styles.title}>TRENDING NOW</p>
        <p className={styles.subtitle}>
          <span className={styles.liveDot} aria-hidden="true" />
          Robinhood Chain · 5-min window · via GMGN
        </p>
      </div>

      <div className={styles.feed}>
        {status === "loading" && <p className={styles.empty}>Loading trending tokens…</p>}
        {status === "unavailable" && <p className={styles.empty}>Feed unavailable</p>}
        {status === "ready" && tokens.length === 0 && (
          <p className={styles.empty}>No trending tokens right now.</p>
        )}
        {tokens.map((token) => (
          <a
            key={`${token.rank}-${token.ticker}`}
            href={token.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.row}
          >
            <span className={styles.rank}>{token.rank}</span>
            <TokenArtwork token={token} />
            <span className={styles.tokenInfo}>
              <b>{token.name}</b>
              <small>
                ${token.ticker}
                {token.addressLabel ? ` · ${token.addressLabel}` : ""}
              </small>
            </span>
            <span className={styles.stats}>
              <b>{formatCompactUsd(token.marketCapUsd)}</b>
              <small className={token.percentChange5m >= 0 ? styles.up : styles.dn}>
                {formatPercentChange(token.percentChange5m)}
              </small>
            </span>
          </a>
        ))}
      </div>

      <p className={styles.footer}>
        External market data via GMGN. Not Hoodlums launches. Not financial advice. Refreshes every 60s.
      </p>
    </aside>
  );
}
