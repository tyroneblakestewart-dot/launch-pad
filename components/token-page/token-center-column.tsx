"use client";

import { useState } from "react";
import { PublicDexscreenerSection } from "@/components/public-dexscreener-section";
import {
  formatHolderPercent,
  formatPriceChange,
  formatUsdPrice,
  shortenAddress,
} from "@/lib/token-page-format";
import type { TokenMarketStats } from "@/lib/server/token-market-stats";
import styles from "./token-page.module.css";

type ActivityTab = "trades" | "holders";

const TABS: { id: ActivityTab; label: string }[] = [
  { id: "trades", label: "Recent trades" },
  { id: "holders", label: "Holders" },
];

function formatTokenAmount(amountRaw: string, decimals: number | null): string {
  const value = Number(amountRaw) / 10 ** (decimals ?? 18);
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: value < 1 ? 6 : 2 });
}

/**
 * Centre column of the public token page (issue #225): the live Dexscreener
 * chart — reused verbatim from `PublicDexscreenerSection` (PR #180) rather
 * than rebuilt, per the issue — under a price/24h-change header sourced
 * from the same market snapshot as the left column's stats, plus the
 * "Recent trades" / "Holders" tabs the issue calls for in this column.
 * `PublicDexscreenerSection` keeps its own chrome/styling since it's shared
 * with `app/[slug]/page.tsx`'s public generated site.
 */
export function TokenCenterColumn({ address, marketStats }: { address: string; marketStats: TokenMarketStats }) {
  const [tab, setTab] = useState<ActivityTab>("trades");

  const priceUsd = marketStats.supported ? marketStats.priceUsd : null;
  const priceChange = formatPriceChange(marketStats.supported ? marketStats.priceChange24hPercent : null);
  const trades = marketStats.supported ? marketStats.trades : [];
  const holders = marketStats.supported ? marketStats.holders : [];
  const decimals = marketStats.supported ? marketStats.decimals : null;

  return (
    <>
      <div className={styles.chartPanel}>
        <div className={styles.chartHeader}>
          <div>
            <div className={styles.priceLabel}>Price</div>
            <div className={styles.priceRow}>
              <span className={styles.priceValue}>{formatUsdPrice(priceUsd)}</span>
              {priceChange ? (
                <span className={`${styles.priceChange} ${priceChange.up ? styles.priceChangeUp : styles.priceChangeDown}`}>
                  {priceChange.label}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className={styles.chartEmbedShell}>
          <PublicDexscreenerSection address={address} />
        </div>
      </div>

      <div className={styles.activityPanel}>
        <div className={styles.activityTabs}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.activityTab} ${tab === item.id ? styles.activityTabActive : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "trades" ? (
          trades.length === 0 ? (
            <p className={styles.emptyState}>No trades recorded yet.</p>
          ) : (
            <div>
              <div className={`${styles.activityHeaderRow} ${styles.tradesGridCols}`}>
                <span>Type</span>
                <span>Wallet</span>
                <span>Amount</span>
                <span style={{ textAlign: "right" }}>Time</span>
              </div>
              {trades.map((trade) => (
                <div key={`${trade.txHash}-${trade.wallet}`} className={`${styles.activityRow} ${styles.tradesGridCols}`}>
                  <span className={trade.type === "buy" ? styles.tradeTypeBuy : styles.tradeTypeSell}>
                    {trade.type === "buy" ? "▲ BUY" : "▼ SELL"}
                  </span>
                  <span className={styles.dimText}>{shortenAddress(trade.wallet)}</span>
                  <span className={styles.bodyText}>{formatTokenAmount(trade.amountRaw, decimals)}</span>
                  <span className={styles.faintText}>{trade.time}</span>
                </div>
              ))}
            </div>
          )
        ) : holders.length === 0 ? (
          <p className={styles.emptyState}>No holder data found for this token yet.</p>
        ) : (
          <div>
            <div className={`${styles.activityHeaderRow} ${styles.holdersGridCols}`}>
              <span>Rank</span>
              <span>Wallet</span>
              <span>% supply</span>
              <span>Share</span>
            </div>
            {holders.map((holder, index) => (
              <div key={holder.address} className={`${styles.activityRow} ${styles.holdersGridCols}`}>
                <span className={styles.rankText}>#{index + 1}</span>
                <span className={styles.dimText}>{shortenAddress(holder.address)}</span>
                <span className={styles.bodyText}>{formatHolderPercent(holder.percent)}</span>
                <span className={styles.shareBarTrack}>
                  <span
                    className={styles.shareBarFill}
                    style={{ width: `${Math.min(100, Math.max(2, holder.percent || 0))}%` }}
                  />
                </span>
              </div>
            ))}
            <p className={styles.mutedNote} style={{ padding: "11px 16px" }}>
              Liquidity pool address excluded from this list.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
