/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { HOODLUMS_WORDMARK_IMAGE } from "@/lib/hoodlums-wordmark-image";
import styles from "./hoodlums-launch-hero.module.css";

const navigation = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "#launch-studio", label: "Launch studio", icon: "+" },
  { href: "/testnet", label: "Robinhood testnet", icon: "R" },
  { href: "/monad", label: "Monad testnet", icon: "M" },
  { href: "/providers", label: "Launch providers", icon: "↗" },
  { href: "/allocations", label: "Allocations", icon: "%" },
  { href: "/social", label: "Social publishing", icon: "@" },
];

const launchTools = [
  {
    href: "#launch-studio",
    badge: "START HERE",
    title: "Create a token",
    text: "Set the name, ticker, supply, artwork and launch details in one workspace.",
    icon: "+",
  },
  {
    href: "/testnet",
    badge: "ROBINHOOD",
    title: "Deploy on testnet",
    text: "Test a fixed-supply EVM token with explicit wallet approval before mainnet.",
    icon: "R",
  },
  {
    href: "/providers",
    badge: "HANDOFF",
    title: "Open launch providers",
    text: "Continue into the guided NOXA and Pons launch flow without hidden calls.",
    icon: "↗",
  },
  {
    href: "/allocations",
    badge: "PLAN",
    title: "Split the supply",
    text: "Prepare liquidity, community, team and reserve allocations before launch.",
    icon: "%",
  },
];

const workflow = [
  ["01", "Build", "Create the token project and upload the artwork."],
  ["02", "Test", "Deploy and transfer on supported test networks."],
  ["03", "Prepare", "Set allocations and complete the provider handoff."],
];

