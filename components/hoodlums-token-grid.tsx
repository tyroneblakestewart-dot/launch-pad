"use client";

import { useState } from "react";
import { formatGraduationProgressPercent } from "@/lib/bonding-curve-status";
import type { PublicGeneratedSite } from "@/lib/public-site";
import type { TokenLaunchGridFilter, TokenLaunchListItem } from "@/lib/token-launch-view";
import { useTokenLaunches } from "@/lib/use-token-launches";
import { requestWorkspaceOpen } from "@/lib/workspace-open-request";
import { TokenGridCardChart } from "./token-grid-card-chart";
import styles from "./hoodlums-token-grid.module.css";

type Tab = "bonding" | "graduated" | "new";

const TABS: { key: Tab; label: string }[] = [
  { key: "new", label: "New" },
  { key: "bonding", label: "Bonding" },
  { key: "graduated", label: "Graduated" },
];

const TAB_TO_FILTER: Record<Tab, TokenLaunchGridFilter> = {
  new: "all",
  bonding: "bonding",
  graduated: "graduated",
};

function progressPercentLabel(launch: TokenLaunchListItem): string {
  if (launch.graduated) return "100%";
  if (!launch.progressBps) return "—";
  try {
    return formatGraduationProgressPercent(BigInt(launch.progressBps));
  } catch {
    return "—";
  }
}

function progressWidthPercent(launch: TokenLaunchListItem): number {
  if (launch.graduated) return 100;
  if (!launch.progressBps) return 0;
  try {
    return Number(BigInt(launch.progressBps)) / 100;
  } catch {
    return 0;
  }
}

function cardHref(launch: TokenLaunchListItem): string {
  if (launch.siteSlug) return `/${launch.siteSlug}`;
  return `/token/robinhood/${launch.tokenAddress}`;
}

/**
 * HOODLUMS TOKENS grid (issue #412 Part 1): reads from token_launches — the
 * real on-chain record — instead of published_sites, and polls live
 * (lib/use-token-launches.ts) so a token's graduation progress and status
 * update without a manual refresh. `liveSites` (the legacy published-site
 * list) is kept only to make the truly-empty state honest: a saved site with
 * no recorded on-chain launch is a different, more specific situation than
 * no activity at all, and gets its own copy pointing at the studio instead
 * of the generic "be the first" pitch — never to fabricate cards from it;
 * every rendered card's data now comes from a real recorded launch.
 */
export function HoodlumsTokenGrid({ liveSites }: { liveSites: PublicGeneratedSite[] }) {
  const [tab, setTab] = useState<Tab>("new");
  const { launches, error } = useTokenLaunches(TAB_TO_FILTER[tab]);

  function handleCreateTokenClick() {
    requestWorkspaceOpen("new");
  }

  const isLoading = launches === null && !error;
  const hasUnlaunchedSites = liveSites.length > 0;

  return (
    <section className={styles.section} aria-labelledby="hoodlums-tokens-title">
      <div className={styles.sectionHeader}>
        <p id="hoodlums-tokens-title" className={styles.eyebrow}>
          HOODLUMS TOKENS
        </p>
        <div className={styles.headerActions}>
          <div className={styles.tabs} role="tablist" aria-label="Token grid filter">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                className={tab === item.key ? styles.tabActive : styles.tab}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button type="button" className={styles.createTokenButton} onClick={handleCreateTokenClick}>
            Create token
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className={styles.emptyState}>
          <p>Loading tokens…</p>
        </div>
      ) : error && !launches ? (
        <div className={styles.emptyState}>
          <p>{error}</p>
        </div>
      ) : !launches || launches.length === 0 ? (
        <div className={styles.emptyState}>
          <p>
            {tab === "graduated"
              ? "No tokens have graduated yet."
              : hasUnlaunchedSites
                ? "No Hoodlums tokens on the curve yet — finish launching a saved site from the studio to open its bonding market."
                : "No Hoodlums tokens on the curve yet. Be the first — create a token and open its bonding market."}
          </p>
          <a href="#launch-studio" className={styles.emptyCta}>
            Create new token →
          </a>
        </div>
      ) : (
        <div className={styles.grid}>
          {launches.map((launch) => (
            <a key={launch.id} href={cardHref(launch)} className={styles.card}>
              <TokenGridCardChart tokenName={launch.tokenName} curveAddress={launch.curveAddress} />
              <b className={styles.cardName}>{launch.tokenName}</b>
              <span className={styles.cardTicker}>${launch.ticker}</span>
              <b className={styles.cardCap}>—</b>
              <span className={styles.cardCapLabel}>Market cap</span>
              <div className={styles.gradRow}>
                <span>{launch.graduated ? "Graduated" : "Graduation"}</span>
                <b>{progressPercentLabel(launch)}</b>
              </div>
              <div className={styles.gradBar}>
                <span style={{ width: `${progressWidthPercent(launch)}%` }} />
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
