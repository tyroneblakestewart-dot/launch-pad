import type { Address } from "viem";
import { DEFAULT_TOKEN_DECIMALS } from "@/lib/bonding-curve-deploy-config";
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
 * identity/right columns entirely; a server component, since the only
 * interactive pieces (header band, swap panel, stats panel, chart/tabs) are
 * isolated in their own client-only children.
 */
export function TokenPageView({ chain, address, chainInfo, marketStats, tradeLinks, curveAddress, launch }: TokenPageViewProps) {
  const decimals = marketStats.supported && marketStats.decimals !== null ? marketStats.decimals : DEFAULT_TOKEN_DECIMALS;

  return (
    <main className={`${styles.page} token-page-full-screen`}>
      <div className={styles.shell}>
        <TokenHeaderBand
          address={address}
          chainInfo={chainInfo}
          curveAddress={curveAddress}
          marketStats={marketStats}
          launch={launch}
          decimals={decimals}
        />

        {/* Every panel below is a direct grid item of `.grid` — no
            per-column wrapper divs (issue #429's pattern, kept here) —
            because the mobile stacking order (swap → chart → stats → tabs)
            still has to interleave the chart between panels that share a
            desktop sticky column; column placement is resolved entirely in
            CSS via `grid-column` and `order` on each panel's own class. */}
        <div className={styles.grid}>
          <TokenLeftColumn
            chainId={chain}
            address={address}
            marketStats={marketStats}
            curveAddress={curveAddress}
            tradeLinks={tradeLinks}
            factoryMinted={Boolean(launch)}
          />

          <TokenCenterColumn
            chain={chain}
            address={address}
            marketStats={marketStats}
            curveAddress={curveAddress}
            chainShortLabel={chainInfo.shortLabel}
            explorerBaseUrl={chainInfo.explorerBaseUrl}
          />
        </div>
      </div>
    </main>
  );
}
