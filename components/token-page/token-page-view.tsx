import Link from "next/link";
import type { Address } from "viem";
import { TokenCenterColumn } from "./token-center-column";
import { TokenLeftColumn } from "./token-left-column";
import { TokenRightColumn } from "./token-right-column";
import type { TokenMarketStats } from "@/lib/server/token-market-stats";
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
 * (issue #225): a three-column desktop grid — identity+swap / chart+activity
 * / trade terminals+about+chat — that stacks to a single column on mobile,
 * with the swap panel replaced by a sticky bottom bar below 880px (handled
 * in `token-page.module.css`, matching the design reference's own
 * `.hd-swap` / `.hd-mobilebar` breakpoint). A server component: the only
 * interactive pieces (copy button, swap panel, chart tabs) are isolated in
 * their own client-only children.
 */
export function TokenPageView({ chain, address, chainInfo, marketStats, tradeLinks, curveAddress }: TokenPageViewProps) {
  const name = (marketStats.supported && marketStats.name) || `${address.slice(0, 6)}…${address.slice(-4)}`;
  const symbol = marketStats.supported && marketStats.symbol ? marketStats.symbol : null;
  const dexPairUrl = marketStats.supported && marketStats.chart.found ? marketStats.chart.pairUrl : null;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <Link href="/" className={styles.backLink} aria-label="Back">
              ←
            </Link>
            <div className={styles.titleRow}>
              <h1 className={styles.tokenName}>{name}</h1>
              {symbol ? <span className={styles.tokenTicker}>${symbol}</span> : null}
              <span className={styles.liveBadge}>
                <span className={styles.liveDot} />
                Live
              </span>
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

        <div className={styles.grid}>
          <div className={styles.left}>
            <TokenLeftColumn
              chainId={chain}
              address={address}
              marketStats={marketStats}
              curveAddress={curveAddress}
              tradeLinks={tradeLinks}
            />
          </div>

          <div className={styles.center}>
            <TokenCenterColumn address={address} marketStats={marketStats} />
          </div>

          <div className={styles.right}>
            <TokenRightColumn tradeLinks={tradeLinks} />
          </div>
        </div>
      </div>
    </main>
  );
}
