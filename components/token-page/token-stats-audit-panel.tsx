"use client";

import { useState } from "react";
import type { Address } from "viem";
import {
  computeTradeWindowStats,
  computeTotalFeesNative,
  nowUnixSeconds,
  TRADE_STATS_WINDOWS,
  TRADE_STATS_WINDOW_SECONDS,
  type TradeStatsWindowKey,
} from "@/lib/token-trade-stats";
import { formatHolderCount, formatNativeFixed, formatSignedPercent } from "@/lib/token-page-format";
import { useTokenTrades } from "@/lib/use-token-trades";
import styles from "./token-page.module.css";

type StatsTab = "stats" | "audit";

const WINDOW_LABELS: Record<TradeStatsWindowKey, string> = { "5m": "5M", "1h": "1H", "24h": "24H" };

const AUDIT_ROWS = ["0% tax", "No mint function", "No owner", "LP locked at graduation"];

function sharePercent(a: number, b: number): { left: number; right: number } {
  const total = a + b;
  if (total <= 0) return { left: 0, right: 0 };
  return { left: (a / total) * 100, right: (b / total) * 100 };
}

export type TokenStatsAuditPanelProps = {
  curveAddress: Address | null;
  decimals: number;
  holderCount: number | null;
  /** Whether this token was minted by the Hoodlums factory — false shows the unverified/dimmed audit treatment. */
  factoryMinted: boolean;
};

/**
 * New Stats/Audit panel (issue #443 part 1 item 5), sharing its own
 * `useTokenTrades` poll — see lib/use-token-curve-status.ts's doc comment
 * for why each token page v2 panel owns an independent copy rather than a
 * lifted shared fetch. All paired-row math is the pure, unit-tested
 * `lib/token-trade-stats.ts`, filtered by the panel's own 5M/1H/24H
 * selector (distinct from the chart's own timeframe rail).
 */
