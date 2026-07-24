"use client";

import { useEffect, useRef, useState } from "react";
import {
  PROJECT_SAVE_RESULT_EVENT,
  shouldCloseWorkspaceAfterSave,
  type ProjectSaveResultDetail,
} from "@/lib/project-save-result";
import type { TokenProject } from "@/lib/types";
import { TokenStudio } from "./token-studio";
import styles from "./token-studio-workspace.module.css";

const STORAGE_KEY = "private-meme-token-studio-projects-v1";
const HOODLUMS_CONTRACT = "0x3bf7447cd055f1475a8b09090c7b062abc9d3798";

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
      ?.querySelector<HTMLInputElement>('input[placeholder="Hoodlums"]')
      ?.focus({ preventScroll: true });
  }, 180);
}

export function TokenStudioWorkspace() {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const awaitingSaveAndClose = useRef(false);

  useEffect(() => {
    seedHoodlumsLaunch();
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
    if (!saveButton) return;
    awaitingSaveAndClose.current = true;
    saveButton.click();
  }

  if (!isOpen) {
    return (
      <section className={styles.closedWorkspace} aria-labelledby="start-launch-title">
        <div className={styles.copy}>
          <p className={styles.eyebrow}>BUILD. TEST. LAUNCH.</p>
          <h2 id="start-launch-title">Launch a meme token without the clutter.</h2>
          <p>
            Start a new token or continue a project you already saved. Everything else stays
            out of the way until you need it.
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
