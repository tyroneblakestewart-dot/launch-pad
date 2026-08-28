"use client";

import { useState } from "react";
import type { Address } from "viem";
import { TokenChatPanel } from "@/components/token-page/token-chat-panel";
import { TokenChart } from "@/components/token-page/token-chart";
import { CHAIN_CONFIG, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { formatHolderPercent, shortenAddress } from "@/lib/token-page-format";
import type { TokenMarketStats } from "@/lib/server/token-market-stats";
import type { SupportedChain } from "@/lib/types";
import { useTokenTrades } from "@/lib/use-token-trades";
import styles from "./token-page.module.css";

type ActivityTab = "trades" | "holders" | "hoodchat";

const TABS: { id: ActivityTab; label: string }[] = [
  { id: "trades", label: "Recent trades" },
  { id: "holders", label: "Holders" },
  { id: "hoodchat", label: "Hoodchat" },
];

function formatTokenAmount(amountRaw: string, decimals: number | null): string {
  const value = Number(amountRaw) / 10 ** (decimals ?? 18);
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: value < 1 ? 6 : 2 });
}

function formatTimeAgo(blockTimestampMs: number): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - blockTimestampMs) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.floor(diffHours / 24)}d`;
}

/**
 * Centre column of the public token page (issue #225). The price/24h-change
 * header moved up to the shared topbar (issue #427). Issue #430 replaces
 * #427's deliberate chart placeholder with the real live candlestick chart
 * and wires the Recent trades tab to `useTokenTrades` (a ~12s live poll of
 * GET /api/token-trades, issue #430) instead of the old Dexscreener/
 * Blockscout-derived `marketStats.trades`, which required a Dexscreener
 * pair that never exists for this chain pre-graduation — the reason the
 * tab showed "No trades recorded yet" forever even after real confirmed
 * trades. `marketStats.trades`/`classifyTrades` are left in place in
 * lib/server/token-market-stats.ts (untouched, still tested) since nothing
 * else here depends on removing them. Both the chart and the trades list
 * share one `useTokenTrades` call so a single ~12s poll drives both,
 * rather than doubling the read-rate-limit cost.
 */
export function TokenCenterColumn({
  chain,
  address,
  marketStats,
  curveAddress,
}: {
  chain: SupportedChain;
  address: string;
  marketStats: TokenMarketStats;
  curveAddress: Address | null;
}) {
  const [tab, setTab] = useState<ActivityTab>("trades");
  const { trades, error: tradesError } = useTokenTrades(curveAddress, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL);

  const holders = marketStats.supported ? marketStats.holders : [];
  const decimals = marketStats.supported ? marketStats.decimals : null;
  const symbol = marketStats.supported && marketStats.symbol ? marketStats.symbol : null;
  // GET /api/token-trades already returns ascending (oldest-first) order for
  // the chart's candle bucketing; the tab wants newest-first.
  const recentTradesDescending = trades ? [...trades].reverse() : null;
  // Both explorer bases end in "/address/" (lib/chains.ts) — Blockscout and
  // Solana Explorer both also serve transactions at "/tx/{hash}".
  const explorerTxBaseUrl = CHAIN_CONFIG[chain].explorerBaseUrl.replace("/address/", "/tx/");

  return (
    <>
      <TokenChart trades={trades} />

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
          recentTradesDescending === null ? (
            <p className={styles.emptyState}>{tradesError ?? "Loading trade history…"}</p>
          ) : recentTradesDescending.length === 0 ? (
            <p className={styles.emptyState}>No trades recorded yet.</p>
          ) : (
            <div>
              <div className={`${styles.activityHeaderRow} ${styles.tradesGridCols}`}>
                <span>Type</span>
                <span>Wallet</span>
                <span>Amount</span>
                <span style={{ textAlign: "right" }}>Time</span>
              </div>
              {recentTradesDescending.map((trade) => (
                <div
                  key={`${trade.txHash}-${trade.logIndex}`}
                  className={`${styles.activityRow} ${styles.tradesGridCols}`}
                >
                  <span className={trade.direction === "buy" ? styles.tradeTypeBuy : styles.tradeTypeSell}>
                    {trade.direction === "buy" ? "▲ BUY" : "▼ SELL"}
                  </span>
                  <span className={styles.dimText}>{shortenAddress(trade.wallet)}</span>
                  <span className={styles.bodyText}>{formatTokenAmount(trade.tokenAmountRaw, decimals)}</span>
                  <a
                    href={`${explorerTxBaseUrl}${trade.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.faintText}
                    style={{ textAlign: "right" }}
                  >
                    {formatTimeAgo(trade.blockTimestampMs)} ↗
                  </a>
                </div>
              ))}
            </div>
          )
        ) : tab === "holders" ? (
          holders.length === 0 ? (
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
          )
        ) : (
          <TokenChatPanel chain={chain} address={address} symbol={symbol} holders={holders} />
        )}
      </div>
    </>
  );
}
