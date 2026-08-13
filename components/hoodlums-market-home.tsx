"use client";

import type { MouseEvent } from "react";
import type { PublicGeneratedSite } from "@/lib/public-site";
import { HoodlumsGraduatingRow } from "@/components/hoodlums-graduating-row";
import { HoodlumsPlansSection } from "@/components/hoodlums-plans-section";
import { HoodlumsSocialShowcase } from "@/components/hoodlums-social-showcase";
import { HoodlumsTokenGrid } from "@/components/hoodlums-token-grid";
import { RobinhoodTrendingPanel } from "@/components/robinhood-trending-panel";
import { requestWorkspaceOpen } from "@/lib/workspace-open-request";
import styles from "./hoodlums-market-home.module.css";

type HoodlumsMarketHomeProps = {
  liveSites: PublicGeneratedSite[];
  heroEyebrow?: string;
  heroTitleLine1?: string;
  heroTitleLine2?: string;
  heroSub?: string;
  primaryCtaLabel?: string;
  primaryCtaLink?: string;
  showPlans?: boolean;
};

/** Hero chrome copy defaults match the original hardcoded strings and can be
 * overridden by the "Pages" CMS (see lib/page-content-registry.ts, page id
 * "home"). Nothing else on this page reads from the registry. */
export function HoodlumsMarketHome({
  liveSites,
  heroEyebrow = "BUILD. TEST. LAUNCH.",
  heroTitleLine1 = "Launch a meme token",
  heroTitleLine2 = "without the clutter.",
  heroSub = "Create a fixed-supply token, give it a live Hoodlums website, and put its full supply into a bonding curve that graduates into permanently locked liquidity.",
  primaryCtaLabel = "Create new token",
  primaryCtaLink = "#launch-studio",
  showPlans = true,
}: HoodlumsMarketHomeProps) {
  function handlePrimaryCtaClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    requestWorkspaceOpen("new");
  }

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <span className={styles.pulse}>
          <span className={styles.pulseDot} />
          5-MIN ROBINHOOD MARKET PULSE
        </span>
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.savedLaunchesButton}
            onClick={() => requestWorkspaceOpen("saved")}
          >
            Open saved launches
          </button>
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.main}>
          <section className={styles.hero} aria-labelledby="hoodlums-market-title">
            <p className={styles.eyebrow}>{heroEyebrow}</p>
            <h1 id="hoodlums-market-title" className={styles.headline}>
              {heroTitleLine1}
              <br />
              {heroTitleLine2}
            </h1>
            <p className={styles.sub}>{heroSub}</p>
            <div className={styles.ctas}>
              <a href={primaryCtaLink} className={styles.primaryCta} onClick={handlePrimaryCtaClick}>
                {primaryCtaLabel}
              </a>
            </div>
            <ul className={styles.facts}>
              <li>✓ 0% token tax</li>
              <li>✓ No mint function</li>
              <li>✓ No owner</li>
              <li>✓ LP locked at graduation</li>
              <li>✓ All facts on-chain</li>
            </ul>
          </section>

          <HoodlumsTokenGrid liveSites={liveSites} />
        </div>

        <RobinhoodTrendingPanel />
      </div>

      <HoodlumsGraduatingRow />

      {showPlans ? (
        <>
          <HoodlumsPlansSection />
          <HoodlumsSocialShowcase />
        </>
      ) : null}
    </div>
  );
}
