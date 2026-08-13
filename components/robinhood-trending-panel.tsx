"use client";

import { useEffect, useState } from "react";
import type { TrendingFeedResult, TrendingToken } from "@/lib/server/robinhood-trending";
import styles from "./robinhood-trending-panel.module.css";

const POLL_INTERVAL_MS = 60_000;

type TrendingTab = "solana" | "robinhood";

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
  const [activeTab, setActiveTab] = useState<TrendingTab>("solana");
  const [tokens, setTokens] = useState<TrendingToken[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The Robinhood Chain tab is a coming-soon placeholder: no fetch until
    // a live feed exists for it.
    if (activeTab !== "solana") return;

    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/trending-robinhood?feed=solana", { cache: "no-store" });
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
  }, [activeTab]);

  const headerLabel = activeTab === "solana" ? "TRENDING · SOLANA" : "TRENDING · ROBINHOOD CHAIN";
  const headerName = activeTab === "solana" ? "Solana" : "Robinhood Chain";
  const ariaLabel = activeTab === "solana" ? "Solana trending tokens" : "Robinhood Chain trending tokens";

  return (
    <aside className={styles.panel} aria-label={ariaLabel}>
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "solana"}
          className={`${styles.tab} ${activeTab === "solana" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("solana")}
        >
          Solana
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "robinhood"}
          className={`${styles.tab} ${styles.tabMuted} ${activeTab === "robinhood" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("robinhood")}
        >
          Robinhood Chain
          <span className={styles.badge}>Coming soon</span>
        </button>
      </div>

      <div className={styles.header}>
        <div>
          <b>{headerLabel}</b>
          <span className={styles.pulseRow}>
            <span className={styles.dot} /> {headerName}
          </span>
        </div>
        <span className={styles.window}>via Dexscreener</span>
      </div>

      <div className={styles.feed}>
        {activeTab === "robinhood" ? (
          <div className={styles.comingSoon}>
            <span className={styles.badge}>Testnet</span>
            <p className={styles.empty}>Robinhood Chain trending is coming soon.</p>
          </div>
        ) : unavailable ? (
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
        External market data via Dexscreener. Not Hoodlums launches. Not financial advice. Refreshes every 60s.
      </p>
    </aside>
  );
}
