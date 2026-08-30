"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { tradeSpotPriceNativePerToken } from "@/lib/candle-bucketing";
import { formatGraduationRemainingLabel, formatGraduationSummary } from "@/lib/bonding-curve-status";
import type { TokenLaunch } from "@/lib/server/token-launches-store";
import type { TokenMarketStats } from "@/lib/server/token-market-stats";
import type { TokenTrade } from "@/lib/token-trade-types";
import {
  formatHolderCount,
  formatLaunchAge,
  formatNativeAmountSixSigFigsTrimmed,
  formatNativePriceSixSigFigs,
  formatSignedPercent,
} from "@/lib/token-page-format";
import type { TokenCurveStatus } from "@/lib/use-token-curve-status";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import styles from "./token-page.module.css";

type ChainInfo = { shortLabel: string; explorerBaseUrl: string };

export type TokenHeaderBandProps = {
  address: string;
  chainInfo: ChainInfo;
  marketStats: TokenMarketStats;
  launch: TokenLaunch | null;
  decimals: number;
  curveStatus: TokenCurveStatus;
  trades: TokenTrade[] | null;
  tradesError: string | null;
};

/**
 * Full-width header band replacing the old `.topbar` (issue #443 part 1):
 * artwork, identity, graduation and the price/mcap toggle in one row.
 * Receives `curveStatus` and `trades`/`tradesError` as props from
 * `token-page-view.tsx` (issue #444) rather than polling either on its
 * own — the page calls `useTokenCurveStatus`/`useTokenTrades` exactly once
 * and shares the result with this component, the swap panel and the
 * Stats/Audit panel, so the header and the rest of the page can never show
 * a momentarily different last price between polls. The price/mcap toggle
 * and the change pill both derive from `tradeSpotPriceNativePerToken`
 * (lib/candle-bucketing.ts) over the exact same trades array — the one
 * shared price source the issue requires.
 */
