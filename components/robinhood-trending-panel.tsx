"use client";

import { useEffect, useState } from "react";
import type { TrendingFeedResult, TrendingToken } from "@/lib/server/robinhood-trending";
import { buildGridChangePill, formatGridMarketCapUsd } from "@/lib/token-grid-card-model";
import styles from "./robinhood-trending-panel.module.css";

const POLL_INTERVAL_MS = 60_000;

type TrendingTab = "solana" | "robinhood";

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

/**
 * Trending banner (owner direction, 4 Sep 2026 round 2): the Dexscreener
 * Solana trending feed runs as a moving ticker across the top of the
 * homepage — one slim panel, the tokens scrolling right to left on a
 * continuous loop (the list is rendered twice so the loop never shows a
 * seam), pausing under the pointer so a token can be read and clicked, and
 * standing still with an ordinary horizontal scroll for reduced-motion
 * users. The data is unchanged: the same 60s poll, the same "via
 * Dexscreener" attribution, and the Robinhood Chain tab stays an honest
 * coming-soon chip — the owner has confirmed GMGN's feed does not work for
 * this project, so nothing pretends to be a Robinhood Chain ranking.
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
  const message =
    activeTab === "robinhood"
      ? "Robinhood Chain trending is coming soon."
      : unavailable
        ? "Feed unavailable"
        : loading
          ? "Loading trending tokens…"
          : tokens.length === 0
            ? "No trending tokens right now."
            : null;

  function renderItems(copy: "a" | "b") {
    return tokens.map((token) => {
      const pill = buildGridChangePill(token.priceChangePercent, 0);
      return (
        <a
          key={`${copy}-${token.address || token.rank}`}
          href={token.url}
          target="_blank"
          rel="noreferrer"
          className={styles.item}
          aria-hidden={copy === "b" ? "true" : undefined}
          tabIndex={copy === "b" ? -1 : undefined}
        >
          <span className={styles.rank}>#{token.rank}</span>
          {token.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={token.artworkUrl} alt="" className={styles.art} />
          ) : (
            <span className={styles.artFallback}>{initials(token.name)}</span>
          )}
          <b className={styles.name}>{token.name}</b>
          <span className={styles.ticker}>${token.ticker}</span>
          <span className={styles.cap}>{formatGridMarketCapUsd(token.marketCapUsd)}</span>
          {pill && <span className={`${styles.pill} ${pill.direction === "down" ? styles.dn : styles.up}`}>{pill.label}</span>}
        </a>
      );
    });
  }

  return (
    <section className={styles.panel} aria-label={ariaLabel}>
      <div className={styles.label}>
        <span className={styles.dot} aria-hidden="true" />
        <b className={styles.headerLabel}>{headerLabel}</b>
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

      <div className={styles.viewport}>
        {message ? (
          <p className={styles.empty}>{message}</p>
        ) : (
          <div className={styles.track}>
            {renderItems("a")}
            {renderItems("b")}
          </div>
        )}
      </div>

      <span
        className={styles.footer}
        title="External market data via Dexscreener. Not Hoodlums launches. Not financial advice. Refreshes every 60s."
      >
        via Dexscreener · 60s
      </span>
    </section>
  );
}
