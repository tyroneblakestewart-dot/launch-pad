"use client";

import { useEffect, useRef, useState } from "react";
import { removeSeededHoodlumsLaunch } from "@/lib/hoodlums-seed-cleanup";
import { hasLaunchPathPreset } from "@/lib/launch-paths";
import {
  PROJECT_SAVE_RESULT_EVENT,
  shouldCloseWorkspaceAfterSave,
  type ProjectSaveResultDetail,
} from "@/lib/project-save-result";
import {
  parseSavedTokenProjects,
  TOKEN_STUDIO_PROJECTS_STORAGE_KEY,
} from "@/lib/token-project-storage";
import type { TokenProject } from "@/lib/types";
import {
  OPEN_WORKSPACE_REQUEST_EVENT,
  type OpenWorkspaceRequestDetail,
} from "@/lib/workspace-open-request";
import { TokenStudio } from "./token-studio";
import styles from "./token-studio-workspace.module.css";

type PendingAction = "new" | "saved" | null;

function cleanUpSeededHoodlumsLaunch() {
  try {
    const raw = localStorage.getItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY);
    if (!raw) return;
    const parsed = parseSavedTokenProjects(raw);

    const cleaned = removeSeededHoodlumsLaunch(parsed);
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY, JSON.stringify(cleaned));
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
  const [studioInstanceKey, setStudioInstanceKey] = useState(0);
  const [showEmptySavedLaunches, setShowEmptySavedLaunches] = useState(false);
  const awaitingSaveAndClose = useRef(false);

  useEffect(() => {
    cleanUpSeededHoodlumsLaunch();

    // Manager plan cards navigate back to the homepage after storing the
    // selected plan in sessionStorage. Open the workspace automatically,
    // but leave the preset untouched for TokenPathChooser to consume once.
    if (hasLaunchPathPreset()) {
      setPendingAction("new");
      setIsOpen(true);
    }
  }, []);

  useEffect(() => {
    function onProjectSaveResult(event: Event) {
      if (!awaitingSaveAndClose.current) return;
      const detail = (event as CustomEvent<ProjectSaveResultDetail>).detail;
      awaitingSaveAndClose.current = false;
      if (!shouldCloseWorkspaceAfterSave(detail)) return;
      setPendingAction(null);
      setShowEmptySavedLaunches(false);
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
  }, [isOpen, pendingAction, studioInstanceKey]);

  useEffect(() => {
    function onOpenWorkspaceRequest(event: Event) {
      const { action } = (event as CustomEvent<OpenWorkspaceRequestDetail>).detail;
      if (action === "saved") {
        openSavedLaunches();
      } else {
        openWorkspace("new");
      }
    }

    window.addEventListener(OPEN_WORKSPACE_REQUEST_EVENT, onOpenWorkspaceRequest);
    return () => window.removeEventListener(OPEN_WORKSPACE_REQUEST_EVENT, onOpenWorkspaceRequest);
  }, [isOpen]);

  function openWorkspace(action: Exclude<PendingAction, null>) {
    setShowEmptySavedLaunches(false);
    setPendingAction(action);
    setIsOpen(true);
  }

  function openSavedLaunches() {
    const savedLaunches = parseSavedTokenProjects(
      localStorage.getItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY),
    );

    if (savedLaunches.length === 0) {
      setPendingAction(null);
      setShowEmptySavedLaunches(true);
      setIsOpen(true);
      return;
    }

    // Remount the Studio before opening its project vault. The saved
    // TokenProject remains the source of truth, while transient UI from the
    // launch being left (for example an open plan chooser) is discarded so
    // it cannot cover or alter the project the user resumes.
    setShowEmptySavedLaunches(false);
    setStudioInstanceKey((current) => current + 1);
    setPendingAction("saved");
    setIsOpen(true);
  }

  function saveAndClose() {
    const saveButton = findStudioButton("save project");
    if (!saveButton) return;
    awaitingSaveAndClose.current = true;
    saveButton.click();
  }

  if (!isOpen) {
    return null;
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
      <div key={studioInstanceKey} className={pendingAction ? styles.preparing : undefined}>
        <TokenStudio />
      </div>

      {showEmptySavedLaunches && (
        <div className={styles.savedLaunchBackdrop} role="dialog" aria-modal="true" aria-labelledby="saved-launches-title">
          <div className={styles.savedLaunchPanel}>
            <div className={styles.savedLaunchHeading}>
              <div>
                <span>LOCAL VAULT</span>
                <h2 id="saved-launches-title">Saved launches</h2>
              </div>
              <button
                type="button"
                aria-label="Close saved launches"
                onClick={() => setShowEmptySavedLaunches(false)}
              >
                ×
              </button>
            </div>
            <p className={styles.savedLaunchEmpty}>No saved launches</p>
            <button
              type="button"
              className={styles.createLaunchButton}
              onClick={() => openWorkspace("new")}
            >
              + Start new launch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