export function TokenHeaderBand({
  address,
  chainInfo,
  marketStats,
  launch,
  decimals,
  curveStatus,
  trades,
  tradesError,
}: TokenHeaderBandProps) {
  const [mode, setMode] = useState<"price" | "mcap">("price");
  const [account, setAccount] = useState<Address | null>(null);

  useEffect(() => {
    let cancelled = false;
    const provider = getInjectedEvmProvider();
    if (!provider) return;
    provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        if (!cancelled && Array.isArray(accounts) && accounts[0]) setAccount(accounts[0] as Address);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const displayName = launch?.tokenName || (marketStats.supported && marketStats.name) || `${address.slice(0, 6)}…${address.slice(-4)}`;
  const ticker = launch?.ticker || (marketStats.supported && marketStats.symbol) || null;
  const holderCountLabel = `${formatHolderCount(marketStats.supported ? marketStats.holderCount : null)} HOLDERS`;
  const launchAgeLabel = formatLaunchAge(launch?.launchedAt ?? null);

  const isCreator =
    curveStatus.kind === "ready" && account !== null && account.toLowerCase() === curveStatus.creator.toLowerCase();
  const showDropArt = isCreator && !launch?.artworkThumbnail;
  const tradingOpen = curveStatus.kind === "ready" && curveStatus.graduation.state === "bonding";

  // A load that has never once succeeded — distinct from "no trades yet",
  // which is a legitimate zero-activity state, not an error.
  const hasLoadError = Boolean(tradesError) && trades === null;
  const orderedTrades = trades ?? [];

  const lastTrade = orderedTrades.length > 0 ? orderedTrades[0] : null;
  const lastPrice = hasLoadError
    ? null
    : lastTrade
      ? tradeSpotPriceNativePerToken(lastTrade, decimals)
      : curveStatus.kind === "ready"
        ? curveStatus.startingPriceNativePerToken
        : null;

  const totalSupplyWhole = curveStatus.kind === "ready" ? Number(formatUnits(curveStatus.totalSupplyRaw, decimals)) : null;
  const marketCapNative = lastPrice !== null && totalSupplyWhole !== null ? lastPrice * totalSupplyWhole : null;

  const bigFigure =
    mode === "price"
      ? `${formatNativePriceSixSigFigs(lastPrice)} ETH`
      : `${formatNativeAmountSixSigFigsTrimmed(marketCapNative)} ETH`;
  const modeLabel = mode === "price" ? "PRICE · TAP FOR MCAP" : "MCAP · TAP FOR PRICE";

  // Change over the trades currently loaded — this design's chart has no
  // separate "loaded range" concept beyond its own frozen candle-interval
  // selector (part 2's scope), so "loaded range" here means the full
  // useTokenTrades history, oldest vs newest.
  const changePercent = (() => {
    if (hasLoadError || orderedTrades.length < 2) return 0;
    const oldest = orderedTrades[orderedTrades.length - 1];
    const newest = orderedTrades[0];
    const oldestPrice = tradeSpotPriceNativePerToken(oldest, decimals);
    const newestPrice = tradeSpotPriceNativePerToken(newest, decimals);
    if (oldestPrice <= 0) return 0;
    return ((newestPrice - oldestPrice) / oldestPrice) * 100;
  })();
  const changeLabel = hasLoadError ? "—%" : formatSignedPercent(changePercent, 2);
  const changeUp = changePercent >= 0;

  const poolAddress = curveStatus.kind === "ready" ? curveStatus.graduation.liquidityPool : null;

  return (
    <header className={styles.headerBand}>
      <Link href="/" className={styles.backLink} aria-label="Back to homepage">
        ←
      </Link>

      <div className={styles.headerArtworkTile}>
        {launch?.artworkThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={launch.artworkThumbnail} alt="" className={styles.headerArtworkImage} />
        ) : (
          <span className={styles.headerArtworkInitial}>{displayName.charAt(0).toUpperCase()}</span>
        )}
      </div>

      <div className={styles.headerIdentity}>
        <div className={styles.headerTitleRow}>
          <span className={styles.headerName}>{displayName}</span>
          {ticker ? <span className={styles.headerTicker}>${ticker}</span> : null}
          {tradingOpen ? (
            <span className={styles.liveBadge}>
              <span className={styles.liveDot} />
              Live
            </span>
          ) : null}
        </div>
        {showDropArt ? (
          <button type="button" className={styles.headerDropArt}>
            Drop art
          </button>
        ) : (
          <div className={styles.headerMetaRow}>
            <span>{holderCountLabel}</span>
            <span className={styles.headerMetaDot} />
            <span>LAUNCHED {launchAgeLabel}</span>
            <span className={styles.headerMetaDot} />
            <span className={styles.chainBadge}>{chainInfo.shortLabel}</span>
          </div>
        )}
      </div>

      <div className={styles.headerGraduation}>
        <div className={styles.headerGraduationTop}>
          <span className={styles.headerGraduationLabel}>Graduation</span>
          <span className={styles.headerGraduationValue}>
            {curveStatus.kind === "ready"
              ? formatGraduationSummary(
                  curveStatus.graduation.raisedWei,
                  curveStatus.graduation.targetWei,
                  curveStatus.graduation.progressBps,
                )
              : "—"}
          </span>
        </div>
        <div className={styles.track}>
          <div
            className={styles.fill}
            style={{ width: `${curveStatus.kind === "ready" ? Number(curveStatus.graduation.progressBps) / 100 : 0}%` }}
          />
        </div>
        <span className={styles.headerGraduationRemaining}>
          {curveStatus.kind === "ready"
            ? curveStatus.graduation.state === "graduated"
              ? "Graduated"
              : formatGraduationRemainingLabel(curveStatus.remainingToGraduateWei)
            : "— ETH remaining"}
        </span>
      </div>

      <div className={styles.headerFigureBlock}>
        <div className={styles.headerFigureRow}>
          <button
            type="button"
            className={styles.headerFigureToggle}
            onClick={() => setMode((current) => (current === "price" ? "mcap" : "price"))}
            title="Switch between price and market cap"
          >
            <span className={styles.headerFigureLabel}>{modeLabel}</span>
            <span className={styles.headerFigureValue}>{bigFigure}</span>
          </button>
          <span className={`${styles.priceChange} ${changeUp ? styles.priceChangeUp : styles.priceChangeDown}`}>
            {changeLabel}
          </span>
        </div>
        <div className={styles.headerLinkChips}>
          <a className={styles.headerLinkChip} href={`${chainInfo.explorerBaseUrl}${address}`} target="_blank" rel="noreferrer">
            Contract ↗
          </a>
          {poolAddress ? (
            <a className={styles.headerLinkChip} href={`${chainInfo.explorerBaseUrl}${poolAddress}`} target="_blank" rel="noreferrer">
              Pool ↗
            </a>
          ) : (
            <span className={styles.headerLinkChipDisabledGroup}>
              <span className={`${styles.headerLinkChip} ${styles.headerLinkChipDisabled}`}>Pool ↗</span>
              <span className={styles.headerLinkChipNote}>after graduation</span>
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
