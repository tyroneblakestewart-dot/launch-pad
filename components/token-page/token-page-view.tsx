import Link from "next/link";
import type { Address } from "viem";
import { TokenCenterColumn } from "./token-center-column";
import { TokenLeftColumn } from "./token-left-column";
import { TokenRightColumn } from "./token-right-column";
import type { TokenMarketStats } from "@/lib/server/token-market-stats";
import { formatPriceChange, formatUsdPrice } from "@/lib/token-page-format";
import type { TradeTerminalLink } from "@/lib/trade-terminal-links";
import type { SupportedChain } from "@/lib/types";
import styles from "./token-page.module.css";

type ChainInfo = {
  label: string;
  shortLabel: string;
  explorerLabel: string;
  explorerBaseUrl: string;
};

export type TokenPageViewProps = {
  chain: SupportedChain;
  address: string;
  chainInfo: ChainInfo;
  marketStats: TokenMarketStats;
  tradeLinks: TradeTerminalLink[];
  curveAddress: Address | null;
};

/**
 * Full pixel-accurate layout from public/design-refs/hoodlums-token-page.html
 * (issue #225), reworked mobile-first for issue #427 and rearranged for
 * desktop by issue #429: a three-column desktop grid — sticky swap+creator-
 * fee column (left) / future-chart-slot+activity (centre, activity includes
 * the Hoodchat tab from issue #237) / identity card+about (right) — that
 * stacks to a single column on mobile with the swap panel pulled immediately
 * after the identity+price header via CSS `order` (`token-page.module.css`),
 * replacing the old below-880px sticky bottom bar so the full trade panel —
 * not a compact bar — is what's "immediately visible" on a phone. A server
 * component: the only interactive pieces (copy button, swap panel, chart
 * tabs) are isolated in their own client-only children.
 */
export function TokenPageView({ chain, address, chainInfo, marketStats, tradeLinks, curveAddress }: TokenPageViewProps) {
  const name = (marketStats.supported && marketStats.name) || `${address.slice(0, 6)}…${address.slice(-4)}`;
  const symbol = marketStats.supported && marketStats.symbol ? marketStats.symbol : null;
  const dexPairUrl = marketStats.supported && marketStats.chart.found ? marketStats.chart.pairUrl : null;
  const priceUsd = marketStats.supported ? marketStats.priceUsd : null;
  const priceChange = formatPriceChange(marketStats.supported ? marketStats.priceChange24hPercent : null);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <Link href="/" className={styles.backLink} aria-label="Back">
              ←
            </Link>
            <div className={styles.topbarIdentity}>
              <div className={styles.titleRow}>
                <h1 className={styles.tokenName}>{name}</h1>
                {symbol ? <span className={styles.tokenTicker}>${symbol}</span> : null}
                <span className={styles.liveBadge}>
                  <span className={styles.liveDot} />
                  Live
                </span>
              </div>
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
          <div className={styles.topbarLinks}>
            <a
              href={dexPairUrl || `https://dexscreener.com/search?q=${encodeURIComponent(address)}`}
              target="_blank"
              rel="noreferrer"
              className={styles.topbarLink}
            >
              Dexscreener ↗
            </a>
            <a
              href={`${chainInfo.explorerBaseUrl}${address}`}
              target="_blank"
              rel="noreferrer"
              className={styles.topbarLink}
            >
              Contract ↗
            </a>
            {marketStats.supported && marketStats.lpAddress ? (
              <a
                href={`${chainInfo.explorerBaseUrl}${marketStats.lpAddress}`}
                target="_blank"
                rel="noreferrer"
                className={styles.topbarLink}
              >
                Pool ↗
              </a>
            ) : null}
          </div>
        </header>

        {/* Every panel below is a direct grid item of `.grid` (issue #429) —
            no per-column wrapper divs — because the desktop rearrangement
            (identity+about moved to the right column, swap+fees kept on the
            left) still has to interleave the identity panel between the
            swap and creator-fee panels on mobile (#427's required order).
            A nested flex column per side can only reorder items within its
            own box; it can't place a panel in a different visual column at
            a wider breakpoint without moving markup between components, so
            column placement is resolved entirely in CSS via `grid-column`
            and `order` on each panel's own class. */}
        <div className={styles.grid}>
          <TokenLeftColumn
            chainId={chain}
            address={address}
            marketStats={marketStats}
            curveAddress={curveAddress}
            tradeLinks={tradeLinks}
          />

          <TokenCenterColumn
            chain={chain}
            address={address}
            marketStats={marketStats}
            curveAddress={curveAddress}
            explorerBaseUrl={chainInfo.explorerBaseUrl}
          />

          <TokenRightColumn tradeLinks={tradeLinks} />
        </div>
      </div>
    </main>
  );
}