export function HoodlumsLaunchHero() {
  return (
    <section className={styles.page} aria-labelledby="hoodlums-dashboard-title">
      <header className={styles.mobileHeader}>
        <Link href="/" className={styles.mobileBrand} aria-label="HOODLUMS home">
          <img
            src={HOODLUMS_WORDMARK_IMAGE}
            alt="HOODLUMS"
            width={1200}
            height={438}
            style={{ width: "145px", height: "auto", display: "block" }}
          />
        </Link>
        <a href="#launch-studio" className={styles.mobileCreate}>
          Create
        </a>
      </header>

      <aside className={styles.sidebar}>
        <Link href="/" className={styles.brand} aria-label="HOODLUMS home">
          <img
            src={HOODLUMS_WORDMARK_IMAGE}
            alt="HOODLUMS"
            width={1200}
            height={438}
            style={{ width: "100%", maxWidth: "190px", height: "auto", display: "block" }}
          />
        </Link>

        <nav className={styles.sideNav} aria-label="Launchpad navigation">
          {navigation.map((item, index) => {
            const className = index === 0 ? styles.sideLinkActive : styles.sideLink;
            return item.href.startsWith("#") ? (
              <a key={item.href} href={item.href} className={className}>
                <span>{item.icon}</span>
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href} className={className}>
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <a href="#launch-studio" className={styles.createButton}>
          <span>+</span> Create launch
        </a>

        <div className={styles.sideStatus}>
          <span className={styles.liveDot} />
          <div>
            <b>Private beta</b>
            <small>Testnet-first execution</small>
          </div>
        </div>
      </aside>

      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          <div className={styles.searchBox} aria-label="Search launchpad tools">
            <span aria-hidden="true">⌕</span>
            <span>Search launch tools and projects...</span>
            <kbd>⌘ K</kbd>
          </div>
          <div className={styles.topActions}>
            <Link href="/allocations" className={styles.secondaryButton}>
              Allocations
            </Link>
            <a href="#launch-studio" className={styles.primaryButton}>
              + Create
            </a>
          </div>
        </header>

        <div className={styles.announcement}>
          <div>
            <span className={styles.liveDot} />
            <strong>HOODLUMS launchpad</strong>
            <span>Private testnet build</span>
          </div>
          <b>Performance mode: lightweight</b>
        </div>

        <div className={styles.content}>
          <section className={styles.welcome}>
            <div>
              <p className={styles.eyebrow}>BUILD. TEST. LAUNCH.</p>
              <h1 id="hoodlums-dashboard-title">
                Meme-token launches,
                <span>without the clutter.</span>
              </h1>
              <p className={styles.subtitle}>
                A clean command centre for building tokens, testing contracts and preparing
                launch allocations. <strong>This is just the beginning.</strong>
              </p>
              <div className={styles.welcomeActions}>
                <a href="#launch-studio" className={styles.primaryButtonLarge}>
                  Create a launch <span aria-hidden="true">→</span>
                </a>
                <Link href="/testnet" className={styles.secondaryButtonLarge}>
                  Open testnet lab
                </Link>
              </div>
            </div>

            <aside className={styles.networkCard} aria-label="Launchpad network status">
              <div className={styles.networkHeading}>
                <span className={styles.networkIcon}>H</span>
                <div>
                  <small>ACTIVE WORKSPACE</small>
                  <h2>HOODLUMS</h2>
                </div>
                <span className={styles.safeBadge}>SAFE</span>
              </div>
              <dl>
                <div>
                  <dt>Primary testnet</dt>
                  <dd>Robinhood Chain</dd>
                </div>
                <div>
                  <dt>Secondary testnet</dt>
                  <dd>Monad</dd>
                </div>
                <div>
                  <dt>Mainnet execution</dt>
                  <dd>Locked</dd>
                </div>
              </dl>
              <Link href="/testnet">Open deployment lab <span>↗</span></Link>
            </aside>
          </section>

          <section className={styles.section} aria-labelledby="quick-actions-title">
            <div className={styles.sectionHeading}>
              <div>
                <p>QUICK ACTIONS</p>
                <h2 id="quick-actions-title">Launch tools</h2>
              </div>
              <span>Testnet first · Wallet approved</span>
            </div>

            <div className={styles.toolGrid}>
              {launchTools.map((tool) => {
                const card = (
                  <>
                    <div className={styles.toolTopline}>
                      <span className={styles.toolIcon}>{tool.icon}</span>
                      <small>{tool.badge}</small>
                    </div>
                    <h3>{tool.title}</h3>
                    <p>{tool.text}</p>
                    <b>Open tool <span aria-hidden="true">↗</span></b>
                  </>
                );

                return tool.href.startsWith("#") ? (
                  <a key={tool.href} href={tool.href} className={styles.toolCard}>
                    {card}
                  </a>
                ) : (
                  <Link key={tool.href} href={tool.href} className={styles.toolCard}>
                    {card}
                  </Link>
                );
              })}
            </div>
          </section>

          <section className={styles.lowerGrid}>
            <div className={styles.tokenPanel}>
              <div className={styles.panelHeading}>
                <div>
                  <p>TEST DEPLOYMENT</p>
                  <h2>HOODLUMS</h2>
                </div>
                <span>LIVE ON TESTNET</span>
              </div>

              <div className={styles.tokenRow}>
                <div className={styles.tokenAvatar}>H</div>
                <div className={styles.tokenName}>
                  <b>Hoodlums</b>
                  <span>$HOODLUMS</span>
                </div>
                <div className={styles.tokenStat}>
                  <small>SUPPLY</small>
                  <b>1B</b>
                </div>
                <div className={styles.tokenStat}>
                  <small>CHAIN</small>
                  <b>Robinhood</b>
                </div>
              </div>

              <code>0x3bf7447cd055f1475a8b09090c7b062abc9d3798</code>
              <div className={styles.tokenLinks}>
                <Link href="/allocations">Prepare allocation</Link>
                <Link href="/providers">Provider handoff</Link>
              </div>
            </div>

            <div className={styles.workflowPanel}>
              <div className={styles.panelHeading}>
                <div>
                  <p>LAUNCH FLOW</p>
                  <h2>Three clear stages</h2>
                </div>
              </div>
              <ol>
                {workflow.map(([number, title, text]) => (
                  <li key={number}>
                    <span>{number}</span>
                    <div>
                      <b>{title}</b>
                      <p>{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
