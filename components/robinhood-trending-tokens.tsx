"use client";

import { useEffect, useState } from "react";
import type {
  GmgnTrendingInterval,
  RobinhoodTrendingResult,
  RobinhoodTrendingToken,
} from "@/lib/server/gmgn-trending";
import styles from "./robinhood-trending-tokens.module.css";

const REFRESH_MS = 60_000;

function compactCurrency(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function compactNumber(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-GB", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function percent(value: number | null, alreadyPercent = false): string {
  if (value === null) return "—";
  const normalised = alreadyPercent ? value : value * 100;
  return `${normalised >= 0 ? "+" : ""}${normalised.toFixed(1)}%`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function TokenCard({ token }: { token: RobinhoodTrendingToken }) {
  const changeClass =
    token.priceChangePercent === null
      ? ""
      : token.priceChangePercent >= 0
        ? styles.positive
        : styles.negative;
  return (
    <article className={styles.tokenCard}>
      <div className={styles.tokenHeading}>
        <div>
          <strong>{token.symbol}</strong>
          <span>{token.name}</span>
        </div>
        <b className={changeClass}>{percent(token.priceChangePercent, true)}</b>
      </div>
      <dl>
        <div><dt>Market cap</dt><dd>{compactCurrency(token.marketCap)}</dd></div>
        <div><dt>Liquidity</dt><dd>{compactCurrency(token.liquidity)}</dd></div>
        <div><dt>Volume</dt><dd>{compactCurrency(token.volume)}</dd></div>
        <div><dt>Trades</dt><dd>{compactNumber(token.swaps)}</dd></div>
        <div><dt>Holders</dt><dd>{compactNumber(token.holderCount)}</dd></div>
        <div><dt>Dev holding</dt><dd>{percent(token.devHoldingRate)}</dd></div>
      </dl>
      <div className={styles.tokenFooter}>
        <code title={token.address}>{shortAddress(token.address)}</code>
        <a
          href={`https://dexscreener.com/search?q=${encodeURIComponent(token.address)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          View market ↗
        </a>
      </div>
    </article>
  );
}

export function RobinhoodTrendingTokens() {
  const [interval, setIntervalValue] = useState<GmgnTrendingInterval>("5m");
  const [result, setResult] = useState<RobinhoodTrendingResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/market/trending?interval=${interval}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as RobinhoodTrendingResult & {
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Market activity could not be loaded.");
        setResult(payload);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Market activity could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [interval, refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setRefreshKey((value) => value + 1), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className={styles.marketPanel} aria-labelledby="robinhood-market-title">
      <div className={styles.header}>
        <div>
          <p>LIVE ROBINHOOD CHAIN ACTIVITY</p>
          <h2 id="robinhood-market-title">Trending tokens</h2>
          <span>See what traders are active on while Hoodlums bonding launches are being prepared.</span>
        </div>
        <div className={styles.controls}>
          <div className={styles.tabs} aria-label="Trending time window">
            {(["5m", "1h"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={interval === value ? styles.active : ""}
                aria-pressed={interval === value}
                onClick={() => setIntervalValue(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.refresh}
            disabled={loading}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <div className={styles.message} role="status">{error}</div> : null}
      {!error && loading && !result ? (
        <div className={styles.message} role="status">Loading Robinhood Chain activity…</div>
      ) : null}
      {!error && result && result.tokens.length === 0 ? (
        <div className={styles.message} role="status">No trending Robinhood Chain tokens were returned for this window.</div>
      ) : null}
      {result?.tokens.length ? (
        <div className={styles.tokenGrid} aria-live="polite">
          {result.tokens.map((token) => <TokenCard key={token.address} token={token} />)}
        </div>
      ) : null}

      <footer className={styles.disclaimer}>
        Powered by GMGN market data. Trending activity is not a safety check or investment recommendation.
        Data refreshes automatically about once per minute.
      </footer>
    </section>
  );
}
