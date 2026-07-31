"use client";

import Link from "next/link";
import type { PublicGeneratedSite } from "@/lib/public-site";
import { HoodlumsTokenGrid } from "./hoodlums-token-grid";
import { RobinhoodTrendingPanel } from "./robinhood-trending-panel";
import styles from "./hoodlums-market-home.module.css";

const FACT_PILLS = [
  "0% token tax",
  "No mint function",
  "No owner",
  "LP locked at graduation",
  "All facts on-chain",
];

// #launch-studio (TokenStudioWorkspace) owns its own open/closed state and
// exposes no props, so — matching this codebase's existing pattern of
// cross-component DOM signalling (see findStudioButton in
// token-studio-workspace.tsx) — the hero/topbar CTAs reach it by clicking
// its rendered "Create new token" / "Open saved launches" buttons directly.
function clickStudioButton(labelSubstring: string): boolean {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>("#launch-studio button"),
  ).find((candidate) => candidate.textContent?.toLowerCase().includes(labelSubstring));
  button?.click();
  return Boolean(button);
}

function scrollToLaunchStudio() {
  document.getElementById("launch-studio")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openCreateFlow() {
  scrollToLaunchStudio();
  window.setTimeout(() => clickStudioButton("create new token"), 260);
}

function openSavedLaunches() {
  scrollToLaunchStudio();
  window.setTimeout(() => clickStudioButton("open saved launches"), 260);
}

export function HoodlumsMarketHome({ tokens }: { tokens: PublicGeneratedSite[] }) {
  return (
    <div className={styles.shell}>
      <div className={styles.topbar}>
        <span className={styles.pulse}>
          <span className={styles.pulseDot} aria-hidden="true" />
          5-MIN ROBINHOOD MARKET PULSE
        </span>
        <div className={styles.topbarActions}>
          <button type="button" className={styles.topbarCreate} onClick={openCreateFlow}>
            + Create
          </button>
          <Link href="/account" className={styles.topbarAccount}>
            Account
          </Link>
        </div>
      </div>

      <div className={styles.columns}>
        <div className={styles.main}>
          <section className={styles.hero} aria-labelledby="market-hero-title">
            <p className={styles.eyebrow}>HOODLUMS BONDING MARKET</p>
            <h1 id="market-hero-title" className={styles.headline}>
              From new token to
              <br />
              <span>locked liquidity.</span>
            </h1>
            <p className={styles.sub}>
              Create a fixed-supply token, give it a live Hoodlums website, and put its full supply
              into a bonding curve that graduates into permanently locked liquidity.
            </p>
            <div className={styles.ctas}>
              <button type="button" className={styles.primaryCta} onClick={openCreateFlow}>
                Create new token
              </button>
              <button type="button" className={styles.secondaryCta} onClick={openSavedLaunches}>
                Open saved launches
              </button>
            </div>
            <ul className={styles.pills}>
              {FACT_PILLS.map((pill) => (
                <li key={pill}>✓ {pill}</li>
              ))}
            </ul>
          </section>

          <HoodlumsTokenGrid tokens={tokens} onCreateToken={openCreateFlow} />
        </div>

        <RobinhoodTrendingPanel />
      </div>
    </div>
  );
}
