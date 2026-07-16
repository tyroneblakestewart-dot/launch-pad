import Image from "next/image";
import Link from "next/link";
import styles from "./hoodlums-launch-hero.module.css";

const launchTools = [
  {
    href: "/testnet",
    kicker: "01 / DEPLOY",
    title: "Robinhood Testnet Lab",
    text: "Create and test a fixed-supply EVM token with your connected wallet.",
  },
  {
    href: "/monad",
    kicker: "02 / EXPAND",
    title: "Monad Testnet Launch",
    text: "Prepare a second test deployment route for the Monad ecosystem.",
  },
  {
    href: "/providers",
    kicker: "03 / PROVIDERS",
    title: "NOXA + Pons Flow",
    text: "Move from token setup into a guided provider launch and creator-buy handoff.",
  },
  {
    href: "/allocations",
    kicker: "04 / DISTRIBUTE",
    title: "Token Allocation Desk",
    text: "Plan liquidity, community, team and reserve allocations before launch.",
  },
];

export function HoodlumsLaunchHero() {
  return (
    <section className={styles.hero} aria-labelledby="hoodlums-hero-title">
      <Image
        src="/hoodlums-robbin-hero.webp"
        alt=""
        fill
        priority
        sizes="100vw"
        className={styles.backdrop}
        aria-hidden="true"
      />
      <div className={styles.matrixGrid} aria-hidden="true" />
      <div className={styles.scanline} aria-hidden="true" />

      <div className={styles.shell}>
        <nav className={styles.nav} aria-label="Primary navigation">
          <Link className={styles.brand} href="/" aria-label="Hoodlums home">
            HOODLUMS
          </Link>
          <div className={styles.navLinks}>
            <a href="#launch-tools">Launch tools</a>
            <Link href="/providers">Providers</Link>
            <Link href="/allocations">Allocations</Link>
          </div>
          <a className={styles.navCta} href="#launch-studio">
            Open studio <span aria-hidden="true">↘</span>
          </a>
        </nav>

        <div className={styles.heroGrid}>
          <div className={styles.copy}>
            <p className={styles.protocol}>
              <span aria-hidden="true">›</span> INITIATING HOODLUMS LAUNCH PROTOCOL
            </p>
            <h1 id="hoodlums-hero-title" className={styles.title}>
              HOODLUMS
            </h1>
            <p className={styles.slogan}>THIS IS JUST THE BEGINNING.</p>
            <p className={styles.intro}>
              Build the token, test the contract, prepare the allocation and move into
              launch from one private command centre.
            </p>

            <div className={styles.actions}>
              <a className={styles.primaryAction} href="#launch-studio">
                Build your launch <span aria-hidden="true">→</span>
              </a>
              <Link className={styles.secondaryAction} href="/testnet">
                Open testnet lab
              </Link>
            </div>

            <div className={styles.statusStrip} aria-label="Launchpad status">
              <div>
                <span>MODE</span>
                <strong>Private build</strong>
              </div>
              <div>
                <span>NETWORKS</span>
                <strong>Robinhood + Monad</strong>
              </div>
              <div>
                <span>EXECUTION</span>
                <strong>Wallet approved</strong>
              </div>
            </div>
          </div>

          <div className={styles.visual} aria-label="Robbin the Leader Hoodlums artwork">
            <div className={styles.targetBar}>
              <span><i /> TARGET ACQUIRED</span>
              <b>ROBBIN // THE LEADER</b>
            </div>
            <div className={styles.artFrame}>
              <Image
                src="/hoodlums-robbin-hero.webp"
                alt="Robbin the Leader in a green hood with the Hoodlums code-rain artwork"
                width={900}
                height={900}
                priority
                sizes="(max-width: 900px) 92vw, 46vw"
                className={styles.artwork}
              />
              <div className={styles.artGlow} aria-hidden="true" />
            </div>
            <p className={styles.visualCaption}>
              NEW SHERWOOD // CREW SYSTEM ONLINE // NO MASTERS. NO MIDDLEMEN.
            </p>
          </div>
        </div>

        <div id="launch-tools" className={styles.toolsSection}>
          <div className={styles.sectionHeading}>
            <div>
              <p>LAUNCH SYSTEMS</p>
              <h2>Everything already moving inside the build.</h2>
            </div>
            <span>TESTNET FIRST // MAINNET LOCKED</span>
          </div>

          <div className={styles.toolsGrid}>
            {launchTools.map((tool) => (
              <Link key={tool.href} href={tool.href} className={styles.toolCard}>
                <p>{tool.kicker}</p>
                <h3>{tool.title}</h3>
                <span>{tool.text}</span>
                <b aria-hidden="true">OPEN ↗</b>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
