"use client";

import { useEffect } from "react";
import {
  SITE_GENERATION_TIMEOUT_MS,
  failSitePreviewGeneration,
  finishSitePreviewGeneration,
  previewFailureMessage,
  previewTimeoutMessage,
  startSitePreviewGeneration,
} from "@/lib/site-preview-state";

const REQUIRED_DESCRIPTION_LENGTH = 20;
const MAX_INSPIRATION_URL_LENGTH = 500;

type GenerateDetail = {
  name: string;
  ticker: string;
  description: string;
  imageDataUrl?: string;
  inspirationUrl?: string;
};

function findControl(panel: Element, labelText: string) {
  const labels = Array.from(panel.querySelectorAll("label"));
  const label = labels.find(
    (item) => item.querySelector(".field-label")?.textContent?.replace("OPTIONAL", "").trim() === labelText,
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

export function isValidInspirationWebsiteUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > MAX_INSPIRATION_URL_LENGTH) return false;

  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase();
    const rawIp = /^(?:\d{1,3}\.){3}\d{1,3}$|^\[[0-9a-f:]+\]$/i;
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      hostname.includes(".") &&
      hostname !== "localhost" &&
      !hostname.endsWith(".localhost") &&
      !hostname.endsWith(".local") &&
      !rawIp.test(hostname)
    );
  } catch {
    return false;
  }
}

function ensureInspirationField(panel: Element, uploadBox: Element) {
  const existing = panel.querySelector<HTMLInputElement>(".build-site-inspiration-url");
  if (existing) return existing;

  const label = document.createElement("label");
  label.className = "build-site-inspiration-field";
  label.innerHTML = `
    <span class="field-label">
      Inspiration website URL
      <span class="build-site-optional-marker">OPTIONAL</span>
    </span>
    <input
      class="build-site-inspiration-url"
      type="url"
      inputmode="url"
      maxlength="${MAX_INSPIRATION_URL_LENGTH}"
      autocomplete="url"
      placeholder="https://example.com"
      aria-describedby="build-site-inspiration-help"
    />
    <small id="build-site-inspiration-help" class="build-site-inspiration-help">
      Uploaded artwork/content is still required. This optional link only guides the visual direction.
    </small>
  `;
  uploadBox.insertAdjacentElement("beforebegin", label);
  return label.querySelector<HTMLInputElement>(".build-site-inspiration-url");
}

