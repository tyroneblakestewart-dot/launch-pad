import Link from "next/link";
import type { PublicGeneratedSite } from "@/lib/public-site";
import { HoodlumsTokenGrid } from "@/components/hoodlums-token-grid";
import { RobinhoodTrendingPanel } from "@/components/robinhood-trending-panel";
import styles from "./hoodlums-market-home.module.css";

export function HoodlumsMarketHome({ liveSites }: { liveSites: PublicGeneratedSite[] }) {
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
            <p className={styles.eyebrow}>HOODLUMS BONDING MARKET</p>
            <h1 id="hoodlums-market-title" className={styles.headline}>
              From new token to
              <br />
              <span>locked liquidity.</span>
            </h1>
            <p className={styles.sub}>
              Create a fixed-supply token, give it a live Hoodlums website, and put its full supply
              into a bonding curve that graduates into permanently locked liquidity.
            </p>
            <div className={styles.ctas}>
              <a href="#launch-studio" className={styles.primaryCta}>
                Create new token
              </a>
              <a href="#launch-studio" className={styles.secondaryCta}>
                Open saved launches
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