export function TokenStatsAuditPanel({ curveAddress, decimals, holderCount, factoryMinted }: TokenStatsAuditPanelProps) {
  const { trades } = useTokenTrades(curveAddress);
  const [tab, setTab] = useState<StatsTab>("stats");
  const [windowKey, setWindowKey] = useState<TradeStatsWindowKey>("24h");
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const loadedTrades = trades ?? [];
  const stats = computeTradeWindowStats(loadedTrades, TRADE_STATS_WINDOW_SECONDS[windowKey], decimals, nowUnixSeconds());
  const totalFeesNative = computeTotalFeesNative(loadedTrades);

  const buysSellsShare = sharePercent(stats.buys, stats.sells);
  const volShare = sharePercent(stats.buyVolumeNative, stats.sellVolumeNative);
  const buyersSellersShare = sharePercent(stats.buyers, stats.sellers);
  const changeShare = sharePercent(Math.max(stats.priceChangePercent, 0), Math.max(-stats.priceChangePercent, 0));

  const pairs: {
    key: string;
    leftLabel: string;
    leftValue: string;
    leftUp: boolean;
    rightLabel: string;
    rightValue: string;
    share: { left: number; right: number };
  }[] = [
    {
      key: "price-volume",
      leftLabel: "PRICE CHANGE",
      leftValue: formatSignedPercent(stats.priceChangePercent, 1),
      leftUp: stats.priceChangePercent >= 0,
      rightLabel: "VOLUME",
      rightValue: `${formatNativeFixed(stats.volumeNative, 1)} ETH`,
      share: changeShare,
    },
    {
      key: "buys-sells",
      leftLabel: "BUYS",
      leftValue: stats.buys.toLocaleString("en-US"),
      leftUp: true,
      rightLabel: "SELLS",
      rightValue: stats.sells.toLocaleString("en-US"),
      share: buysSellsShare,
    },
    {
      key: "vol",
      leftLabel: "BUY VOL",
      leftValue: `${formatNativeFixed(stats.buyVolumeNative, 1)} ETH`,
      leftUp: true,
      rightLabel: "SELL VOL",
      rightValue: `${formatNativeFixed(stats.sellVolumeNative, 1)} ETH`,
      share: volShare,
    },
    {
      key: "buyers-sellers",
      leftLabel: "BUYERS",
      leftValue: stats.buyers.toLocaleString("en-US"),
      leftUp: true,
      rightLabel: "SELLERS",
      rightValue: stats.sellers.toLocaleString("en-US"),
      share: buyersSellersShare,
    },
  ];

  const holdersLabel = formatHolderCount(holderCount);

  return (
    <div className={`${styles.panel} ${styles.statsPanel}`}>
      <div className={styles.statsPanelHeader}>
        <div className={styles.tabGroup}>
          <button
            type="button"
            className={`${styles.pillButton} ${tab === "stats" ? styles.pillButtonActive : ""}`}
            onClick={() => setTab("stats")}
          >
            Stats
          </button>
          <button
            type="button"
            className={`${styles.pillButton} ${tab === "audit" ? styles.pillButtonActive : ""}`}
            onClick={() => setTab("audit")}
          >
            Audit
          </button>
        </div>
        {tab === "stats" && (
          <div className={styles.statsWindowGroup} role="group" aria-label="Stats window">
            {TRADE_STATS_WINDOWS.map((key) => (
              <button
                key={key}
                type="button"
                className={`${styles.chartIntervalButton} ${windowKey === key ? styles.chartIntervalButtonActive : ""}`}
                onClick={() => setWindowKey(key)}
              >
                {WINDOW_LABELS[key]}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "stats" ? (
        <div className={styles.statsBody}>
          {pairs.map((pair) => (
            <div key={pair.key} className={styles.statsPairRow}>
              <div className={styles.statsPairSide}>
                <span className={styles.statsPairLabel}>{pair.leftLabel}</span>
                <span className={pair.key === "price-volume" && !pair.leftUp ? styles.statsPairValueDown : styles.statsPairValueLime}>
                  {pair.leftValue}
                </span>
              </div>
              <div className={`${styles.statsPairSide} ${styles.statsPairSideRight}`}>
                <span className={styles.statsPairLabel}>{pair.rightLabel}</span>
                <span className={styles.statsPairValueNeutral}>{pair.rightValue}</span>
              </div>
              <div className={styles.statsSplitBarTrack}>
                <span className={styles.statsSplitBarLeft} style={{ width: `${pair.share.left}%` }} />
                <span className={styles.statsSplitBarRight} style={{ width: `${pair.share.right}%` }} />
              </div>
            </div>
          ))}

          <div className={styles.holderBreakdown}>
            <button
              type="button"
              className={styles.holderBreakdownHeader}
              onClick={() => setBreakdownOpen((current) => !current)}
              aria-expanded={breakdownOpen}
            >
              <span className={styles.statsPairLabel}>HOLDER BREAKDOWN</span>
              <span className={styles.holderBreakdownSummary}>
                <span>{holdersLabel}</span>
                <span className={breakdownOpen ? styles.chevronOpen : styles.chevron}>⌄</span>
              </span>
            </button>
            {breakdownOpen && (
              <div className={styles.holderBreakdownRows}>
                <div className={styles.holderBreakdownRow}>
                  <span className={styles.statsPairLabel}>HOLDERS</span>
                  <span className={styles.statsPairValueNeutral}>{holdersLabel}</span>
                </div>
                <div className={styles.holderBreakdownRow}>
                  <span className={styles.statsPairLabel}>TOP 10 %</span>
                  <span className={styles.statsPairValueNeutral}>—</span>
                </div>
                <div className={styles.holderBreakdownRow}>
                  <span className={styles.statsPairLabel}>DEV %</span>
                  <span className={styles.statsPairValueNeutral}>—</span>
                </div>
                <div className={styles.holderBreakdownRow} title="Wallets that bought within the first 10 blocks after launch">
                  <span className={styles.statsPairLabel}>SNIPERS % ⓘ</span>
                  <span className={styles.statsPairValueNeutral}>—</span>
                </div>
                <div className={styles.holderBreakdownRow}>
                  <span className={styles.statsPairLabel}>TOTAL FEES</span>
                  <span className={styles.statsPairValueNeutral}>{formatNativeFixed(totalFeesNative, 2)} ETH</span>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.auditBody}>
          {AUDIT_ROWS.map((row) => (
            <div key={row} className={`${styles.auditRow} ${factoryMinted ? "" : styles.auditRowUnverified}`}>
              <span className={factoryMinted ? styles.auditCheck : styles.auditDash}>{factoryMinted ? "✓" : "–"}</span>
              <span>{row}</span>
            </div>
          ))}
          <span className={styles.mutedNote}>
            {factoryMinted ? "Guaranteed by the Hoodlums factory contract" : "Unverified — this token has no recorded factory launch"}
          </span>
        </div>
      )}
    </div>
  );
}
