"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { removeSeededHoodlumsLaunch } from "@/lib/hoodlums-seed-cleanup";
import {
  PROJECT_SAVE_RESULT_EVENT,
  shouldCloseWorkspaceAfterSave,
  type ProjectSaveResultDetail,
} from "@/lib/project-save-result";
import type { TokenProject } from "@/lib/types";
import { RobinhoodTrendingPanel } from "./robinhood-trending-panel";
import { TokenStudio } from "./token-studio";
import styles from "./token-studio-workspace.module.css";

const STORAGE_KEY = "private-meme-token-studio-projects-v1";

type PendingAction = "new" | "saved" | null;

function cleanUpSeededHoodlumsLaunch() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as TokenProject[];
    if (!Array.isArray(parsed)) return;

    const cleaned = removeSeededHoodlumsLaunch(parsed);
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    }
  } catch {
    // If storage can't be read there is nothing to clean up.
  }
}

function findStudioButton(label: string) {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("#launch-studio button"),
  ).find((button) => button.textContent?.toLowerCase().includes(label.toLowerCase()));
}

export function calculateProjectWorkspaceScrollTop(
  workspaceViewportTop: number,
  currentScrollY: number,
  stickyHeaderHeight: number,
): number {
  return Math.max(0, workspaceViewportTop + currentScrollY - stickyHeaderHeight);
}

function focusNewProjectEditor() {
  const workspace = document.getElementById("launch-studio");
  const panel = document.querySelector<HTMLElement>(".builder-panel");
  const mobileBrand = document.querySelector<HTMLElement>('a[aria-label="HOODLUMS home"]');
  const stickyHeader = mobileBrand?.closest<HTMLElement>("header");

  if (workspace) {
    window.scrollTo({
      top: calculateProjectWorkspaceScrollTop(
        workspace.getBoundingClientRect().top,
        window.scrollY,
        stickyHeader?.getBoundingClientRect().height || 0,
      ),
      behavior: "smooth",
    });
  }

  window.setTimeout(() => {
    panel
      ?.querySelector<HTMLInputElement>("#token-name-input")
      ?.focus({ preventScroll: true });
  }, 180);
}