export function BuildSiteGate() {
  useEffect(() => {
    let unlocked = false;
    let generating = false;
    let gate: HTMLDivElement | null = null;
    let overlay: HTMLDivElement | null = null;
    let button: HTMLButtonElement | null = null;
    let checklist: HTMLDivElement | null = null;
    let hint: HTMLParagraphElement | null = null;
    let generationTimeout: number | null = null;

    function clearGenerationTimeout() {
      if (generationTimeout === null) return;
      window.clearTimeout(generationTimeout);
      generationTimeout = null;
    }

    function currentDetail(panel: Element): GenerateDetail {
      return {
        name: findControl(panel, "Token name")?.value.trim() || "",
        ticker: findControl(panel, "Ticker")?.value.trim() || "",
        description: findControl(panel, "Project story")?.value.trim() || "",
        imageDataUrl: panel.querySelector<HTMLImageElement>(".upload-box img")?.src,
        inspirationUrl:
          panel.querySelector<HTMLInputElement>(".build-site-inspiration-url")?.value.trim() || "",
      };
    }

    function ensureElements() {
      const panel = document.querySelector(".builder-panel");
      const uploadBox = panel?.querySelector(".upload-box");
      const previewPanel = document.querySelector<HTMLElement>(".preview-panel");

      if (!panel || !uploadBox || !previewPanel) return null;

      addOptionalMarker(panel, "X handle");
      addOptionalMarker(panel, "Telegram");
      ensureInspirationField(panel, uploadBox);

      if (!gate || !gate.isConnected) {
        gate = document.createElement("div");
        gate.className = "build-site-gate";
        gate.innerHTML = `
          <div class="build-site-gate-heading">
            <span>BUILD 02</span>
            <strong>Artwork-matched website</strong>
          </div>
          <div class="build-site-checklist" aria-live="polite"></div>
          <button class="build-site-button" type="button">GENERATE SITE FROM ARTWORK</button>
          <p class="build-site-hint">Upload content to define the site. An inspiration website is optional.</p>
        `;
        uploadBox.insertAdjacentElement("afterend", gate);
        button = gate.querySelector<HTMLButtonElement>(".build-site-button");
        checklist = gate.querySelector<HTMLDivElement>(".build-site-checklist");
        hint = gate.querySelector<HTMLParagraphElement>(".build-site-hint");

        button?.addEventListener("click", () => {
          if (button?.disabled || generating) return;
          const detail = currentDetail(panel);
          const next = startSitePreviewGeneration();
          unlocked = next.unlocked;
          generating = next.generating;
          if (hint) {
            hint.textContent = detail.inspirationUrl
              ? "Your website preview is ready below. AI is now applying the inspiration website."
              : "Your website preview is ready below. AI is now enhancing it from the uploaded artwork.";
          }
          refresh();
          document.querySelector(".preview-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });

          clearGenerationTimeout();
          generationTimeout = window.setTimeout(() => {
            if (!generating) return;
            const timedOut = finishSitePreviewGeneration();
            unlocked = timedOut.unlocked;
            generating = timedOut.generating;
            if (hint) hint.textContent = previewTimeoutMessage(Boolean(detail.inspirationUrl));
            refresh();
          }, SITE_GENERATION_TIMEOUT_MS);

          window.dispatchEvent(new CustomEvent("launchpad:generate-site", { detail }));
        });
      }

      if (!overlay || !overlay.isConnected) {
        overlay = document.createElement("div");
        overlay.className = "build-site-lock";
        overlay.innerHTML = `
          <div>
            <span>ARTWORK WEBSITE GENERATOR</span>
            <strong>Your artwork should define the website</strong>
            <p>Enter the project details and upload content. You may also add an optional website for design inspiration.</p>
          </div>
        `;
        previewPanel.appendChild(overlay);
      }

      return { panel, previewPanel };
    }

    function refresh() {
      const elements = ensureElements();
      if (!elements || !button || !checklist || !overlay) return;

      const detail = currentDetail(elements.panel);
      const checks = [
        { label: "Token name", complete: detail.name.length >= 2 },
        { label: "Ticker", complete: /^[A-Za-z0-9]{2,12}$/.test(detail.ticker) },
        {
          label: `Description (${REQUIRED_DESCRIPTION_LENGTH}+ characters)`,
          complete: detail.description.length >= REQUIRED_DESCRIPTION_LENGTH,
        },
        {
          label: "Uploaded artwork/content",
          complete: Boolean(detail.imageDataUrl?.startsWith("data:image/")),
        },
      ];
      if (detail.inspirationUrl) {
        checks.push({
          label: "Valid inspiration website URL",
          complete: isValidInspirationWebsiteUrl(detail.inspirationUrl),
        });
      }
      const ready = checks.every((item) => item.complete);

      if (!ready) unlocked = false;

      checklist.innerHTML = checks
        .map(
          (item) =>
            `<span class="${item.complete ? "complete" : ""}">${item.complete ? "✓" : "·"} ${item.label}</span>`,
        )
        .join("");

      button.disabled = !ready || generating;
      button.setAttribute("aria-busy", String(generating));
      button.textContent = generating
        ? detail.inspirationUrl
          ? "ANALYSING ARTWORK + INSPIRATION…"
          : "ANALYSING ARTWORK…"
        : unlocked
          ? "REGENERATE FROM ARTWORK ↻"
          : "GENERATE SITE FROM ARTWORK";
      gate?.classList.toggle("ready", ready);
      gate?.classList.toggle("unlocked", unlocked);
      gate?.classList.toggle("generating", generating);
      elements.previewPanel.classList.toggle("site-builder-locked", !unlocked);
      overlay.hidden = unlocked;
    }

    function onGenerated(event: Event) {
      clearGenerationTimeout();
      const detail = (event as CustomEvent<{
        style?: { source?: string; inspirationUsed?: boolean };
      }>).detail;
      const next = finishSitePreviewGeneration();
      generating = next.generating;
      unlocked = next.unlocked;
      const hasInspiration = Boolean(
        document.querySelector<HTMLInputElement>(".build-site-inspiration-url")?.value.trim(),
      );
      if (hint) {
        hint.textContent =
          detail?.style?.source === "openai"
            ? detail.style.inspirationUsed
              ? "AI analysed the uploaded content and inspiration website and applied the finished design."
              : "AI analysed the uploaded artwork and applied the finished design."
            : hasInspiration
              ? "Your artwork-based website is visible. AI inspiration enhancement is still required for the URL."
              : "The browser matched the uploaded artwork's palette, mood and shape.";
      }
      refresh();
      document.querySelector(".preview-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function onFailed(event: Event) {
      clearGenerationTimeout();
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      const next = failSitePreviewGeneration(unlocked);
      generating = next.generating;
      unlocked = next.unlocked;
      if (hint) hint.textContent = previewFailureMessage(message, unlocked);
      refresh();
    }

    window.addEventListener("launchpad:site-generated", onGenerated);
    window.addEventListener("launchpad:site-generation-failed", onFailed);
    const interval = window.setInterval(refresh, 250);
    refresh();

    return () => {
      clearGenerationTimeout();
      window.clearInterval(interval);
      window.removeEventListener("launchpad:site-generated", onGenerated);
      window.removeEventListener("launchpad:site-generation-failed", onFailed);
      gate?.remove();
      overlay?.remove();
      document.querySelector(".build-site-inspiration-field")?.remove();
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
      .build-site-inspiration-field { display: block; margin-bottom: 16px; }
      .build-site-inspiration-field input {
        width: 100%;
        min-height: 48px;
        padding: 0 13px;
        border: 1px solid rgba(131,183,139,.2);
        border-radius: 7px;
        outline: none;
        color: #f3f6ef;
        background: #070b08;
        font-size: 14px;
      }
      .build-site-inspiration-field input:focus { border-color: rgba(85,255,120,.65); }
      .build-site-inspiration-field input:invalid:not(:placeholder-shown) { border-color: rgba(255,102,102,.7); }
      .build-site-inspiration-help {
        display: block;
        margin-top: 7px;
        color: #68736a;
        font: 9px/1.55 "IBM Plex Mono", monospace;
      }
      .build-site-gate {
        display: grid;
        gap: 11px;
        margin: -5px 0 17px;
        padding: 15px;
        border: 1px solid rgba(241,207,85,.28);
        border-radius: 8px;
        background: linear-gradient(145deg, rgba(241,207,85,.055), rgba(85,255,120,.025));
      }
      .build-site-gate.ready { border-color: rgba(85,255,120,.45); }
      .build-site-gate.generating { border-color: rgba(125,173,255,.65); }
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
      .build-site-gate-heading strong { color: #f4f7ef; font-size: 13px; }
      .build-site-checklist { display: grid; gap: 6px; }
      .build-site-checklist span { color: #6f7b72; font: 600 10px "IBM Plex Mono", monospace; }
      .build-site-checklist span.complete { color: #b9c4bb; }
      .build-site-checklist span.complete::first-letter { color: #55ff78; }
      .build-site-button {
        min-height: 45px;
        border: 1px solid rgba(85,255,120,.22);
        border-radius: 7px;
        color: #435047;
        background: #111713;
        font: 800 10px "IBM Plex Mono", monospace;
        letter-spacing: .06em;
      }
      .build-site-button:not(:disabled) {
        color: #061008;
        background: #55ff78;
        box-shadow: 0 8px 24px rgba(85,255,120,.14);
      }
      .build-site-button:disabled { cursor: not-allowed; }
      .build-site-gate.unlocked .build-site-button {
        color: #fff7ca;
        border-color: rgba(241,207,85,.48);
        background: #172014;
      }
      .build-site-gate.generating .build-site-button {
        color: #dce8ff;
        border-color: rgba(125,173,255,.45);
        background: #11192a;
      }
      .build-site-hint { margin: 0; color: #68736a; font: 9px/1.5 "IBM Plex Mono", monospace; }
      .build-site-optional-marker {
        float: right;
        margin-left: 8px;
        color: #f1cf55;
        font-size: 8px;
        letter-spacing: .08em;
      }
      .preview-panel { position: relative; }
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
      .build-site-lock[hidden] { display: none; }
      .build-site-lock div { max-width: 470px; }
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
      .build-site-lock p { margin: 0; color: #849087; font: 11px/1.7 "IBM Plex Mono", monospace; }
      .site-builder-locked > :not(.build-site-lock) {
        filter: saturate(.35) brightness(.5);
        pointer-events: none;
        user-select: none;
      }
      @media (max-width: 780px) { .build-site-lock { inset: 16px 10px 30px; } }
    `}</style>
  );
}
