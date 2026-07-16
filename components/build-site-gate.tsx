"use client";

import { useEffect } from "react";

const REQUIRED_DESCRIPTION_LENGTH = 20;

function findControl(panel: Element, labelText: string) {
  const labels = Array.from(panel.querySelectorAll("label"));
  const label = labels.find(
    (item) => item.querySelector(".field-label")?.textContent?.trim() === labelText,
  );
  return label?.querySelector("input, textarea") as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
}

function addOptionalMarker(panel: Element, labelText: string) {
  const labels = Array.from(panel.querySelectorAll("label"));
  const label = labels.find(
    (item) => item.querySelector(".field-label")?.textContent?.trim() === labelText,
  );
  const heading = label?.querySelector(".field-label");
  if (!heading || heading.querySelector(".build-site-optional-marker")) return;

  const marker = document.createElement("span");
  marker.className = "build-site-optional-marker";
  marker.textContent = "OPTIONAL";
  heading.appendChild(marker);
}

export function BuildSiteGate() {
  useEffect(() => {
    let unlocked = false;
    let gate: HTMLDivElement | null = null;
    let overlay: HTMLDivElement | null = null;
    let button: HTMLButtonElement | null = null;
    let checklist: HTMLDivElement | null = null;

    function ensureElements() {
      const panel = document.querySelector(".builder-panel");
      const uploadBox = panel?.querySelector(".upload-box");
      const previewPanel = document.querySelector(".preview-panel");

      if (!panel || !uploadBox || !previewPanel) return null;

      addOptionalMarker(panel, "X handle");
      addOptionalMarker(panel, "Telegram");

      if (!gate || !gate.isConnected) {
        gate = document.createElement("div");
        gate.className = "build-site-gate";
        gate.innerHTML = `
          <div class="build-site-gate-heading">
            <span>BUILD 02</span>
            <strong>Website builder</strong>
          </div>
          <div class="build-site-checklist" aria-live="polite"></div>
          <button class="build-site-button" type="button">BUILD SITE</button>
          <p class="build-site-hint">Social accounts are optional and can be added later.</p>
        `;
        uploadBox.insertAdjacentElement("afterend", gate);
        button = gate.querySelector(".build-site-button");
        checklist = gate.querySelector(".build-site-checklist");

        button?.addEventListener("click", () => {
          if (button?.disabled) return;
          unlocked = true;
          refresh();
          previewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }

      if (!overlay || !overlay.isConnected) {
        overlay = document.createElement("div");
        overlay.className = "build-site-lock";
        overlay.innerHTML = `
          <div>
            <span>WEBSITE BUILDER LOCKED</span>
            <strong>Complete the required project details</strong>
            <p>Enter a token name, ticker and description, then press BUILD SITE.</p>
          </div>
        `;
        previewPanel.appendChild(overlay);
      }

      return { panel, previewPanel };
    }

    function refresh() {
      const elements = ensureElements();
      if (!elements || !button || !checklist || !overlay) return;

      const name = findControl(elements.panel, "Token name")?.value.trim() || "";
      const ticker = findControl(elements.panel, "Ticker")?.value.trim() || "";
      const description = findControl(elements.panel, "Project story")?.value.trim() || "";

      const checks = [
        { label: "Token name", complete: name.length >= 2 },
        { label: "Ticker", complete: /^[A-Za-z0-9]{2,12}$/.test(ticker) },
        {
          label: `Description (${REQUIRED_DESCRIPTION_LENGTH}+ characters)`,
          complete: description.length >= REQUIRED_DESCRIPTION_LENGTH,
        },
      ];
      const ready = checks.every((item) => item.complete);

      if (!ready) unlocked = false;

      checklist.innerHTML = checks
        .map(
          (item) =>
            `<span class="${item.complete ? "complete" : ""}">${item.complete ? "✓" : "·"} ${item.label}</span>`,
        )
        .join("");

      button.disabled = !ready;
      button.textContent = unlocked ? "SITE BUILDER OPEN ✓" : "BUILD SITE";
      gate?.classList.toggle("ready", ready);
      gate?.classList.toggle("unlocked", unlocked);
      elements.previewPanel.classList.toggle("site-builder-locked", !unlocked);
      overlay.hidden = unlocked;
    }

    const interval = window.setInterval(refresh, 250);
    refresh();

    return () => {
      window.clearInterval(interval);
      gate?.remove();
      overlay?.remove();
      document
        .querySelectorAll(".build-site-optional-marker")
        .forEach((marker) => marker.remove());
      document
        .querySelector(".preview-panel")
        ?.classList.remove("site-builder-locked");
    };
  }, []);

  return (
    <style>{`
      .build-site-gate {
        display: grid;
        gap: 11px;
        margin: -5px 0 17px;
        padding: 15px;
        border: 1px solid rgba(241,207,85,.28);
        border-radius: 8px;
        background: linear-gradient(145deg, rgba(241,207,85,.055), rgba(85,255,120,.025));
      }
      .build-site-gate.ready {
        border-color: rgba(85,255,120,.45);
      }
      .build-site-gate-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .build-site-gate-heading span {
        color: #f1cf55;
        font: 700 9px "IBM Plex Mono", monospace;
        letter-spacing: .14em;
      }
      .build-site-gate-heading strong {
        color: #f4f7ef;
        font-size: 13px;
      }
      .build-site-checklist {
        display: grid;
        gap: 6px;
      }
      .build-site-checklist span {
        color: #6f7b72;
        font: 600 10px "IBM Plex Mono", monospace;
      }
      .build-site-checklist span.complete {
        color: #b9c4bb;
      }
      .build-site-checklist span.complete::first-letter {
        color: #55ff78;
      }
      .build-site-button {
        min-height: 45px;
        border: 1px solid rgba(85,255,120,.22);
        border-radius: 7px;
        color: #435047;
        background: #111713;
        font: 800 11px "IBM Plex Mono", monospace;
        letter-spacing: .08em;
      }
      .build-site-button:not(:disabled) {
        color: #061008;
        background: #55ff78;
        box-shadow: 0 8px 24px rgba(85,255,120,.14);
      }
      .build-site-button:disabled {
        cursor: not-allowed;
      }
      .build-site-gate.unlocked .build-site-button {
        color: #fff7ca;
        border-color: rgba(241,207,85,.48);
        background: #172014;
      }
      .build-site-hint {
        margin: 0;
        color: #68736a;
        font: 9px/1.5 "IBM Plex Mono", monospace;
      }
      .build-site-optional-marker {
        float: right;
        margin-left: 8px;
        color: #f1cf55;
        font-size: 8px;
        letter-spacing: .08em;
      }
      .preview-panel {
        position: relative;
      }
      .build-site-lock {
        position: absolute;
        inset: 24px;
        z-index: 70;
        display: grid;
        place-items: center;
        padding: 24px;
        border: 1px solid rgba(241,207,85,.28);
        border-radius: 10px;
        background: rgba(5,7,6,.92);
        backdrop-filter: blur(10px);
        text-align: center;
      }
      .build-site-lock[hidden] {
        display: none;
      }
      .build-site-lock div {
        max-width: 430px;
      }
      .build-site-lock span {
        display: block;
        margin-bottom: 11px;
        color: #f1cf55;
        font: 700 9px "IBM Plex Mono", monospace;
        letter-spacing: .14em;
      }
      .build-site-lock strong {
        display: block;
        margin-bottom: 10px;
        color: #f4f7ef;
        font-size: clamp(21px, 3vw, 34px);
      }
      .build-site-lock p {
        margin: 0;
        color: #849087;
        font: 11px/1.7 "IBM Plex Mono", monospace;
      }
      .site-builder-locked > :not(.build-site-lock) {
        filter: saturate(.35) brightness(.5);
        pointer-events: none;
        user-select: none;
      }
      @media (max-width: 780px) {
        .build-site-lock { inset: 16px 10px 30px; }
      }
    `}</style>
  );
}
