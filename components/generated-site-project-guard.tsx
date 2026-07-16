"use client";

import { useEffect } from "react";

const STORAGE_KEY = "launchpad.generated-site-style.v1";

function fieldValue(labelText: string) {
  const labels = Array.from(document.querySelectorAll(".builder-panel label"));
  const label = labels.find(
    (item) => item.querySelector(".field-label")?.textContent?.replace("OPTIONAL", "").trim() === labelText,
  );
  return (label?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null)?.value.trim() || "";
}

function clearGeneratedPreview() {
  const site = document.querySelector<HTMLElement>(".site-preview");
  if (!site) return false;
  const hadGeneratedStyle = site.classList.contains("artwork-generated-site");
  site.classList.remove("artwork-generated-site");
  delete site.dataset.generatedLayout;
  delete site.dataset.generatedMood;
  delete site.dataset.generatedTexture;
  delete site.dataset.generatedRadius;
  [
    "--generated-bg",
    "--generated-surface",
    "--generated-text",
    "--generated-muted",
    "--generated-primary",
    "--generated-secondary",
    "--generated-accent",
  ].forEach((property) => site.style.removeProperty(property));
  document.querySelector(".generated-style-badge")?.remove();
  return hadGeneratedStyle;
}

function relockAfterProjectChange() {
  if (!clearGeneratedPreview()) return;
  window.dispatchEvent(
    new CustomEvent("launchpad:site-generation-failed", {
      detail: { message: "This is a different token project. Generate a new site from its artwork." },
    }),
  );
}

export function GeneratedSiteProjectGuard() {
  useEffect(() => {
    let lastKey = "";

    function refresh() {
      const name = fieldValue("Token name");
      const ticker = fieldValue("Ticker");
      const currentKey = `${name.toLowerCase()}::${ticker.toUpperCase()}`;
      if (currentKey === lastKey) return;
      lastKey = currentKey;

      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          relockAfterProjectChange();
          return;
        }
        const stored = JSON.parse(raw) as { key?: string };
        if (stored.key !== currentKey) relockAfterProjectChange();
      } catch {
        relockAfterProjectChange();
      }
    }

    const interval = window.setInterval(refresh, 300);
    refresh();
    return () => window.clearInterval(interval);
  }, []);

  return null;
}
