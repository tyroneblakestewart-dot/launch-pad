"use client";

import { useEffect, useRef, useState } from "react";
import { removeSeededHoodlumsLaunch } from "@/lib/hoodlums-seed-cleanup";
import {
  PROJECT_SAVE_RESULT_EVENT,
  shouldCloseWorkspaceAfterSave,
  type ProjectSaveResultDetail,
} from "@/lib/project-save-result";
import type { TokenProject } from "@/lib/types";
import {
  OPEN_WORKSPACE_REQUEST_EVENT,
  type OpenWorkspaceRequestDetail,
} from "@/lib/workspace-open-request";
import { TokenStudio, type TokenStudioPathChooserContent } from "./token-studio";
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

export function TokenStudioWorkspace({
  pathChooserContent = {},
}: { pathChooserContent?: TokenStudioPathChooserContent } = {}) {
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
      <div className={pendingAction ? styles.preparing : undefined}>
        <TokenStudio pathChooserContent={pathChooserContent} />
      </div>
    </div>
  );
}
