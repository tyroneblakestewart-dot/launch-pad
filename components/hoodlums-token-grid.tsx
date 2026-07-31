"use client";

import { useState } from "react";
import type { PublicGeneratedSite } from "@/lib/public-site";
import styles from "./hoodlums-token-grid.module.css";

type Tab = "bonding" | "graduated" | "new";

const TABS: { key: Tab; label: string }[] = [
  { key: "bonding", label: "Bonding" },
  { key: "graduated", label: "Graduated" },
  { key: "new", label: "New" },
];

function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function HoodlumsTokenGrid({ liveSites }: { liveSites: PublicGeneratedSite[] }) {
  const [tab, setTab] = useState<Tab>("bonding");

  // The bonding curve isn't deployed yet (issue #185), so every live site is
  // an honest "bonding" / "new" token at 0% graduation. "Graduated" stays
  // empty rather than faking a graduated state that can't exist yet.
  const visibleSites = tab === "graduated" ? [] : liveSites;

  return (
    <section className={styles.section} aria-labelledby="hoodlums-tokens-title">
      <div className={styles.sectionHeader}>
        <p id="hoodlums-tokens-title" className={styles.eyebrow}>
          HOODLUMS TOKENS
        </p>
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
      </div>

      {visibleSites.length === 0 ? (
        <div className={styles.emptyState}>
          <p>
            {tab === "graduated"
              ? "No tokens have graduated yet — graduation opens once the bonding curve is deployed."
              : "No Hoodlums tokens on the curve yet. Be the first — create a token and open its bonding market."}
          </p>
          <a href="#launch-studio" className={styles.emptyCta}>
            Create new token →
          </a>
        </div>
      ) : (
        <div className={styles.grid}>
          {visibleSites.map((site) => (
            <div key={site.slug} className={styles.card}>
              <div className={styles.art}>
                {site.heroImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={site.heroImage} alt="" />
                ) : (
                  <span>{initial(site.name)}</span>
                )}
              </div>
              <b className={styles.cardName}>{site.name}</b>
              <span className={styles.cardTicker}>${site.ticker}</span>
              <b className={styles.cardCap}>—</b>
              <span className={styles.cardCapLabel}>Market cap</span>
              <div className={styles.gradRow}>
                <span>Graduation</span>
                <b>0%</b>
              </div>
              <div className={styles.gradBar}>
                <span style={{ width: "0%" }} />
              </div>
            </div>
          ))}
          <a href="#launch-studio" className={styles.beNextCard}>
            <span className={styles.beNextLabel}>Be next</span>
            <span className={styles.beNextButton}>Create token</span>
          </a>
        </div>
      )}
    </section>
  );
}
