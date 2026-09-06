"use client";

import { useEffect } from "react";
import { STUDIO_FIELD_PLAN_ATTRIBUTE, offersWebsiteBuild, studioFieldsForLaunchPath } from "@/lib/launch-path-fields";
import { REOPEN_GENERATED_SITE_EVENT } from "@/components/full-website-generator";
import { FREE_SITE_SECTION_KEYS, type FreeSiteSections } from "@/lib/free-site-sections";
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

type GenerateMode = "free" | "bespoke";

type GenerateDetail = {
  name: string;
  ticker: string;
  description: string;
  imageDataUrl?: string;
  inspirationUrl?: string;
  slug: string;
  supply: string;
  decimals: number;
  chain: "robinhood" | "solana";
  chainId: string;
  contractAddress: string;
  xHandle: string;
  telegram: string;
  sections: FreeSiteSections;
  mode: GenerateMode;
};

function findLabel(panel: Element, labelText: string): Element | undefined {
  const labels = Array.from(panel.querySelectorAll("label"));
  return labels.find(
    (item) => item.querySelector(".field-label")?.textContent?.replace("OPTIONAL", "").trim() === labelText,
  );
}

function findControl(panel: Element, labelText: string) {
  return findLabel(panel, labelText)?.querySelector("input, textarea") as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
}

function findCheckbox(panel: Element, labelText: string): HTMLInputElement | null {
  const input = findLabel(panel, labelText)?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  return input || null;
}

const SECTION_TOGGLE_LABELS: Record<keyof FreeSiteSections, string> = {
  about: "About",
  tokenomics: "Tokenomics",
  howToBuy: "How to buy",
};

