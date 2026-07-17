"use client";

import { useEffect, useState } from "react";
import type { TokenProject } from "@/lib/types";
import { TokenStudio } from "./token-studio";
import styles from "./token-studio-workspace.module.css";

const STORAGE_KEY = "private-meme-token-studio-projects-v1";
const HOODLUMS_CONTRACT = "0x3bf7447cd055f1475a8b09090c7b062abc9d3798";
const EXPLORER_URL = "https://explorer.testnet.chain.robinhood.com";

const HOODLUMS_LAUNCH: TokenProject = {
  id: "hoodlums-robinhood-testnet-46630",
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
  status: "launched",
  chain: "robinhood",
  name: "Hoodlums",
  ticker: "HOODLUMS",
  description:
    "The code-running crew taking meme culture to a new chain. No masters. No middlemen. Just the heist.",
  supply: "1000000000",
  decimals: 18,
  websiteSlug: "hoodlums",
  contractAddress: HOODLUMS_CONTRACT,
  xHandle: "@hoodlums",
  telegram: "t.me/hoodlums",
  heroImage: "",
  theme: "hoodlums",
};

type PendingAction = "new" | "saved" | null;

function isHoodlumsRecord(project: TokenProject) {
  return (
    project.id === HOODLUMS_LAUNCH.id ||
    project.contractAddress.toLowerCase() === HOODLUMS_CONTRACT ||
    (project.name.toLowerCase() === "hoodlums" &&
      project.ticker.toUpperCase() === "HOODLUMS")
  );
}

function seedHoodlumsLaunch() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as TokenProject[]) : [];
    const projects = Array.isArray(parsed) ? parsed : [];
    const existing = projects.find(isHoodlumsRecord);
    const protectedRecord: TokenProject = {
      ...HOODLUMS_LAUNCH,
      ...existing,
      id: HOODLUMS_LAUNCH.id,
      status: "launched",
      chain: "robinhood",
      name: "Hoodlums",
      ticker: "HOODLUMS",
      supply: "1000000000",
      decimals: 18,
      websiteSlug: "hoodlums",
      contractAddress: HOODLUMS_CONTRACT,
      updatedAt: existing?.updatedAt || HOODLUMS_LAUNCH.updatedAt,
    };

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        protectedRecord,
        ...projects.filter((project) => !isHoodlumsRecord(project)),
      ]),
    );
  } catch {
    // The deployed contract remains safely recorded on-chain even if browser storage is unavailable.
  }
}

function findStudioButton(label: string) {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("#launch-studio button"),
  ).find((button) => button.textContent?.toLowerCase().includes(label.toLowerCase()));
}

export function TokenStudioWorkspace() {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  useEffect(() => {
    seedHoodlumsLaunch();
  }, []);

  useEffect(() => {
    if (!isOpen || !pendingAction) return;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const button = findStudioButton(pendingAction === "new" ? "new token" : "projects");
      if (button) {
        button.click();
        setPendingAction(null);
        window.clearInterval(timer);
      } else if (attempts >= 20) {
        setPendingAction(null);
        window.clearInterval(timer);
      }
    }, 50);

    return () => window.clearInterval(timer);
  }, [isOpen, pendingAction]);

  function openWorkspace(action: Exclude<PendingAction, null>) {
    seedHoodlumsLaunch();
    setPendingAction(action);
    setIsOpen(true);
  }

  function openSavedLaunches() {
    seedHoodlumsLaunch();
    if (!isOpen) {
      openWorkspace("saved");
      return;
    }

    findStudioButton("projects")?.click();
  }

  function saveAndClose() {
    const saveButton = findStudioButton("save project");
    saveButton?.click();
    window.setTimeout(() => {
      setPendingAction(null);
      setIsOpen(false);
    }, 100);
  }

  if (!isOpen) {
    return (
      <section className={styles.closedWorkspace} aria-labelledby="saved-launches-title">
        <div className={styles.statusRow}>
          <span className={styles.liveDot} />
          <span>LAUNCH RECORD PROTECTED</span>
        </div>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>SAVED LAUNCHES</p>
          <h2 id="saved-launches-title">Your Hoodlums token is safe, without keeping the form open.</h2>
          <p>
            The 1,000,000,000 HOODLUMS supply and contract address remain available in
            the saved-launch vault. The token itself lives on Robinhood Chain Testnet and
            cannot be removed by closing this workspace or clearing the form.
          </p>
        </div>

        <div className={styles.tokenRecord}>
          <div className={styles.tokenMark}>H</div>
          <div>
            <strong>Hoodlums</strong>
            <span>$HOODLUMS · 1,000,000,000 · LAUNCHED</span>
            <code>{HOODLUMS_CONTRACT}</code>
          </div>
        </div>

        <div className={styles.actions}>
          <button className={styles.primaryAction} onClick={() => openWorkspace("new")}>
            + Create new token
          </button>
          <button className={styles.secondaryAction} onClick={openSavedLaunches}>
            Open saved launches
          </button>
          <a
            href={`${EXPLORER_URL}/address/${HOODLUMS_CONTRACT}`}
            target="_blank"
            rel="noreferrer"
          >
            View Hoodlums contract ↗
          </a>
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
