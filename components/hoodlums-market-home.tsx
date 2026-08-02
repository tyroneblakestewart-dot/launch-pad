import Link from "next/link";
import type { PublicGeneratedSite } from "@/lib/public-site";
import { HoodlumsTokenGrid } from "@/components/hoodlums-token-grid";
import { RobinhoodTrendingPanel } from "@/components/robinhood-trending-panel";
import styles from "./hoodlums-market-home.module.css";

type HoodlumsMarketHomeProps = {
  liveSites: PublicGeneratedSite[];
  heroEyebrow?: string;
  heroTitleLine1?: string;
  heroTitleLine2?: string;
  heroSub?: string;
  primaryCtaLabel?: string;
  primaryCtaLink?: string;
  secondaryCtaLabel?: string;
  secondaryCtaLink?: string;
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
  secondaryCtaLabel = "Open saved launches",
  secondaryCtaLink = "#launch-studio",
}: HoodlumsMarketHomeProps) {
  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <span className={styles.pulse}>
          <span className={styles.pulseDot} />
          5-MIN ROBINHOOD MARKET PULSE
        </span>
        <div className={styles.topActions}>
          <a href="#launch-studio" className={styles.createButton}>
            + Create
          </a>
          <Link href="/account" className={styles.accountButton}>
            Account
          </Link>
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
              <a href={primaryCtaLink} className={styles.primaryCta}>
                {primaryCtaLabel}
              </a>
              <a href={secondaryCtaLink} className={styles.secondaryCta}>
                {secondaryCtaLabel}
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
    </div>
  );
}
