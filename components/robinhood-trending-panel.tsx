"use client";

import { useEffect, useState } from "react";
import type { TrendingFeedResult, TrendingToken } from "@/lib/server/robinhood-trending";
import type { GraduatingFeedResult, GraduatingToken } from "@/lib/server/pumpfun-graduating";
import styles from "./robinhood-trending-panel.module.css";

const POLL_INTERVAL_MS = 60_000;
const MIN_GRADUATING_TOKENS = 2;

type TrendingTab = "solana" | "robinhood" | "graduating";

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

  const [graduatingTokens, setGraduatingTokens] = useState<GraduatingToken[]>([]);
  const [graduatingEligible, setGraduatingEligible] = useState(false);

  // If the graduating tab is selected and then drops below the eligibility
  // bar, this derived value falls back to Solana instead of rendering a
  // dead tab — no extra state or render-triggering effect needed for it.
  const displayedTab: TrendingTab = activeTab === "graduating" && !graduatingEligible ? "solana" : activeTab;

  useEffect(() => {
    // The Robinhood Chain tab is a coming-soon placeholder: no fetch until
    // a live feed exists for it.
    if (displayedTab !== "solana") return;

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
  }, [displayedTab]);

  // Polled independent of which tab is active: the tab's own visibility has
  // to react to live data, so it can never render an empty or stale "race".
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/trending-robinhood?feed=graduating", { cache: "no-store" });
        const result = (await response.json()) as GraduatingFeedResult;
        if (cancelled) return;
        const eligible = !result.error && result.tokens.length >= MIN_GRADUATING_TOKENS;
        setGraduatingTokens(eligible ? result.tokens : []);
        setGraduatingEligible(eligible);
      } catch {
        if (!cancelled) {
          setGraduatingTokens([]);
          setGraduatingEligible(false);
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

  const headerLabel =
    displayedTab === "solana"
      ? "TRENDING · SOLANA"
      : displayedTab === "graduating"
        ? "GRADUATING · PUMP.FUN"
        : "TRENDING · ROBINHOOD CHAIN";
  const headerName = displayedTab === "solana" ? "Solana" : displayedTab === "graduating" ? "pump.fun" : "Robinhood Chain";
  const headerSource = displayedTab === "graduating" ? "via pump.fun" : "via Dexscreener";
  const ariaLabel =
    displayedTab === "solana"
      ? "Solana trending tokens"
      : displayedTab === "graduating"
        ? "Tokens graduating now on pump.fun"
        : "Robinhood Chain trending tokens";

  return (
    <aside className={styles.panel} aria-label={ariaLabel}>
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={displayedTab === "solana"}
          className={`${styles.tab} ${displayedTab === "solana" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("solana")}
        >
          Solana
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={displayedTab === "robinhood"}
          className={`${styles.tab} ${styles.tabMuted} ${displayedTab === "robinhood" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("robinhood")}
        >
          Robinhood Chain
          <span className={styles.badge}>Coming soon</span>
        </button>
        {graduatingEligible && (
          <button
            type="button"
            role="tab"
            aria-selected={displayedTab === "graduating"}
            className={`${styles.tab} ${displayedTab === "graduating" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("graduating")}
          >
            Graduating now
          </button>
        )}
      </div>

      <div className={styles.header}>
        <div>
          <b>{headerLabel}</b>
          <span className={styles.pulseRow}>
            <span className={styles.dot} /> {headerName}
          </span>
        </div>
        <span className={styles.window}>{headerSource}</span>
      </div>

      <div className={styles.feed}>
        {displayedTab === "graduating" ? (
          graduatingTokens.map((token) => (
            <a key={token.address} href={token.url} target="_blank" rel="noreferrer" className={styles.gradRow}>
              {token.artworkUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={token.artworkUrl} alt="" className={styles.art} />
              ) : (
                <span className={styles.artFallback}>{initials(token.name)}</span>
              )}
              <span className={styles.gradInfo}>
                <span className={styles.name}>
                  <b>{token.name}</b>
                  <small>${token.ticker}</small>
                </span>
                <span className={styles.progressTrack}>
                  <span
                    className={styles.progressFill}
                    style={{ width: `${Math.min(100, Math.max(0, token.progressPercent))}%` }}
                  />
                </span>
              </span>
              <span className={styles.progressLabel}>{Math.round(token.progressPercent)}%</span>
            </a>
          ))
        ) : displayedTab === "robinhood" ? (
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
        {displayedTab === "graduating"
          ? "live from pump.fun — Hoodlums graduations join this race at mainnet"
          : "External market data via Dexscreener. Not Hoodlums launches. Not financial advice. Refreshes every 60s."}
      </p>
    </aside>
  );
}
