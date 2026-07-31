"use client";

import { useState } from "react";
import type { PublicGeneratedSite } from "@/lib/public-site";
import styles from "./hoodlums-token-grid.module.css";

export type TokenGridTab = "bonding" | "graduated" | "new";

export const TOKEN_GRID_TABS: { key: TokenGridTab; label: string }[] = [
  { key: "bonding", label: "Bonding" },
  { key: "graduated", label: "Graduated" },
  { key: "new", label: "New" },
];

const NEW_TAB_LIMIT = 8;

/**
 * Pure tab filter, exported for tests. Nothing has graduated yet (the
 * bonding curve isn't deployed — issue #185), so "Graduated" is always
 * empty rather than showing fabricated data.
 */
export function filterTokensForTab(
  tokens: PublicGeneratedSite[],
  tab: TokenGridTab,
): PublicGeneratedSite[] {
  if (tab === "graduated") return [];
  if (tab === "new") return tokens.slice(0, NEW_TAB_LIMIT);
  return tokens;
}

function TokenArtwork({ token }: { token: PublicGeneratedSite }) {
  if (token.heroImage) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={token.heroImage} alt="" className={styles.artwork} />;
  }
  return (
    <span className={styles.artworkFallback} aria-hidden="true">
      {token.name.slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

export function HoodlumsTokenGrid({
  tokens,
  onCreateToken,
}: {
  tokens: PublicGeneratedSite[];
  onCreateToken: () => void;
}) {
  const [tab, setTab] = useState<TokenGridTab>("bonding");
  const visible = filterTokensForTab(tokens, tab);

  return (
    <section className={styles.section} aria-labelledby="hoodlums-tokens-title">
      <div className={styles.header}>
        <p id="hoodlums-tokens-title" className={styles.label}>
          HOODLUMS TOKENS
        </p>
        <div className={styles.tabs} role="tablist" aria-label="Filter Hoodlums tokens">
          {TOKEN_GRID_TABS.map((item) => (
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
      </div>

      {tokens.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No Hoodlums tokens on the curve yet.</p>
          <p>Be the first — create a token and open its bonding market.</p>
          <button type="button" onClick={onCreateToken}>
            Create new token →
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.length === 0 && <p className={styles.tabEmpty}>Nothing here yet.</p>}
          {visible.map((token) => (
            <article key={token.slug} className={styles.card}>
              <div className={styles.artworkArea}>
                <TokenArtwork token={token} />
              </div>
              <div className={styles.cardBody}>
                <b className={styles.name}>{token.name}</b>
                <span className={styles.ticker}>${token.ticker}</span>
                <span className={styles.marketCap}>—</span>
                <span className={styles.marketCapLabel}>Market cap · pending curve</span>
                <div className={styles.graduationRow}>
                  <span>Graduation</span>
                  <span>0%</span>
                </div>
                <div className={styles.graduationBar}>
                  <i style={{ width: "0%" }} />
                </div>
              </div>
            </article>
          ))}
          <button type="button" className={styles.beNextCard} onClick={onCreateToken}>
            <span className={styles.beNextIcon}>+</span>
            <b>Be next</b>
            <span className={styles.beNextAction}>Create token</span>
          </button>
        </div>
      )}
    </section>
  );
}
