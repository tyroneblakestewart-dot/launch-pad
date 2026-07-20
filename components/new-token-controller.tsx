"use client";

import { useEffect } from "react";
import type { TokenProject } from "@/lib/types";

const PROJECT_STORAGE_KEY = "private-meme-token-studio-projects-v1";
const PENDING_PROJECT_KEY = "launchpad-pending-new-project";

function createId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createBlankProject(): TokenProject {
  const now = new Date().toISOString();
  return {
    id: createId(),
    createdAt: now,
    updatedAt: now,
    status: "draft",
    chain: "robinhood",
    name: "",
    ticker: "",
    description: "",
    supply: "1000000000",
    decimals: 18,
    websiteSlug: "",
    contractAddress: "",
    xHandle: "",
    telegram: "",
    heroImage: "",
    theme: "hoodlums",
  };
}

function readProjects(): TokenProject[] {
  try {
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as TokenProject[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buttonLabel(button: HTMLButtonElement): string {
  return button.textContent?.replace(/\s+/g, " ").trim() || "";
}

export function isProjectRecoveryButtonLabel(label: string): boolean {
  return label.startsWith("Projects") || label === "Open saved launches";
}

function focusNewProjectEditor() {
  const panel = document.querySelector<HTMLElement>(".builder-panel");
  panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => {
    panel?.querySelector<HTMLInputElement>('input[placeholder="Hoodlums"]')?.focus();
  }, 180);
}

export function NewTokenController() {
  useEffect(() => {
    let cancelled = false;
    let openAttempts = 0;
    let openTimer = 0;

    const pendingProjectId = sessionStorage.getItem(PENDING_PROJECT_KEY);
    if (pendingProjectId) {
      openTimer = window.setInterval(() => {
        if (cancelled) return;
        openAttempts += 1;

        const projectButtons = Array.from(
          document.querySelectorAll<HTMLButtonElement>(".project-main"),
        );
        const pendingButton = projectButtons.find((button) => {
          const text = buttonLabel(button);
          return text.includes("Untitled") && text.includes("$TOKEN");
        });

        if (pendingButton) {
          pendingButton.click();
          sessionStorage.removeItem(PENDING_PROJECT_KEY);
          window.clearInterval(openTimer);
          focusNewProjectEditor();
          return;
        }

        const projectsModal = document.querySelector(".projects-modal");
        if (!projectsModal) {
          const recoveryButton = Array.from(
            document.querySelectorAll<HTMLButtonElement>("button"),
          ).find((button) => isProjectRecoveryButtonLabel(buttonLabel(button)));
          recoveryButton?.click();
        }

        if (openAttempts >= 50) {
          sessionStorage.removeItem(PENDING_PROJECT_KEY);
          window.clearInterval(openTimer);
        }
      }, 100);
    }

    function handleNewTokenClick(event: MouseEvent) {
      const target = event.target as Element | null;
      const button = target?.closest<HTMLButtonElement>("button");
      if (!button) return;

      const label = buttonLabel(button);
      if (label !== "+ New token" && label !== "+ Create another token") return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      try {
        const blankProject = createBlankProject();
        const existingProjects = readProjects();
        localStorage.setItem(
          PROJECT_STORAGE_KEY,
          JSON.stringify([
            blankProject,
            ...existingProjects.filter((item) => item.id !== blankProject.id),
          ]),
        );
        sessionStorage.setItem(PENDING_PROJECT_KEY, blankProject.id);
        window.location.reload();
      } catch {
        window.alert(
          "The new token could not be created. Check that browser storage is enabled, then try again.",
        );
      }
    }

    document.addEventListener("click", handleNewTokenClick, true);
    return () => {
      cancelled = true;
      document.removeEventListener("click", handleNewTokenClick, true);
      if (openTimer) window.clearInterval(openTimer);
    };
  }, []);

  return null;
}
