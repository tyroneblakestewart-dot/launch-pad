/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import styles from "./robinhood-trending-panel.module.css";

type TrendingToken = {
  address: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  marketCap: number | null;
  liquidity: number | null;
  volume5m: number | null;
  swaps5m: number | null;
  holders: number | null;
  change5m: number | null;
  launchpad: string | null;
  rank: number;
};

type TrendingSnapshot = {
  chain: "robinhood";
  interval: "5m";
  fetchedAt: string;
  tokens: TrendingToken[];
};

type LoadingState = "loading" | "ready" | "refreshing" | "error";

const REFRESH_INTERVAL_MS = 60_000;

function compactNumber(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function currency(value: number | null): string {
  return value === null ? "—" : `$${compactNumber(value)}`;
}

function percentage(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`;
}

function isSnapshot(value: unknown): value is TrendingSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<TrendingSnapshot>;
  return snapshot.chain === "robinhood" && snapshot.interval === "5m" && Array.isArray(snapshot.tokens);
}

function TokenArtwork({ token }: { token: TrendingToken }) {
  if (token.logoUrl) {
    return (
      <img
        src={token.logoUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }

  return <span aria-hidden="true">{token.symbol.slice(0, 1).toUpperCase()}</span>;
}

export function RobinhoodTrendingPanel() {
  const [snapshot, setSnapshot] = useState<TrendingSnapshot | null>(null);
  const [state, setState] = useState<LoadingState>("loading");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let disposed = false;
    let activeRequest: AbortController | null = null;

    async function loadTrending() {
      activeRequest?.abort();
      const controller = new AbortController();
      activeRequest = controller;
      setState((current) => (current === "ready" ? "refreshing" : "loading"));

      try {
        const response = await fetch("/api/market/trending", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || !isSnapshot(body)) throw new Error("Market feed unavailable");
        if (disposed) return;

        setSnapshot(body);
        setState("ready");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (disposed) return;
        setState("error");
      } finally {
        if (activeRequest === controller) activeRequest = null;
      }
    }

    void loadTrending();
    const interval = window.setInterval(() => void loadTrending(), REFRESH_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      activeRequest?.abort();
    };
  }, [refreshKey]);

  const featured = snapshot?.tokens.slice(0, 3) ?? [];
  const rest = snapshot?.tokens.slice(3, 8) ?? [];
  const updatedAt = snapshot
    ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(
        new Date(snapshot.fetchedAt),
      )
    : null;

  return (
    <aside className={styles.panel} aria-labelledby="trending-title">
      <div className={styles.heading}>
        <div>
          <p><span className={styles.liveDot} /> ROBINHOOD CHAIN</p>
          <h2 id="trending-title">Trending in the last 5 minutes</h2>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((value) => value + 1)}
          disabled={state === "loading" || state === "refreshing"}
          aria-label="Refresh trending tokens"
        >
          {state === "refreshing" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className={styles.status} aria-live="polite">
        {state === "loading" && !snapshot ? "Loading live market activity…" : null}
        {state === "error" && !snapshot ? (
          <div>
            <b>Market feed warming up</b>
            <span>Robinhood activity will appear here as soon as the live feed is available.</span>
          </div>
        ) : null}
        {state !== "loading" && snapshot && featured.length === 0 ? (
          <div>
            <b>No ranked tokens returned</b>
            <span>The panel will check the Robinhood market again automatically.</span>
          </div>
        ) : null}
      </div>

      {featured.length > 0 ? (
        <div className={styles.featuredGrid}>
          {featured.map((token) => (
            <article key={token.address} className={styles.featuredCard}>
              <div className={styles.artwork}><TokenArtwork token={token} /></div>
              <div className={styles.featuredRank}>#{token.rank}</div>
              <div className={styles.featuredIdentity}>
                <div>
                  <h3>{token.name}</h3>
                  <span>${token.symbol}</span>
                </div>
                <b className={token.change5m !== null && token.change5m < 0 ? styles.negative : styles.positive}>
                  {percentage(token.change5m)}
                </b>
              </div>
              <dl>
                <div><dt>Market cap</dt><dd>{currency(token.marketCap)}</dd></div>
                <div><dt>5m volume</dt><dd>{currency(token.volume5m)}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      ) : null}

      {rest.length > 0 ? (
        <div className={styles.tokenList}>
          {rest.map((token) => (
            <article key={token.address}>
              <div className={styles.miniArtwork}><TokenArtwork token={token} /></div>
              <div className={styles.listIdentity}>
                <b>{token.name}</b>
                <span>${token.symbol}</span>
              </div>
              <div><small>5m volume</small><b>{currency(token.volume5m)}</b></div>
              <div><small>Trades</small><b>{compactNumber(token.swaps5m)}</b></div>
              <div><small>Holders</small><b>{compactNumber(token.holders)}</b></div>
              <strong className={token.change5m !== null && token.change5m < 0 ? styles.negative : styles.positive}>
                {percentage(token.change5m)}
              </strong>
            </article>
          ))}
        </div>
      ) : null}

      <footer>
        <span>{updatedAt ? `Updated ${updatedAt} · refreshes every minute` : "Refreshes every minute"}</span>
        <p>External market activity supplied by GMGN. These are not Hoodlums launches or financial advice.</p>
      </footer>
    </aside>
  );
}
