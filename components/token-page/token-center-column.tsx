"use client";

import { useState } from "react";
import { formatEther } from "viem";
import { TokenChatPanel } from "@/components/token-page/token-chat-panel";
import { TokenTradeChart } from "@/components/token-page/token-trade-chart";
import { formatHolderPercent, formatNativeAmountSixSigFigsTrimmed, formatTimeAgoSeconds, shortenAddress } from "@/lib/token-page-format";
import type { TokenMarketStats } from "@/lib/server/token-market-stats";
import type { TokenTrade } from "@/lib/token-trade-types";
import type { SupportedChain } from "@/lib/types";
import styles from "./token-page.module.css";

type ActivityTab = "trades" | "holders" | "hoodchat" | "about";

const TABS: { id: ActivityTab; label: string }[] = [
  { id: "trades", label: "Recent trades" },
  { id: "holders", label: "Holders" },
  { id: "hoodchat", label: "Hoodchat" },
  { id: "about", label: "About" },
];

function formatTokenAmount(amountRaw: string, decimals: number | null): string {
  const value = Number(amountRaw) / 10 ** (decimals ?? 18);
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: value < 1 ? 6 : 2 });
}

/** `nativeAmountRaw` is already the post-fee ETH amount that priced the trade (lib/token-trade-types.ts) — the design's dedicated ETH column (issue #467 item 4). */
function formatTradeEthAmount(nativeAmountRaw: string): string {
  const value = Number(formatEther(BigInt(nativeAmountRaw)));
  return formatNativeAmountSixSigFigsTrimmed(Number.isFinite(value) ? value : null);
}

/**
 * Centre column of the public token page (issue #225). The price/24h-change
 * header moved up to the shared topbar (issue #427) so it reads as part of
 * the token's identity everywhere, not just here. Issue #427 removed the
 * embedded Dexscreener chart entirely — Dexscreener can't index this chain,
 * so it only ever showed a "chart doesn't work here" message in the page's
 * prime real estate — leaving a placeholder for part 2's live chart. Issue
 * #430 fills that in for real: the resolved bonding curve's own on-chain
 * trade history (GET /api/token-trades) is shared by the candlestick chart
 * and the Recent trades tab so there is exactly one poll driving both, not
 * two. Issue #444 lifts that poll one level further, up to
 * `token-page-view.tsx`, so the header band and the Stats/Audit panel share
 * the exact same `trades`/`tradesError` values too — this component now
 * receives them as props instead of calling `useTokenTrades` itself. The
 * old `marketStats.trades` field (a Blockscout LP-transfer heuristic that
 * only ever worked for a token with a Dexscreener-indexed pool, never a
 * still-bonding curve token) is no longer used here. Issue #443 part 1 adds
 * an About tab (moved here from the now fully-removed `TokenRightColumn`,
 * whose only other content — referral trade-terminal links — was dead code
 * on the only chain this page supports, since `tradeLinks` is always empty
 * on Robinhood Chain Testnet) alongside Recent trades/Holders/Hoodchat, so
 * the centre column now fills the full width the old three-column desktop
 * layout split between centre and right.
 */
export function TokenCenterColumn({
  chain,
  address,
  marketStats,
  chainShortLabel,
  explorerBaseUrl,
  trades,
  tradesError,
  tradesStale,
  retryTrades,
  startingPriceNativePerToken,
  launchedAtUnixSeconds,
}: {
  chain: SupportedChain;
  address: string;
  marketStats: TokenMarketStats;
  chainShortLabel: string;
  explorerBaseUrl: string;
  trades: TokenTrade[] | null;
  tradesError: string | null;
  tradesStale: boolean;
  retryTrades: () => void;
  startingPriceNativePerToken: number | null;
  launchedAtUnixSeconds: number | null;
}) {
  const [tab, setTab] = useState<ActivityTab>("trades");

  const holders = marketStats.supported ? marketStats.holders : [];
  const decimals = marketStats.supported ? marketStats.decimals : null;
  const symbol = marketStats.supported && marketStats.symbol ? marketStats.symbol : null;
  const explorerTxBaseUrl = explorerBaseUrl.replace("/address/", "/tx/");

  return (
    <div className={styles.centerGroup}>
      <div className={styles.chartPlaceholder} data-token-chart="true">
        <TokenTradeChart
          trades={trades}
          decimals={decimals}
          error={tradesError}
          stale={tradesStale}
          retry={retryTrades}
          startingPriceNativePerToken={startingPriceNativePerToken}
          launchedAtUnixSeconds={launchedAtUnixSeconds}
          pairLabel={`${symbol ?? "TOKEN"} / ETH`}
        />
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
          tradesError ? (
            <p className={styles.emptyState}>{tradesError}</p>
          ) : trades === null ? (
            <p className={styles.emptyState}>Loading trade history…</p>
          ) : trades.length === 0 ? (
            <p className={styles.emptyState}>No trades recorded yet.</p>
          ) : (
            <div>
              <div className={`${styles.activityHeaderRow} ${styles.tradesGridCols}`}>
                <span>Type</span>
                <span>Wallet</span>
                <span className={styles.tradesCellRight}>Amount</span>
                <span className={styles.tradesCellRight}>ETH</span>
                <span className={styles.tradesCellRight}>Time</span>
              </div>
              {trades.map((trade) => {
                const directionColorClass = trade.direction === "buy" ? styles.tradeTypeBuy : styles.tradeTypeSell;
                return (
                  <div key={`${trade.txHash}-${trade.logIndex}`} className={`${styles.activityRow} ${styles.tradesGridCols}`}>
                    <span className={directionColorClass}>{trade.direction === "buy" ? "▲ BUY" : "▼ SELL"}</span>
                    <span className={styles.dimText}>{shortenAddress(trade.wallet)}</span>
                    <span className={`${styles.bodyText} ${styles.tradesCellRight}`}>
                      {formatTokenAmount(trade.tokenAmountRaw, decimals)}
                    </span>
                    <span className={`${directionColorClass} ${styles.tradesCellRight}`}>
                      {formatTradeEthAmount(trade.nativeAmountRaw)}
                    </span>
                    <a
                      className={`${styles.faintText} ${styles.tradesCellRight}`}
                      href={`${explorerTxBaseUrl}${trade.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {formatTimeAgoSeconds(trade.blockTimestamp)}
                    </a>
                  </div>
                );
              })}
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
        ) : tab === "hoodchat" ? (
          <TokenChatPanel chain={chain} address={address} symbol={symbol} holders={holders} />
        ) : (
          <div className={styles.aboutPanel}>
            <p className={styles.storyText}>No description has been published for this token yet.</p>
            <div className={styles.storyTags}>
              <span className={styles.storyTag}>Bonding curve launch</span>
              <span className={styles.storyTag}>{chainShortLabel}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