function currentSections(panel: Element): FreeSiteSections {
  const sections = {} as FreeSiteSections;
  for (const key of FREE_SITE_SECTION_KEYS) {
    const checkbox = findCheckbox(panel, SECTION_TOGGLE_LABELS[key]);
    sections[key] = checkbox ? checkbox.checked : false;
  }
  return sections;
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
    let secondaryButton: HTMLButtonElement | null = null;
    let checklist: HTMLDivElement | null = null;
    let hint: HTMLParagraphElement | null = null;
    let generationTimeout: number | null = null;
    let lastReady = false;
    let lastChecklistHtml: string | null = null;

    function clearGenerationTimeout() {
      if (generationTimeout === null) return;
      window.clearTimeout(generationTimeout);
      generationTimeout = null;
    }

    // Issue #323 part 2.5: while the visitor is typing inside the builder
    // panel, the 250ms poll below must not rewrite the checklist DOM (a
    // contributor to the page-skipping bug) unless readiness genuinely
    // flipped — a real state change is worth the interruption, routine
    // polling noise is not.
    function isBuilderTextInputFocused(panel: Element): boolean {
      const active = document.activeElement;
      if (!active || !panel.contains(active)) return false;
      return active.tagName === "INPUT" || active.tagName === "TEXTAREA";
    }

    // The plan decides which fields exist (lib/launch-path-fields.ts); the
    // studio stamps it on the builder panel so this DOM-driven gate reads the
    // same answer React rendered.
    function planFields(panel: Element) {
      return studioFieldsForLaunchPath(panel.getAttribute(STUDIO_FIELD_PLAN_ATTRIBUTE));
    }

    function currentDetail(panel: Element, mode: GenerateMode): GenerateDetail {
      const chain = panel.querySelector(".chain-option.active .chain-dot.solana")
        ? "solana"
        : "robinhood";
      const fields = planFields(panel);
      return {
        name: findControl(panel, "Token name")?.value.trim() || "",
        ticker: findControl(panel, "Ticker")?.value.trim() || "",
        description: findControl(panel, "Project story")?.value.trim() || "",
        imageDataUrl: panel.querySelector<HTMLImageElement>(".upload-box img")?.src,
        // A URL typed under a paid plan is ignored once the plan no longer offers the field.
        inspirationUrl: fields.inspirationUrl
          ? panel.querySelector<HTMLInputElement>(".build-site-inspiration-url")?.value.trim() || ""
          : "",
        slug: findControl(panel, "Website path")?.value.trim() || "",
        supply: findControl(panel, "Total supply")?.value.trim() || "",
        decimals: Number(findControl(panel, "Decimals")?.value || 0),
        chain,
        chainId: chain === "robinhood" ? "46630" : "solana-devnet",
        contractAddress: findControl(panel, "Contract / mint address")?.value.trim() || "",
        xHandle: findControl(panel, "X handle")?.value.trim() || "",
        telegram: findControl(panel, "Telegram")?.value.trim() || "",
        sections: currentSections(panel),
        mode,
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
          <button class="build-site-secondary-button" type="button">Generate a bespoke AI site</button>
          <p class="build-site-secondary-hint">Takes longer and produces a one-off, fully custom AI design.</p>
        `;
        uploadBox.insertAdjacentElement("afterend", gate);
        button = gate.querySelector<HTMLButtonElement>(".build-site-button");
        secondaryButton = gate.querySelector<HTMLButtonElement>(".build-site-secondary-button");
        checklist = gate.querySelector<HTMLDivElement>(".build-site-checklist");
        hint = gate.querySelector<HTMLParagraphElement>(".build-site-hint");

        const resolvedPanel: Element = panel;
        function startGeneration(mode: GenerateMode) {
          if (button?.disabled || generating) return;
          const detail = currentDetail(resolvedPanel, mode);
          const next = startSitePreviewGeneration();
          unlocked = next.unlocked;
          generating = next.generating;
          if (hint) {
            hint.textContent =
              mode === "bespoke"
                ? "Your website preview is ready below. AI is now generating a bespoke, one-off design. This takes longer."
                : detail.inspirationUrl
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
        }

        button?.addEventListener("click", () => startGeneration("free"));
        secondaryButton?.addEventListener("click", () => startGeneration("bespoke"));
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

    function applyPlanVisibility(panel: Element) {
      const fields = planFields(panel);
      const showBuild = offersWebsiteBuild(fields);
      const inspiration = panel.querySelector<HTMLElement>(".build-site-inspiration-field");
      if (inspiration) inspiration.hidden = !fields.inspirationUrl;
      if (gate) {
        gate.hidden = !showBuild;
        gate.classList.toggle("bespoke-only", fields.bespokeGenerator && !fields.freeGenerator);
      }
      if (button) button.hidden = !fields.freeGenerator;
      if (hint) hint.hidden = !fields.freeGenerator;
      if (secondaryButton) secondaryButton.hidden = !fields.bespokeGenerator;
      const secondaryHint = gate?.querySelector<HTMLElement>(".build-site-secondary-hint");
      if (secondaryHint) secondaryHint.hidden = !fields.bespokeGenerator;
      return showBuild;
    }

    function refresh(fromPoll = false) {
      const elements = ensureElements();
      if (!elements || !button || !checklist || !overlay) return;

      const showBuild = applyPlanVisibility(elements.panel);
      const detail = currentDetail(elements.panel, "free");
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
      const readinessFlipped = ready !== lastReady;

      if (fromPoll && !readinessFlipped && isBuilderTextInputFocused(elements.panel)) return;
      lastReady = ready;

      if (!ready) unlocked = false;

      const checklistHtml = checks
        .map(
          (item) =>
            `<span class="${item.complete ? "complete" : ""}">${item.complete ? "✓" : "·"} ${item.label}</span>`,
        )
        .join("");
      if (checklistHtml !== lastChecklistHtml) {
        checklist.innerHTML = checklistHtml;
        lastChecklistHtml = checklistHtml;
      }

      button.disabled = !ready || generating;
      button.setAttribute("aria-busy", String(generating));
      button.textContent = generating
        ? detail.inspirationUrl
          ? "ANALYSING ARTWORK + INSPIRATION…"
          : "ANALYSING ARTWORK…"
        : unlocked
          ? "REGENERATE FROM ARTWORK ↻"
          : "GENERATE SITE FROM ARTWORK";
      if (secondaryButton) {
        secondaryButton.disabled = !ready || generating;
        secondaryButton.setAttribute("aria-busy", String(generating));
        secondaryButton.textContent = generating
          ? "GENERATING BESPOKE SITE…"
          : "Generate a bespoke AI site";
      }
      gate?.classList.toggle("ready", ready);
      gate?.classList.toggle("unlocked", unlocked);
      gate?.classList.toggle("generating", generating);
      // A token-only plan has no website to build, so it is never "locked"
      // behind the artwork gate and the preview panel keeps its own state.
      elements.previewPanel.classList.toggle("site-builder-locked", !unlocked && showBuild);
      overlay.hidden = unlocked || !showBuild;
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
            : detail?.style?.source === "free"
              ? "Your free site is ready, matched to your uploaded artwork."
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

    // A saved project's generated site can come back from either "Saved
    // launches" or the "Reopen generated site" toolbar button — both paths
    // dispatch this one event (issue #311), so unlocking here covers both
    // without the gate needing to know which control triggered it. The
    // event fires synchronously right after the studio calls setProject(),
    // before React has re-rendered the builder panel's inputs with the
    // reopened project's values — so refresh()'s readiness check would
    // still read the *previous* project's (possibly incomplete) fields and
    // could re-lock immediately. Unlock and reveal the preview right away
    // regardless of that stale DOM, and defer the readiness-dependent
    // refresh() to the next frame, by which point the panel reflects the
    // reopened project.
    function onReopen() {
      clearGenerationTimeout();
      generating = false;
      unlocked = true;
      if (hint) hint.textContent = "Your saved website preview is shown below.";
      const elements = ensureElements();
      if (elements) elements.previewPanel.classList.remove("site-builder-locked");
      if (overlay) overlay.hidden = true;
      document.querySelector(".preview-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.requestAnimationFrame(() => refresh());
    }

    window.addEventListener("launchpad:site-generated", onGenerated);
    window.addEventListener("launchpad:site-generation-failed", onFailed);
    window.addEventListener(REOPEN_GENERATED_SITE_EVENT, onReopen);
    // fromPoll=true only for this routine timer — every event-driven call
    // above (generated/failed/reopen) always applies immediately regardless
    // of input focus, since those reflect a real state change, not polling.
    const interval = window.setInterval(() => refresh(true), 250);
    refresh();

    return () => {
      clearGenerationTimeout();
      window.clearInterval(interval);
      window.removeEventListener("launchpad:site-generated", onGenerated);
      window.removeEventListener("launchpad:site-generation-failed", onFailed);
      window.removeEventListener(REOPEN_GENERATED_SITE_EVENT, onReopen);
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
      /* Build 02 on the shared premium theme (owner direction, 6 Sep 2026):
         the same well / raised / chip / CTA recipes the Token setup panel
         uses, read through the studio root's .hoodlums-premium variables. */
      .build-site-inspiration-field { display: block; margin-bottom: 16px; }
      .build-site-inspiration-field[hidden] { display: none; }
      .build-site-inspiration-field input {
        width: 100%;
        min-height: 46px;
        padding: 0 14px;
        border: var(--well-border, 1px solid rgba(255,255,255,.09));
        border-radius: var(--well-radius, 14px);
        outline: none;
        color: var(--text-primary, #f4f7f1);
        background: var(--well-bg, #0a0f0c);
        box-shadow: var(--well-shadow, none);
        font-size: 14px;
      }
      .build-site-inspiration-field input:focus { border-color: rgba(198,245,62,.5); }
      .build-site-inspiration-field input:invalid:not(:placeholder-shown) { border-color: rgba(226,86,75,.7); }
      .build-site-inspiration-help {
        display: block;
        margin-top: 7px;
        color: var(--text-faint, #6f746e);
        font: 9px/1.55 "IBM Plex Mono", monospace;
        text-align: left;
      }
      .build-site-gate {
        display: grid;
        gap: 11px;
        margin: -5px 0 17px;
        padding: 15px;
        border: var(--raised-border, 1px solid rgba(255,255,255,.1));
        border-radius: 16px;
        background: var(--raised-bg, #111713);
        box-shadow: var(--raised-shadow, none);
      }
      .build-site-gate[hidden] { display: none; }
      .build-site-gate.ready { border-color: rgba(198,245,62,.35); }
      .build-site-gate.generating { border-color: rgba(198,245,62,.5); }
      .build-site-gate-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .build-site-gate-heading span {
        color: var(--accent-lime, #c6f53e);
        font: 600 9.5px "IBM Plex Mono", monospace;
        letter-spacing: .18em;
        white-space: nowrap;
      }
      .build-site-gate-heading strong { color: var(--text-primary, #f4f7f1); font-size: 13px; }
      .build-site-checklist { display: grid; gap: 6px; }
      .build-site-checklist span { color: var(--text-faint, #6f746e); font: 600 10px "IBM Plex Mono", monospace; }
      .build-site-checklist span.complete { color: var(--text-secondary, #c3c9c4); }
      .build-site-checklist span.complete::first-letter { color: var(--accent-lime, #c6f53e); }
      .build-site-button {
        min-height: 46px;
        border: var(--well-border, 1px solid rgba(255,255,255,.09));
        border-radius: 12px;
        color: var(--text-disabled, #4a4f49);
        background: var(--well-bg, #0a0f0c);
        box-shadow: var(--well-shadow, none);
        font: 800 11px "Inter", sans-serif;
        letter-spacing: .01em;
      }
      .build-site-button:not(:disabled) {
        color: var(--cta-color, #071008);
        border-color: transparent;
        background: var(--cta-bg, #c6f53e);
        box-shadow: 0 10px 30px -12px rgba(198,245,62,.6);
      }
      .build-site-button:disabled { cursor: not-allowed; }
      .build-site-gate.unlocked .build-site-button {
        color: var(--chip-active-color, #c6f53e);
        border-color: var(--chip-active-border-color, rgba(198,245,62,.5));
        background: var(--chip-active-bg, rgba(198,245,62,.1));
        box-shadow: var(--chip-active-shadow, none);
        text-shadow: var(--chip-active-text-shadow, none);
      }
      .build-site-gate.generating .build-site-button {
        color: var(--text-secondary, #c3c9c4);
        border-color: rgba(198,245,62,.35);
        background: var(--well-bg, #0a0f0c);
        box-shadow: var(--well-shadow, none);
      }
      .build-site-button[hidden], .build-site-hint[hidden],
      .build-site-secondary-button[hidden], .build-site-secondary-hint[hidden] { display: none; }
      .build-site-hint { margin: 0; color: var(--text-faint, #6f746e); font: 9px/1.5 "IBM Plex Mono", monospace; }
      .build-site-secondary-button {
        min-height: 40px;
        border: var(--raised-border, 1px solid rgba(255,255,255,.1));
        border-radius: 12px;
        color: var(--text-secondary, #c3c9c4);
        background: var(--raised-bg, transparent);
        box-shadow: var(--raised-shadow, none);
        font: 700 9px "IBM Plex Mono", monospace;
        letter-spacing: .06em;
      }
      .build-site-secondary-button:hover:not(:disabled) { border-color: rgba(198,245,62,.5); }
      .build-site-secondary-button:disabled { cursor: not-allowed; opacity: .55; }
      /* Paid plan: the bespoke button is the only generator, so it takes the primary CTA recipe. */
      .build-site-gate.bespoke-only .build-site-secondary-button {
        min-height: 46px;
        font: 800 11px "Inter", sans-serif;
        letter-spacing: .01em;
      }
      .build-site-gate.bespoke-only .build-site-secondary-button:not(:disabled) {
        color: var(--cta-color, #071008);
        border-color: transparent;
        background: var(--cta-bg, #c6f53e);
        box-shadow: 0 10px 30px -12px rgba(198,245,62,.6);
      }
      .build-site-gate.bespoke-only .build-site-secondary-button::after { font: 800 11px "Inter", sans-serif; letter-spacing: .01em; }
      .build-site-secondary-hint { margin: 0; color: var(--text-faint, #6f746e); font: 9px/1.5 "IBM Plex Mono", monospace; }
      .build-site-optional-marker {
        float: right;
        margin-left: 8px;
        color: var(--accent-lime, #c6f53e);
        font-size: 8px;
        letter-spacing: .08em;
      }
      .preview-panel { position: relative; }
      .build-site-lock {
        position: absolute;
        inset: 0;
        z-index: 70;
        display: grid;
        place-items: center;
        padding: 24px;
        border: var(--panel-border, 1px solid rgba(255,255,255,.09));
        border-radius: var(--panel-radius, 22px);
        background: rgba(10,11,9,.92);
        backdrop-filter: blur(10px);
        text-align: center;
      }
      .build-site-lock[hidden] { display: none; }
      .build-site-lock div { max-width: 470px; }
      .build-site-lock span {
        display: block;
        margin-bottom: 11px;
        color: var(--accent-lime, #c6f53e);
        font: 600 9.5px "IBM Plex Mono", monospace;
        letter-spacing: .18em;
      }
      .build-site-lock strong {
        display: block;
        margin-bottom: 10px;
        color: var(--text-primary, #f4f7f1);
        font: 800 clamp(21px, 3vw, 34px)/1.1 var(--display, "Archivo Black", "Inter", sans-serif);
        letter-spacing: -0.02em;
      }
      .build-site-lock p { margin: 0; color: var(--text-sub, #a8aaa9); font: 11px/1.7 "IBM Plex Mono", monospace; }
      .site-builder-locked > :not(.build-site-lock) {
        filter: saturate(.35) brightness(.5);
        pointer-events: none;
        user-select: none;
      }
      @media (max-width: 780px) { .build-site-lock { inset: 0 0 30px; } }
    `}</style>
  );
}
