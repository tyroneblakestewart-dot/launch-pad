"use client";

import type { Address } from "viem";
import { DEFAULT_TOKEN_DECIMALS } from "@/lib/bonding-curve-deploy-config";
import { useTokenCurveStatus } from "@/lib/use-token-curve-status";
import { useTokenTrades } from "@/lib/use-token-trades";
import { TokenCenterColumn } from "./token-center-column";
import { TokenHeaderBand } from "./token-header-band";
import { TokenLeftColumn } from "./token-left-column";
import type { TokenLaunch } from "@/lib/server/token-launches-store";
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
  /** The token_launches row for this token, or null when it wasn't launched through the Hoodlums curve pipeline (issue #443 part 1). Drives header artwork/name/launch-age and the Stats panel's audit verification. */
  launch: TokenLaunch | null;
};

/**
 * Token page v2 (issue #443 part 1): a full-width header band (identity,
 * graduation, the price/mcap toggle) followed by a two-column grid — swap +
 * Stats/Audit + creator fees on the left, the live chart and its tabs
 * (Recent trades / Holders / Hoodchat / About) filling the rest. Replaces
 * the old three-column desktop layout (issue #429) and its separate
 * identity/right columns entirely.
 *
 * A client component (issue #444): the header band, Stats/Audit panel and
 * centre column previously each ran their own independent `useTokenTrades`
 * poll, and the header band and swap panel each ran their own independent
 * curve-status poll — six 12s pollers total against the same two data
 * sources on one page. Both polls are now called exactly once, here, and
 * `trades`/`tradesError`/`curveStatus` are passed down as props to every
 * consumer, so the whole page shares one `/api/token-trades` poll and one
 * on-chain curve read.
 */
export function TokenPageView({ chain, address, chainInfo, marketStats, tradeLinks, curveAddress, launch }: TokenPageViewProps) {
  const decimals = marketStats.supported && marketStats.decimals !== null ? marketStats.decimals : DEFAULT_TOKEN_DECIMALS;
  const { status: curveStatus } = useTokenCurveStatus(address, curveAddress, decimals);
  const { trades, error: tradesError, stale: tradesStale, retry: retryTrades, lastPollAtRef: tradesLastPollAtRef } =
    useTokenTrades(curveAddress);
  const startingPriceNativePerToken = curveStatus.kind === "ready" ? curveStatus.startingPriceNativePerToken : null;
  // Caps the chart's pre-trade whitespace padding (issue #458 item 5) — only
  // known for a token launched through the recorded curve pipeline.
  const launchedAtUnixSeconds = launch ? Math.floor(new Date(launch.launchedAt).getTime() / 1000) : null;
  // The same ticker the header band shows (launch record first, Blockscout
  // second) so the swap CTA's "Buy $TICKER" can never disagree with it.
  const ticker = launch?.ticker || (marketStats.supported && marketStats.symbol) || null;

  return (
    <main className={`${styles.page} token-page-full-screen`}>
      <div className={styles.shell}>
        <TokenHeaderBand
          address={address}
          chainInfo={chainInfo}
          marketStats={marketStats}
          launch={launch}
          decimals={decimals}
          curveStatus={curveStatus}
          trades={trades}
          tradesError={tradesError}
        />

        {/* Every panel below is a direct grid item of `.grid` — no
            per-column wrapper divs (issue #429's pattern, kept here) —
            because the mobile stacking order (swap → chart → stats → tabs)
            still has to interleave the chart between panels that share a
            desktop column; column placement is resolved entirely in CSS
            via `grid-column`/`grid-row` and `order` on each panel's own
            class (issue #450). */}
        <div className={styles.grid}>
          <TokenLeftColumn
            chainId={chain}
            address={address}
            marketStats={marketStats}
            tradeLinks={tradeLinks}
            factoryMinted={Boolean(launch)}
            curveStatus={curveStatus}
            trades={trades}
            ticker={ticker}
          />

          <TokenCenterColumn
            chain={chain}
            address={address}
            marketStats={marketStats}
            chainShortLabel={chainInfo.shortLabel}
            explorerBaseUrl={chainInfo.explorerBaseUrl}
            trades={trades}
            tradesError={tradesError}
            tradesStale={tradesStale}
            retryTrades={retryTrades}
            tradesLastPollAtRef={tradesLastPollAtRef}
            startingPriceNativePerToken={startingPriceNativePerToken}
            launchedAtUnixSeconds={launchedAtUnixSeconds}
          />
        </div>
      </div>
    </main>
  );
}
