import type { Metadata } from "next";
import Link from "next/link";
import styles from "./bonding-curve.module.css";

export const metadata: Metadata = {
  title: "Bonding Curve | HOODLUMS",
  description:
    "Review the HOODLUMS testnet bonding-curve launch model and automatic liquidity-pool graduation flow.",
};

const FLOW_STEPS = [
  {
    step: "01",
    title: "Complete supply",
    copy: "The creator places 100% of the current token supply into the curve before trading opens.",
  },
  {
    step: "02",
    title: "Curve trading",
    copy: "Wallet-signed buys and sells move the live curve price with minimum-output and deadline protection.",
  },
  {
    step: "03",
    title: "Funding target",
    copy: "Only genuine curve purchases count towards the configured testnet graduation target.",
  },
  {
    step: "04",
    title: "Pool creation",
    copy: "The remaining tokens and raised test ETH automatically seed a new Hoodlums liquidity pool.",
  },
  {
    step: "05",
    title: "Liquidity locked",
    copy: "The complete initial LP position is permanently sent to the lock address at graduation.",
  },
] as const;

export default function BondingCurvePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>ROBINHOOD CHAIN TESTNET · STEP 5</p>
        <h1>Bonding Curve</h1>
        <p className={styles.intro}>
          Follow the token from a protected full-supply launch through curve trading and into its
          permanently locked liquidity pool.
        </p>
        <div className={styles.status} role="status">
          <span>FOUNDATION MERGED</span>
          <p>
            The testnet contract is in the codebase. Deployment, factory integration and live
            buy/sell controls are not active yet.
          </p>
        </div>
      </section>

      <section className={styles.summaryGrid} aria-label="Bonding curve launch rules">
        <article className={styles.card}>
          <span className={styles.cardLabel}>SUPPLY RULE</span>
          <h2>Zero unlocked creator tokens</h2>
          <p>
            Trading cannot begin unless the creator holds and transfers the complete current token
            supply into the curve. Buyers receive tokens only through curve purchases.
          </p>
        </article>
        <article className={styles.card}>
          <span className={styles.cardLabel}>TRADING SAFETY</span>
          <h2>Wallet-signed and protected</h2>
          <p>
            Buys and sells use live quotes, a minimum received amount and a transaction deadline.
            Virtual ETH can shape the price but cannot be withdrawn as real funds.
          </p>
        </article>
        <article className={styles.card}>
          <span className={styles.cardLabel}>GRADUATION</span>
          <h2>Automatic pool migration</h2>
          <p>
            Reaching the exact funding target closes curve trading and moves the remaining token
            inventory plus the recorded test ETH into a new Hoodlums pool.
          </p>
        </article>
        <article className={styles.card}>
          <span className={styles.cardLabel}>CURRENT LIMIT</span>
          <h2>Testnet foundation only</h2>
          <p>
            No platform, creator or reserve fee percentages are configured. The contract is
            unaudited and must not be used with mainnet funds.
          </p>
        </article>
      </section>

      <section className={styles.flowSection} aria-labelledby="curve-flow-title">
        <div className={styles.sectionHeading}>
          <p>LAUNCH LIFECYCLE</p>
          <h2 id="curve-flow-title">From token supply to locked liquidity</h2>
        </div>
        <ol className={styles.flow}>
          {FLOW_STEPS.map((item) => (
            <li key={item.step}>
              <span>{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.nextStep}>
        <div>
          <p className={styles.cardLabel}>NEXT MILESTONE</p>
          <h2>Connect the curve to real testnet launches</h2>
          <p>
            The next development step is an atomic factory flow that creates the token, places its
            full supply into the curve and exposes live quote, buy, sell and graduation progress on
            this page.
          </p>
        </div>
        <div className={styles.actions}>
          <Link href="/testnet">Open testnet launcher</Link>
          <Link href="/liquidity-lab" className={styles.secondaryAction}>
            Open liquidity lab
          </Link>
        </div>
      </section>
    </main>
  );
}
