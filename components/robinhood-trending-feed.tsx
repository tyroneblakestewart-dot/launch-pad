"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  RobinhoodTrendingInterval,
  RobinhoodTrendingResponse,
  RobinhoodTrendingToken,
} from "@/lib/robinhood-market";
import styles from "./robinhood-trending-feed.module.css";

const REFRESH_INTERVAL_MS = 60_000;
const INTERVAL_OPTIONS: Array<{ value: RobinhoodTrendingInterval; label: string }> = [
  { value: "5m", label: "5 MIN" },
  { value: "1h", label: "1 HOUR" },
];

type LoadStatus = "loading" | "ready" | "refreshing" | "error";

function formatUsd(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (Math.abs(value) >= 1) return `$${value.toFixed(2)}`;
  if (value === 0) return "$0";
  return `$${value.toPrecision(3)}`;
}

function formatCount(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
}

function formatChange(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatRate(value: number | null): string {
  if (value === null) return "—";
  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return `${percent.toFixed(1)}%`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function tokenInitial(token: RobinhoodTrendingToken): string {
  return token.symbol.trim().charAt(0).toUpperCase() || "?";
}

export function RobinhoodTrendingFeed() {
  const [selectedInterval, setSelectedInterval] =
    useState<RobinhoodTrendingInterval>("5m");
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<RobinhoodTrendingResponse | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let activeController: AbortController | null = null;

    const load = async (background: boolean) => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      if (!background) {
        setData(null);
        setError("");
        setStatus("loading");
      } else {
        setStatus("refreshing");
      }

      try {
        const response = await fetch("/api/market/robinhood-trending", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interval: selectedInterval }),
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as
          | RobinhoodTrendingResponse
          | { error?: string };
        if (!response.ok || !("tokens" in payload) || !Array.isArray(payload.tokens)) {
          throw new Error(
            "error" in payload && payload.error
              ? payload.error
              : "Live Robinhood market activity could not be loaded.",
          );
        }
        if (!active) return;
        setData(payload);
        setError("");
        setStatus("ready");
      } catch (caught) {
        if (!active || (caught instanceof Error && caught.name === "AbortError")) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Live Robinhood market activity could not be loaded.",
        );
        setStatus("error");
      }
    };

    void load(false);
    const refreshTimer = window.setInterval(() => {
      void load(true);
    }, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      activeController?.abort();
      window.clearInterval(refreshTimer);
    };
  }, [reloadKey, selectedInterval]);

  const totals = useMemo(() => {
    const tokens = data?.tokens ?? [];
    return {
      volume: tokens.reduce((sum, token) => sum + (token.volumeUsd ?? 0), 0),
      swaps: tokens.reduce((sum, token) => sum + (token.swaps ?? 0), 0),
      tokens: tokens.length,
    };
  }, [data]);

  return (
    <section className={styles.feed} aria-labelledby="robinhood-market-pulse-title">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>LIVE MARKET ACTIVITY</p>
          <h2 id="robinhood-market-pulse-title">Robinhood Chain Pulse</h2>
          <p className={styles.intro}>
            See what is moving on Robinhood Chain while Hoodlums bonding launches prepare to go live.
          </p>
        </div>
        <div className={styles.controls} aria-label="Trending interval">
          {INTERVAL_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={selectedInterval === option.value ? styles.activeInterval : ""}
              aria-pressed={selectedInterval === option.value}
              onClick={() => setSelectedInterval(option.value)}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => setReloadKey((value) => value + 1)}
            disabled={status === "loading" || status === "refreshing"}
          >
            {status === "refreshing" ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {data ? (
        <div className={styles.summary} aria-label="Trending market summary">
          <div><span>Tokens tracked</span><strong>{totals.tokens}</strong></div>
          <div><span>Combined volume</span><strong>{formatUsd(totals.volume)}</strong></div>
          <div><span>Combined swaps</span><strong>{formatCount(totals.swaps)}</strong></div>
          <div>
            <span>Last updated</span>
            <strong>
              {new Date(data.updatedAt).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </strong>
          </div>
        </div>
      ) : null}

      {status === "loading" ? (
        <div className={styles.loading} role="status" aria-live="polite">
          <span />
          <p>Loading live Robinhood Chain activity…</p>
        </div>
      ) : null}

      {status === "error" ? (
        <div className={styles.error} role="status" aria-live="polite">
          <strong>Market pulse temporarily unavailable</strong>
          <p>{error}</p>
          <button type="button" onClick={() => setReloadKey((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : null}

      {data && data.tokens.length === 0 ? (
        <div className={styles.empty} role="status">
          No Robinhood Chain tokens are ranked in this interval yet.
        </div>
      ) : null}

      {data && data.tokens.length > 0 ? (
        <ol className={styles.tokenGrid} aria-label={`Robinhood Chain ${selectedInterval} trending tokens`}>
          {data.tokens.map((token) => {
            const changeClass =
              token.priceChangePercent === null
                ? styles.neutral
                : token.priceChangePercent >= 0
                  ? styles.positive
                  : styles.negative;
            return (
              <li key={token.address} className={styles.tokenCard}>
                <div className={styles.tokenHeading}>
                  <span className={styles.rank}>#{token.rank}</span>
                  <span className={styles.tokenMark} aria-hidden="true">{tokenInitial(token)}</span>
                  <div className={styles.identity}>
                    <strong>{token.symbol}</strong>
                    <span>{token.name}</span>
                  </div>
                  <b className={`${styles.change} ${changeClass}`}>
                    {formatChange(token.priceChangePercent)}
                  </b>
                </div>
                <dl className={styles.metrics}>
                  <div><dt>Volume</dt><dd>{formatUsd(token.volumeUsd)}</dd></div>
                  <div><dt>Market cap</dt><dd>{formatUsd(token.marketCapUsd)}</dd></div>
                  <div><dt>Liquidity</dt><dd>{formatUsd(token.liquidityUsd)}</dd></div>
                  <div><dt>Swaps</dt><dd>{formatCount(token.swaps)}</dd></div>
                  <div><dt>Holders</dt><dd>{formatCount(token.holders)}</dd></div>
                  <div><dt>Dev team</dt><dd>{formatRate(token.devTeamHoldRate)}</dd></div>
                </dl>
                <div className={styles.tokenFooter}>
                  <span title={token.address}>{shortAddress(token.address)}</span>
                  <span>{token.smartMoneyCount === null ? "Smart money —" : `${formatCount(token.smartMoneyCount)} smart wallets`}</span>
                  {token.launchpad ? <span>{token.launchpad}</span> : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      <footer className={styles.disclaimer}>
        <span>Data source: GMGN · refreshes every 60 seconds</span>
        <span>Trending activity is not a safety score, endorsement or financial advice.</span>
      </footer>
    </section>
  );
}
