"use client";

import { useEffect, useState } from "react";
import type { TrendingFeedResult, TrendingToken } from "@/lib/server/robinhood-trending";
import { buildGridChangePill, formatGridMarketCapUsd, TRENDING_PANEL_COUNT } from "@/lib/token-grid-card-model";
import styles from "./robinhood-trending-panel.module.css";

const POLL_INTERVAL_MS = 60_000;

type TrendingTab = "solana" | "robinhood";

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

/**
 * Third-party trending row (owner direction, 4 Sep 2026): the four bottom
 * panels of the twelve-panel homepage, one card per top-trending token in
 * the same card shape as the Hoodlums tokens above — artwork, name, ticker,
 * market cap and 24h change (lime up, grey down) — so the page reads as one
 * grid rather than a grid plus a sidebar list. The data is unchanged: the
 * Solana feed via Dexscreener, polled every 60s, with the Robinhood Chain
 * tab still an honest coming-soon placeholder. These tokens carry no trade
 * series of their own, so they get a change pill, never a fabricated line.
 */
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
  const ariaLabel = activeTab === "solana" ? "Solana trending tokens" : "Robinhood Chain trending tokens";
  const shown = tokens.slice(0, TRENDING_PANEL_COUNT);

  return (
    <section className={styles.section} aria-label={ariaLabel}>
      <div className={styles.sectionHeader}>
        <p className={styles.eyebrow}>
          <span className={styles.dot} aria-hidden="true" />
          {headerLabel}
          <span className={styles.window}>via Dexscreener · refreshes every 60s</span>
        </p>
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
      </div>

      {activeTab === "robinhood" ? (
        <div className={styles.notice}>
          <span className={styles.badge}>Coming soon</span>
          <p className={styles.empty}>Robinhood Chain trending is coming soon.</p>
        </div>
      ) : unavailable ? (
        <div className={styles.notice}>
          <p className={styles.empty}>Feed unavailable</p>
        </div>
      ) : loading ? (
        <div className={styles.notice}>
          <p className={styles.empty}>Loading trending tokens…</p>
        </div>
      ) : shown.length === 0 ? (
        <div className={styles.notice}>
          <p className={styles.empty}>No trending tokens right now.</p>
        </div>
      ) : (
        <div className={styles.row}>
          {shown.map((token) => {
            const pill = buildGridChangePill(token.priceChangePercent, 0);
            return (
              <a
                key={token.address || token.rank}
                href={token.url}
                target="_blank"
                rel="noreferrer"
                className={styles.panel}
              >
                <div className={styles.art}>
                  {token.artworkUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={token.artworkUrl} alt="" className={styles.artImage} />
                  ) : (
                    <span className={styles.artFallback}>{initials(token.name)}</span>
                  )}
                  <span className={styles.rank}>#{token.rank}</span>
                </div>
                <div className={styles.nameRow}>
                  <b className={styles.name}>{token.name}</b>
                  {pill && (
                    <span className={`${styles.pill} ${pill.direction === "down" ? styles.dn : styles.up}`}>{pill.label}</span>
                  )}
                </div>
                <div className={styles.tickerRow}>
                  <span className={styles.ticker}>${token.ticker}</span>
                  <span className={styles.source}>Dexscreener ↗</span>
                </div>
                <div className={styles.capRow}>
                  <b className={styles.cap}>{formatGridMarketCapUsd(token.marketCapUsd)}</b>
                  <span className={styles.capLabel}>MCAP</span>
                </div>
              </a>
            );
          })}
        </div>
      )}

      <p className={styles.footer}>
        External market data via Dexscreener. Not Hoodlums launches. Not financial advice. Refreshes every 60s.
      </p>
    </section>
  );
}