export function TokenStudioWorkspace() {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const awaitingSaveAndClose = useRef(false);

  useEffect(() => {
    cleanUpSeededHoodlumsLaunch();
  }, []);

  useEffect(() => {
    function onProjectSaveResult(event: Event) {
      if (!awaitingSaveAndClose.current) return;
      const detail = (event as CustomEvent<ProjectSaveResultDetail>).detail;
      awaitingSaveAndClose.current = false;
      if (!shouldCloseWorkspaceAfterSave(detail)) return;
      setPendingAction(null);
      setIsOpen(false);
    }

    window.addEventListener(PROJECT_SAVE_RESULT_EVENT, onProjectSaveResult);
    return () => window.removeEventListener(PROJECT_SAVE_RESULT_EVENT, onProjectSaveResult);
  }, []);

  useEffect(() => {
    if (!isOpen || !pendingAction) return;

    let attempts = 0;
    const action = pendingAction;
    const timer = window.setInterval(() => {
      attempts += 1;
      const button = findStudioButton(action === "new" ? "new token" : "projects");
      if (button) {
        button.click();
        setPendingAction(null);
        window.clearInterval(timer);
        if (action === "new") {
          window.requestAnimationFrame(focusNewProjectEditor);
        }
      } else if (attempts >= 20) {
        setPendingAction(null);
        window.clearInterval(timer);
      }
    }, 50);

    return () => window.clearInterval(timer);
  }, [isOpen, pendingAction]);

  function openWorkspace(action: Exclude<PendingAction, null>) {
    setPendingAction(action);
    setIsOpen(true);
  }

  function openSavedLaunches() {
    if (!isOpen) {
      openWorkspace("saved");
      return;
    }

    findStudioButton("projects")?.click();
  }

  function saveAndClose() {
    const saveButton = findStudioButton("save project");
    if (!saveButton) return;
    awaitingSaveAndClose.current = true;
    saveButton.click();
  }

  if (!isOpen) {
    return (
      <section className={styles.closedWorkspace} aria-label="Hoodlums token launch workspace">
        <div className={styles.desktopLanding}>
          <header className={styles.desktopTopbar}>
            <div className={styles.marketPulse}>
              <span className={styles.liveDot} />
              <span>5-MIN ROBINHOOD MARKET PULSE</span>
            </div>
            <div className={styles.desktopActions}>
              <button type="button" onClick={() => openWorkspace("new")}>
                + Create
              </button>
              <Link href="/account">Account</Link>
            </div>
          </header>

          <div className={styles.heroGrid}>
            <section className={styles.createHero} aria-labelledby="desktop-launch-title">
              <p className={styles.eyebrow}>CREATE · BOND · GRADUATE</p>
              <h1 id="desktop-launch-title">
                Launch a token.
                <span>Build its market.</span>
              </h1>
              <p className={styles.heroCopy}>
                Create a fixed-supply token, give it a live Hoodlums website and prepare it for a
                full-supply bonding curve that graduates into locked liquidity.
              </p>
              <div className={styles.actions}>
                <button className={styles.primaryAction} onClick={() => openWorkspace("new")}>
                  Create new token
                </button>
                <button className={styles.secondaryAction} onClick={openSavedLaunches}>
                  Open saved launches
                </button>
              </div>
              <div className={styles.heroChips} aria-label="Token contract guarantees">
                <span>0% token tax</span>
                <span>No mint function</span>
                <span>No owner</span>
                <span>Website included</span>
              </div>
            </section>

            <RobinhoodTrendingPanel />
          </div>

          <section className={styles.marketSection} aria-labelledby="hoodlums-market-title">
            <div className={styles.sectionHeading}>
              <div>
                <p>HOODLUMS BONDING MARKET</p>
                <h2 id="hoodlums-market-title">From new token to locked liquidity</h2>
              </div>
              <Link href="/bonding-curve">View the bonding model →</Link>
            </div>

            <div className={styles.launchMarketGrid}>
              <article className={styles.emptyMarketCard}>
                <div className={styles.emptyMark}>H</div>
                <div>
                  <span className={styles.statusBadge}>MARKET PREVIEW</span>
                  <h3>No Hoodlums bonding tokens are live yet.</h3>
                  <p>
                    This becomes the native token market after the tested curve is deployed and
                    connected to launches. Until then, the live panel above shows external Robinhood
                    Chain activity rather than invented Hoodlums trades.
                  </p>
                </div>
              </article>

              <article className={styles.flowCard}>
                <p className={styles.cardLabel}>THE LAUNCH FLOW</p>
                <ol className={styles.curveSteps}>
                  <li><span>1</span><div><b>Create</b><small>Token, artwork and website</small></div></li>
                  <li><span>2</span><div><b>Bond</b><small>Full supply enters the curve</small></div></li>
                  <li><span>3</span><div><b>Graduate</b><small>Raised ETH and tokens seed locked LP</small></div></li>
                </ol>
              </article>

              <article className={styles.factCard}>
                <p className={styles.cardLabel}>WEBSITE ACTIVITY</p>
                <h3>The site follows the launch.</h3>
                <ul className={styles.factList}>
                  <li><span>✓</span> `hoodlums.dev/&lt;slug&gt;` from day one</li>
                  <li><span>✓</span> Contract and chart appear after launch</li>
                  <li><span>✓</span> LP status updates at graduation</li>
                  <li><span>✓</span> No regeneration needed</li>
                </ul>
              </article>
            </div>
          </section>

          <section className={styles.lowerGrid} aria-label="Hoodlums launch activity information">
            <article className={styles.lifecyclePanel}>
              <p className={styles.cardLabel}>LIVE WITHOUT FAKING IT</p>
              <h2>Useful activity while the Hoodlums market grows.</h2>
              <p>
                Visitors can discover what is moving across Robinhood Chain now. Hoodlums-created
                tokens will be clearly separated when native curves go live.
              </p>
              <div className={styles.lifecycleStats}>
                <div><b>5m</b><span>Market window</span></div>
                <div><b>60s</b><span>Page refresh</span></div>
                <div><b>0</b><span>Fake Hoodlums trades</span></div>
              </div>
            </article>

            <article className={styles.notePanel}>
              <p className={styles.cardLabel}>NEXT STAGE</p>
              <h2>One page for creation, discovery and graduation.</h2>
              <p>
                When the bonding contracts are deployed, this same desktop home can surface active
                Hoodlums curves, progress to graduation, newest launches and recently locked pools.
              </p>
              <Link href="/bonding-curve">Review current contract status</Link>
            </article>
          </section>
        </div>

        <div className={styles.mobileLanding}>
          <div className={styles.copy}>
            <p className={styles.eyebrow}>BUILD. TEST. LAUNCH.</p>
            <h2 id="mobile-start-launch-title">Launch a meme token without the clutter.</h2>
            <p>
              Start a new token or continue a project you already saved. Everything else stays out
              of the way until you need it.
            </p>
          </div>

          <div className={styles.actions}>
            <button className={styles.primaryAction} onClick={() => openWorkspace("new")}>
              Create new token
            </button>
            <button className={styles.secondaryAction} onClick={openSavedLaunches}>
              Open saved launches
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.openWorkspace}>
      <div className={styles.workspaceBar}>
        <div>
          <span className={styles.liveDot} />
          <span>PRIVATE WORKSPACE OPEN</span>
        </div>
        <div className={styles.workspaceActions}>
          <button onClick={openSavedLaunches}>Saved launches</button>
          <button className={styles.closeButton} onClick={saveAndClose}>
            Save & close
          </button>
        </div>
      </div>
      <div className={pendingAction ? styles.preparing : undefined}>
        <TokenStudio />
      </div>
    </div>
  );
}
