"use client";

import { useState } from "react";
import type { TokenProject } from "@/lib/types";

const PROJECT_STORAGE_KEY = "private-meme-token-studio-projects-v1";

function readField(panel: Element, labelText: string): string {
  const labels = Array.from(panel.querySelectorAll("label"));
  const label = labels.find(
    (item) =>
      item.querySelector(".field-label")?.textContent?.trim() === labelText,
  );
  const control = label?.querySelector("input, textarea") as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  return control?.value.trim() || "";
}

function getCurrentStudioProject(): TokenProject | null {
  const panel = document.querySelector(".builder-panel");
  if (!panel) return null;

  const activeNetwork = panel.querySelector(".chain-option.active")?.textContent || "";
  if (!activeNetwork.includes("Robinhood")) return null;

  const now = new Date().toISOString();
  const name = readField(panel, "Token name");
  const ticker = readField(panel, "Ticker").toUpperCase();
  const websiteSlug = readField(panel, "Website path");
  const rawDecimals = Number(readField(panel, "Decimals"));
  const artwork = panel.querySelector(".upload-box img") as HTMLImageElement | null;

  let existingProjects: TokenProject[] = [];
  try {
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as TokenProject[]) : [];
    existingProjects = Array.isArray(parsed) ? parsed : [];
  } catch {
    existingProjects = [];
  }

  const existing = existingProjects.find(
    (item) =>
      item.chain === "robinhood" &&
      item.ticker.toUpperCase() === ticker &&
      item.websiteSlug === websiteSlug,
  );

  return {
    id: existing?.id || crypto.randomUUID(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    status: existing?.status || "draft",
    chain: "robinhood",
    name,
    ticker,
    description: readField(panel, "Project story"),
    supply: readField(panel, "Total supply"),
    decimals: Number.isFinite(rawDecimals) ? rawDecimals : 18,
    websiteSlug,
    contractAddress: readField(panel, "Contract / mint address"),
    xHandle: readField(panel, "X handle"),
    telegram: readField(panel, "Telegram"),
    heroImage: artwork?.src || existing?.heroImage || "",
    theme: "hoodlums",
  };
}

export function StudioProviderTransfer() {
  const [message, setMessage] = useState("");

  function transferProject() {
    const project = getCurrentStudioProject();
    if (!project) {
      setMessage("Select Robinhood Chain in the studio before copying to NOXA or Pons.");
      return;
    }

    try {
      const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as TokenProject[]) : [];
      const projects = Array.isArray(parsed) ? parsed : [];
      const nextProjects = [
        project,
        ...projects.filter((item) => item.id !== project.id),
      ];
      localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(nextProjects));
      setMessage("Studio details copied. Opening provider launch desk…");
      window.setTimeout(() => window.location.assign("/providers?source=studio"), 80);
    } catch {
      setMessage("The browser could not copy this project. Check that local storage is enabled.");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        bottom: 122,
        zIndex: 81,
        display: "grid",
        justifyItems: "end",
        gap: 8,
      }}
    >
      {message && (
        <div
          role="status"
          style={{
            maxWidth: 310,
            padding: "10px 12px",
            border: "1px solid rgba(85,255,120,.35)",
            borderRadius: 8,
            background: "rgba(4,12,6,.96)",
            color: "#dfffe5",
            boxShadow: "0 12px 35px rgba(0,0,0,.45)",
            font: '600 11px "IBM Plex Mono", monospace',
            lineHeight: 1.45,
          }}
        >
          {message}
        </div>
      )}
      <button
        type="button"
        onClick={transferProject}
        style={{
          padding: "12px 15px",
          border: "1px solid rgba(232,196,53,.65)",
          borderRadius: 8,
          color: "#fff7ca",
          background: "#172014",
          boxShadow: "0 12px 35px rgba(0,0,0,.4)",
          cursor: "pointer",
          font: '800 10px "IBM Plex Mono", monospace',
        }}
      >
        COPY DETAILS TO PROVIDER ↗
      </button>
    </div>
  );
}
