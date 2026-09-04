"use client";

import { useEffect } from "react";
import { createWalletClient, custom } from "viem";
import type { FreeSiteSections } from "@/lib/free-site-sections";
import { isFreeSiteTemplateHtml, substituteFreeSitePlatformFacts } from "@/lib/free-site-platform-facts";
import { isGeneratedPageRejectedForLayoutOnly, prepareGeneratedPageForPreview } from "@/lib/generated-site-page";
import {
  parseGenerateSitePageStreamLine,
  splitNdjsonLines,
  type GenerateSitePageProgressStage,
} from "@/lib/generate-site-page-stream-protocol";
import { PROJECT_SAVE_RESULT_EVENT, type ProjectSaveResultDetail } from "@/lib/project-save-result";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";

type GenerateDetail = {
  name: string;
  ticker: string;
  description: string;
  imageDataUrl?: string;
  inspirationUrl?: string;
  slug?: string;
  supply?: string;
  decimals?: number;
  chain?: "robinhood" | "solana";
  chainId?: string;
  contractAddress?: string;
  xHandle?: string;
  telegram?: string;
  sections?: FreeSiteSections;
  mode?: "free" | "bespoke";
};

export type PublishableSitePayload = {
  slug: string;
  name: string;
  ticker: string;
  description: string;
  supply: string;
  decimals: number;
  chain: "robinhood" | "solana";
  chainId: string;
  contractAddress: string;
  generatedSiteHtml: string;
  artworkReference: string;
  xHandle: string;
  telegram: string;
  status: "prepared";
};

// Dispatched by the studio (see components/token-studio.tsx) to redisplay a
// previously captured generation without calling the AI generator again —
// regenerating is a fresh, non-deterministic model call and must never be
// the only way to see a site the user already generated (issue #198).
export const REOPEN_GENERATED_SITE_EVENT = "launchpad:reopen-generated-site";

type ReopenGeneratedSiteDetail = {
  imageDataUrl?: string;
  site: PublishableSitePayload;
};

type PublishChallengeResponse = {
  challengeId: string;
  nonce: string;
  message: string;
};

type DraftPublishResponse = {
  slug: string;
  draftPreviewUrl: string | null;
};

type GoLiveResponse = {
  slug: string;
  publicUrl: string;
};

type PreviewStatus = "generating" | "failed";

type RequestGeneratedWebsiteOptions = {
  signal?: AbortSignal;
  onProgress?: (stage: GenerateSitePageProgressStage) => void;
};

type RenderedPreview = {
  container: HTMLElement;
  backdrop: HTMLElement;
  frame: HTMLIFrameElement;
  closeButton: HTMLButtonElement;
  fullScreenButton: HTMLButtonElement;
  onClose: () => void;
  onToggleFullScreen: () => void;
  // Toggles the mobile full-screen controls overlay; called both from the
  // shell's own tap listener and from a "hoodlums-generated-page-tap"
  // message forwarded by the sandboxed iframe (see onMessage below) — a tap
  // landing on the generated page's own content never reaches the parent
  // DOM as a normal bubbling click, so the iframe has to report it itself.
  onFrameTap: () => void;
  controlCleanups: Array<() => void>;
  // Windowed mode renders the iframe at a larger design width, scaled down
  // (see computeGeneratedPreviewScale), so applyHeight/applyLayout must be
  // able to recompute that layout whenever the reported content height or
  // the available viewport width changes.
  applyHeight: (reportedHeight: number) => void;
  applyLayout: () => void;
};

// Finds a studio control button by its visible label. Used to drive "Save
// preview" through the exact same durable save path as the studio's own
// "Save project" button (see components/token-studio-workspace.tsx's
// saveAndClose, which does the same thing for "Save & close") instead of
// duplicating the IndexedDB + localStorage write here.
function findStudioButtonByLabel(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("#launch-studio button")).find(
    (button) => button.textContent?.toLowerCase().includes(label.toLowerCase()),
  );
}

const MOBILE_PREVIEW_QUERY = "(max-width: 767px)";

// Windowed preview scaling (issue #320 part 3): the iframe is laid out at a
// design width wider than the space actually available, then visually
// shrunk with a CSS transform, so the visitor sees more of the page
// composition (hero plus the next section or two) instead of just a nav bar
// and one tall block. Desktop uses a fixed design width; phones scale the
// device width itself so the result still fills the screen edge to edge
// once shrunk (design width = available width / MOBILE_PREVIEW_SCALE).
export const DESKTOP_PREVIEW_DESIGN_WIDTH = 1280;
export const MOBILE_PREVIEW_SCALE = 0.82;

export function computeGeneratedPreviewScale(
  availableWidth: number,
  mobile: boolean,
): { designWidth: number; scale: number } {
  const width = Math.max(1, availableWidth);
  if (mobile) {
    return { designWidth: width / MOBILE_PREVIEW_SCALE, scale: MOBILE_PREVIEW_SCALE };
  }
  return { designWidth: DESKTOP_PREVIEW_DESIGN_WIDTH, scale: Math.min(1, width / DESKTOP_PREVIEW_DESIGN_WIDTH) };
}

export function getGeneratedPreviewDesignHeight(reportedHeight: number): number {
  return Math.min(16_000, Math.max(700, Math.ceil(reportedHeight)));
}

// Issue #327 problem 1 (mobile only — desktop keeps the reportedHeight-driven
// height above unchanged): the windowed preview used to size the iframe's own
// height from the generated page's *reported* scrollHeight. That reported
// height is itself measured inside the iframe, and the free-site template
// (and plenty of bespoke hero sections) size blocks with viewport-relative
// units — a fractional small-viewport-height minimum on the centred hero, a
// full one on body — which resolve against that very same iframe height.
// Feeding scrollHeight back into the iframe's own height therefore chases itself
// upward: a taller iframe makes the svh-sized hero taller, which makes
// scrollHeight taller, which grows the iframe again. The result is a hero
// block many times taller than one screen, with its (vertically centred)
// heading and CTA scrolled far below the one-screenful slice the scaled
// preview shows before any scrolling — only the hero's background is
// visible. Full screen never hit this because its height is forced by
// `!important` CSS, bypassing frame.style.height entirely regardless of
// what JS computes.
//
// The fix: on mobile, size the iframe's own height from the space actually
// available (so svh/vh resolve against a believable device viewport, same
// as a real phone), and let the iframe's existing internal `overflow: auto`
// (see .full-generated-page-frame) reveal anything taller by scrolling —
// exactly like full screen already does. This also keeps the design
// width/height pair proportional (both scaled by the same MOBILE_PREVIEW_SCALE
// factor), so the composition shown is a faithful miniature of a real phone
// screen instead of a width-scaled-but-height-mismatched crop.
export function getMobileGeneratedPreviewDesignHeight(availableHeight: number, scale: number): number {
  return Math.max(1, Math.round(Math.max(1, availableHeight) / scale));
}

// A reported height within this many pixels of the current one is treated
// as noise, not a real layout change (issue #323 part 2.4).
export const HEIGHT_REPORT_IGNORE_THRESHOLD_PX = 24;

// Issue #327 problem 3 (mobile full screen only): controls start visible so
// the tap gesture is discoverable, then auto-hide; a subsequent tap-driven
// reveal gets the shorter "no interaction" window before hiding again.
export const FULLSCREEN_CONTROLS_ENTRY_VISIBLE_MS = 2000;
export const FULLSCREEN_CONTROLS_AUTO_HIDE_MS = 4000;

function publishableSiteFromGeneration(detail: GenerateDetail, html: string): PublishableSitePayload {
  return {
    slug: detail.slug?.trim() || "",
    name: detail.name.trim(),
    ticker: detail.ticker.trim().toUpperCase(),
    description: detail.description.trim(),
    supply: detail.supply?.trim() || "",
    decimals: Number(detail.decimals ?? 0),
    chain: detail.chain || "robinhood",
    chainId: detail.chainId || "46630",
    contractAddress: detail.contractAddress?.trim() || "",
    generatedSiteHtml: html,
    artworkReference: detail.imageDataUrl || "",
    xHandle: detail.xHandle?.trim() || "",
    telegram: detail.telegram?.trim() || "",
    status: "prepared",
  };
}

async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & Partial<T>;
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload as T;
}

async function requestPublishAuthorisation(site: PublishableSitePayload) {
  if (site.chain !== "robinhood") {
    throw new Error("Draft publishing currently requires a Robinhood Chain EVM project.");
  }
  const provider = getInjectedEvmProvider();
  if (!provider) throw new Error("Connect an EVM wallet before publishing.");

  const walletClient = createWalletClient({ transport: custom(provider) });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("The wallet returned no account.");
  const walletChainId = await walletClient.getChainId();
  if (String(walletChainId) !== site.chainId) {
    throw new Error(`Switch the wallet to chain ${site.chainId} before publishing.`);
  }

  const challengeResponse = await fetch("/api/publish/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: account, walletChainId, site }),
  });
  const challenge = await readApiResponse<PublishChallengeResponse>(
    challengeResponse,
    "The publish challenge could not be created.",
  );
  const signature = await walletClient.signMessage({ account, message: challenge.message });
  return { challengeId: challenge.challengeId, nonce: challenge.nonce, signature };
}

async function publishDraft(site: PublishableSitePayload): Promise<DraftPublishResponse> {
  const { challengeId, nonce, signature } = await requestPublishAuthorisation(site);
  const response = await fetch("/api/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId, nonce, signature, site }),
  });
  const result = await readApiResponse<DraftPublishResponse>(response, "The draft could not be published.");
  if (!result.draftPreviewUrl) throw new Error("The server did not return a draft preview URL.");
  return result;
}

async function makePublishedSiteLive(site: PublishableSitePayload): Promise<GoLiveResponse> {
  const { challengeId, nonce, signature } = await requestPublishAuthorisation(site);
  const response = await fetch("/api/publish/visibility", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId, nonce, signature, slug: site.slug }),
  });
  return readApiResponse<GoLiveResponse>(response, "The site could not be made live.");
}

export async function requestGeneratedWebsite(
  detail: GenerateDetail,
  options: RequestGeneratedWebsiteOptions = {},
): Promise<{ html: string; inspirationUsed: boolean }> {
  if (!detail.imageDataUrl?.startsWith("data:image/")) {
    throw new Error("Upload artwork before generating the website.");
  }

  const response = await fetch("/api/generate-site-page", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify(detail),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "The full website could not be generated.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: { html: string; inspirationUsed: boolean } | null = null;

  const processLine = (line: string) => {
    if (result) return;
    const event = parseGenerateSitePageStreamLine(line);
    if (!event) return;
    if (event.type === "progress") {
      options.onProgress?.(event.stage);
    } else if (event.type === "complete") {
      result = { html: event.html, inspirationUsed: event.inspirationUsed };
    } else if (event.type === "error") {
      throw new Error(event.error);
    }
  };

  try {
    while (!result) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { lines, remainder } = splitNdjsonLines(buffer);
      buffer = remainder;
      for (const line of lines) processLine(line);
    }
    buffer += decoder.decode();
    if (!result) processLine(buffer);
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The server may already have completed or the request may be aborted.
    }
    try {
      reader.releaseLock();
    } catch {
      // The reader may already have released its lock.
    }
  }

  if (!result) {
    throw new Error("The website generation stream ended before it finished.");
  }
  return result;
}

export async function requestFreeGeneratedWebsite(
  detail: GenerateDetail,
  options: { signal?: AbortSignal } = {},
): Promise<{ html: string }> {
  if (!detail.imageDataUrl?.startsWith("data:image/")) {
    throw new Error("Upload artwork before generating the website.");
  }

  const response = await fetch("/api/generate-free-site", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(detail),
    signal: options.signal,
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string; html?: string };
  if (!response.ok || typeof payload.html !== "string") {
    throw new Error(payload.error || "The free website could not be generated.");
  }
  return { html: payload.html };
}

function previewElement(): HTMLElement {
  const site = document.querySelector<HTMLElement>(".site-preview");
  if (!site) throw new Error("Website preview was not found.");
  return site;
}

const STAGE_HEADLINES: Record<GenerateSitePageProgressStage, string> = {
  "analysing-artwork": "Analysing artwork…",
  "preparing-design": "Preparing design…",
  "building-page": "Writing website…",
  "checking-safety": "Checking safety…",
};

function stageMessage(stage: GenerateSitePageProgressStage, hasInspiration: boolean): string {
  switch (stage) {
    case "analysing-artwork":
      return hasInspiration
        ? "Analysing the uploaded artwork and the inspiration website, then combining them into one original standalone page. The old Hoodlums preview is hidden because it is not the result."
        : "Analysing the uploaded artwork and building one original standalone page. The old Hoodlums preview is hidden because it is not the result.";
    case "preparing-design":
      return "Combining the verified artwork identity and inspiration brief into one design direction.";
    case "building-page":
      return "Building the finished standalone website. Large pages can take a little while to finish.";
    case "checking-safety":
      return "Checking the finished page for safety and completeness before showing it to you.";
    default:
      return "Building the finished website…";
  }
}

function setPreviewStatus(mode: PreviewStatus, message: string, headline?: string) {
  const site = previewElement();
  let status = site.querySelector<HTMLElement>(".full-generated-page-status");
  if (!status) {
    status = document.createElement("section");
    status.className = "full-generated-page-status";
    status.setAttribute("aria-live", "polite");
    status.innerHTML = "<span></span><strong></strong><p></p>";
    site.appendChild(status);
  }

  status.querySelector("span")!.textContent =
    mode === "generating" ? "STANDALONE WEBSITE GENERATOR" : "GENERATION STOPPED";
  status.querySelector("strong")!.textContent =
    mode === "generating" ? headline || "Building the finished website…" : "No finished website was produced";
  status.querySelector("p")!.textContent = message;

  site.classList.toggle("full-page-generating", mode === "generating");
  site.classList.toggle("full-page-failed", mode === "failed");
  return site;
}

function clearPreviewStatus(site: HTMLElement) {
  site.classList.remove("full-page-generating", "full-page-failed");
  site.querySelector(".full-generated-page-status")?.remove();
}

function disposeFrame(frame: HTMLIFrameElement | null) {
  if (!frame) return;
  frame.srcdoc = "";
  frame.remove();
}

function disposeRenderedPreview(preview: RenderedPreview | null) {
  if (!preview) return;
  preview.closeButton.removeEventListener("click", preview.onClose);
  preview.fullScreenButton.removeEventListener("click", preview.onToggleFullScreen);
  for (const cleanup of preview.controlCleanups) cleanup();
  preview.container.classList.remove("full-generated-page-fullscreen");
  disposeFrame(preview.frame);
  preview.container.remove();
  preview.backdrop.remove();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isMobilePreviewViewport(): boolean {
  return window.matchMedia(MOBILE_PREVIEW_QUERY).matches;
}

// The free-site template stores placeholder-bearing HTML (see
// lib/free-site-platform-facts.ts and issue #173): the raw HTML kept for
// publishing never bakes in a contract address, but this substitutes the
// same platform facts the served page would use today, so what the creator
// sees in the studio (inline, full screen, or reopened later) always
// matches what /[slug] serves. isFreeSiteTemplateHtml is a marker check, so
// bespoke (paid AI) pages — which never write that marker — pass through
// unchanged. The chart lookup itself is skipped here (kept "coming soon")
// to avoid an extra network dependency; /[slug] always does the
// authoritative live lookup.
function previewHtmlFor(rawHtml: string, contractAddress: string, chain: "robinhood" | "solana"): string {
  return isFreeSiteTemplateHtml(rawHtml)
    ? substituteFreeSitePlatformFacts(rawHtml, {
        contractAddress,
        chain,
        chart: { found: false },
        lpLockedAt: null,
      })
    : rawHtml;
}

function renderGeneratedWebsite(
  html: string,
  artworkDataUrl: string,
  publishSite: PublishableSitePayload,
  onClosePreview: () => void,
): RenderedPreview {
  const site = previewElement();
  // Issue #338 fix 4b: prepareGeneratedPageForPreview only checks structural
  // safety now (fix 4b's own change), not the strict mobile-first responsive
  // baseline (fix 4a) — so a saved draft or published site from before issue
  // #326 still renders here instead of throwing. isGeneratedPageRejectedForLayoutOnly
  // tells us that's exactly what happened, so the studio can say so instead
  // of silently leaving it to the overflow-clamp seatbelt (fix 2).
  const needsMobileRegeneration = isGeneratedPageRejectedForLayoutOnly(html);
  const prepared = prepareGeneratedPageForPreview(html, artworkDataUrl, { reportTaps: true });
  clearPreviewStatus(site);

  const container = document.createElement("section");
  container.className = "full-generated-page-container";
  container.setAttribute("aria-label", "Generated website preview");

  const controls = document.createElement("div");
  controls.className = "full-generated-page-controls";
  const controlCleanups: Array<() => void> = [];

  const mobileRegenerateWarning = needsMobileRegeneration ? document.createElement("div") : null;
  if (mobileRegenerateWarning) {
    mobileRegenerateWarning.className = "full-generated-page-mobile-warning";
    mobileRegenerateWarning.setAttribute("role", "status");
    mobileRegenerateWarning.textContent =
      "This site was generated before Hoodlums checked for genuine mobile-first layout. It still renders safely, but regenerate it for a real columned mobile design instead of a clamped desktop one.";
  }

  const publishStatus = document.createElement("span");
  publishStatus.className = "full-generated-page-publish-status";
  publishStatus.setAttribute("aria-live", "polite");

  const publishButton = document.createElement("button");
  publishButton.type = "button";
  publishButton.className = "full-generated-page-publish-button";
  publishButton.textContent = "Publish draft";

  const fullScreenButton = document.createElement("button");
  fullScreenButton.type = "button";
  fullScreenButton.className = "full-generated-page-fullscreen-button";
  fullScreenButton.textContent = "Full screen";
  fullScreenButton.setAttribute("aria-pressed", "false");

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "full-generated-page-save-button";
  saveButton.textContent = "Save preview";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "full-generated-page-close-button";
  closeButton.textContent = "Close preview";

  const backdrop = document.createElement("div");
  backdrop.className = "full-generated-page-backdrop";
  backdrop.setAttribute("aria-hidden", "true");

  const viewport = document.createElement("div");
  viewport.className = "full-generated-page-viewport";

  const scale = document.createElement("div");
  scale.className = "full-generated-page-scale";

  const frame = document.createElement("iframe");
  frame.className = "full-generated-page-frame";
  frame.title = "Generated token landing page";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("loading", "eager");
  frame.setAttribute("scrolling", "yes");
  frame.srcdoc = prepared;

  // Windowed mode lays the iframe out at a larger design width and scales
  // it down (issue #320 part 3) so more of the page composition is
  // visible; full screen is forced back to a 1:1 real render by the
  // `.full-generated-page-fullscreen` CSS (width/height/transform are all
  // `!important` there), so this always computes the windowed values and
  // lets that CSS override them when full screen is active — no branch
  // needed here, and toggling never remounts the iframe.
  let reportedHeight = 1800;
  function layout() {
    const availableWidth = viewport.clientWidth || container.clientWidth || 1;
    const mobile = isMobilePreviewViewport();
    const { designWidth, scale: factor } = computeGeneratedPreviewScale(availableWidth, mobile);
    // Mobile derives its design height from the space actually available
    // (issue #327 problem 1); desktop keeps the old reportedHeight-driven
    // value untouched.
    const designHeight = mobile
      ? getMobileGeneratedPreviewDesignHeight(viewport.clientHeight || container.clientHeight || 1, factor)
      : getGeneratedPreviewDesignHeight(reportedHeight);
    frame.style.width = `${Math.round(designWidth)}px`;
    frame.style.height = `${designHeight}px`;
    frame.style.transform = `scale(${factor})`;
    frame.style.transformOrigin = "top left";
    scale.style.width = `${Math.round(designWidth * factor)}px`;
    scale.style.height = `${Math.round(designHeight * factor)}px`;
  }

  // Issue #323 part 2.4: the bridge posts a height on close to every DOM
  // mutation inside the generated page. Ignoring sub-threshold noise and
  // refusing to shrink the frame while the visitor is mid-scroll stops those
  // reports from yanking the scaled preview (and the page's scroll position
  // with it) around under a reader who is just scrolling the page.
  let isWindowScrolling = false;
  let scrollIdleTimer: number | null = null;
  const onScrollActivity = () => {
    isWindowScrolling = true;
    if (scrollIdleTimer !== null) window.clearTimeout(scrollIdleTimer);
    scrollIdleTimer = window.setTimeout(() => {
      isWindowScrolling = false;
      scrollIdleTimer = null;
    }, 200);
  };
  window.addEventListener("scroll", onScrollActivity, { passive: true });
  controlCleanups.push(() => {
    window.removeEventListener("scroll", onScrollActivity);
    if (scrollIdleTimer !== null) window.clearTimeout(scrollIdleTimer);
  });

  function applyHeight(nextReportedHeight: number) {
    const delta = nextReportedHeight - reportedHeight;
    if (Math.abs(delta) < HEIGHT_REPORT_IGNORE_THRESHOLD_PX) return;
    if (delta < 0 && isWindowScrolling) return;
    reportedHeight = nextReportedHeight;
    layout();
  }

  const listen = (button: HTMLButtonElement, listener: () => void) => {
    button.addEventListener("click", listener);
    controlCleanups.push(() => button.removeEventListener("click", listener));
  };

  // Issue #327 problem 3: mobile full screen hides the control bar by
  // default (video-player pattern) so the site gets the whole screen, with
  // a tap toggling it back in. Desktop full screen is untouched — its
  // controls stay permanently visible via the base (non-mobile-scoped) CSS,
  // and isFullScreenMobile() below gates every part of this state machine
  // on the mobile breakpoint so nothing here fires there.
  let controlsAutoHideTimer: number | null = null;
  const clearControlsAutoHideTimer = () => {
    if (controlsAutoHideTimer === null) return;
    window.clearTimeout(controlsAutoHideTimer);
    controlsAutoHideTimer = null;
  };
  const isFullScreenMobile = () =>
    container.classList.contains("full-generated-page-fullscreen") && isMobilePreviewViewport();
  // autoHideMs of null means "stay visible until something explicitly hides
  // it" — used while keyboard/VoiceOver focus is inside the controls, so an
  // in-progress tab through the buttons never disappears mid-interaction.
  const showFullScreenControls = (autoHideMs: number | null) => {
    container.classList.add("full-generated-page-controls-visible");
    clearControlsAutoHideTimer();
    if (autoHideMs === null) return;
    controlsAutoHideTimer = window.setTimeout(() => {
      controlsAutoHideTimer = null;
      if (controls.contains(document.activeElement)) return;
      container.classList.remove("full-generated-page-controls-visible");
    }, autoHideMs);
  };
  const hideFullScreenControls = () => {
    clearControlsAutoHideTimer();
    container.classList.remove("full-generated-page-controls-visible");
  };
  const toggleFullScreenControls = () => {
    if (!isFullScreenMobile()) return;
    if (container.classList.contains("full-generated-page-controls-visible")) {
      hideFullScreenControls();
    } else {
      showFullScreenControls(FULLSCREEN_CONTROLS_AUTO_HIDE_MS);
    }
  };
  controlCleanups.push(clearControlsAutoHideTimer);

  // A tap on the shell (backdrop/viewport gutter, or forwarded from inside
  // the sandboxed iframe — see the "hoodlums-generated-page-tap" message
  // handled in FullWebsiteGenerator's onMessage) toggles the overlay, but a
  // tap on the controls themselves must only run that control's own action,
  // never also toggle — otherwise tapping "Exit full screen" would fight
  // with the overlay disappearing out from under the tap.
  const onContainerTapToggle = (event: Event) => {
    if (!isFullScreenMobile()) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".full-generated-page-controls")) return;
    toggleFullScreenControls();
  };
  container.addEventListener("click", onContainerTapToggle);
  controlCleanups.push(() => container.removeEventListener("click", onContainerTapToggle));

  const onControlsFocusIn = () => {
    if (!isFullScreenMobile()) return;
    showFullScreenControls(null);
  };
  const onControlsFocusOut = (event: FocusEvent) => {
    if (!isFullScreenMobile()) return;
    const next = event.relatedTarget;
    if (next instanceof Node && controls.contains(next)) return;
    showFullScreenControls(FULLSCREEN_CONTROLS_AUTO_HIDE_MS);
  };
  controls.addEventListener("focusin", onControlsFocusIn);
  controls.addEventListener("focusout", onControlsFocusOut);
  controlCleanups.push(() => {
    controls.removeEventListener("focusin", onControlsFocusIn);
    controls.removeEventListener("focusout", onControlsFocusOut);
  });

  const onToggleFullScreen = () => {
    const fullScreen = container.classList.toggle("full-generated-page-fullscreen");
    fullScreenButton.textContent = fullScreen ? "Exit full screen" : "Full screen";
    fullScreenButton.setAttribute("aria-pressed", String(fullScreen));
    if (fullScreen && isMobilePreviewViewport()) {
      showFullScreenControls(FULLSCREEN_CONTROLS_ENTRY_VISIBLE_MS);
    } else {
      hideFullScreenControls();
    }
    // Re-measure: windowed and full screen expose different available
    // widths (and, on desktop, different scale factors), so the layout
    // must be recomputed on every toggle even though the same iframe node
    // is reused throughout.
    layout();
  };
  const onClose = () => onClosePreview();

  // Save preview reuses the studio's own "Save project" button (found by
  // label, the same trick components/token-studio-workspace.tsx's
  // saveAndClose uses for "Save & close") so it goes through the exact same
  // durable IndexedDB + localStorage path, then reports back whatever
  // PROJECT_SAVE_RESULT_EVENT actually says instead of assuming success.
  let pendingSaveResultListener: ((event: Event) => void) | null = null;
  const clearPendingSaveResultListener = () => {
    if (!pendingSaveResultListener) return;
    window.removeEventListener(PROJECT_SAVE_RESULT_EVENT, pendingSaveResultListener);
    pendingSaveResultListener = null;
  };
  const onSavePreview = () => {
    const studioSaveButton = findStudioButtonByLabel("save project");
    if (!studioSaveButton) {
      publishStatus.textContent = "Save preview is unavailable right now.";
      return;
    }
    clearPendingSaveResultListener();
    publishStatus.textContent = "Saving preview…";
    pendingSaveResultListener = (event: Event) => {
      const detail = (event as CustomEvent<ProjectSaveResultDetail>).detail;
      clearPendingSaveResultListener();
      publishStatus.textContent = detail?.success
        ? "Preview saved."
        : "The preview could not be saved.";
    };
    window.addEventListener(PROJECT_SAVE_RESULT_EVENT, pendingSaveResultListener);
    studioSaveButton.click();
  };
  controlCleanups.push(clearPendingSaveResultListener);

  const onPublishDraft = async () => {
    publishButton.disabled = true;
    publishStatus.textContent = "Requesting wallet signature…";
    try {
      const draft = await publishDraft(publishSite);
      let destinationUrl = draft.draftPreviewUrl as string;
      publishButton.remove();

      const viewDraftButton = document.createElement("button");
      viewDraftButton.type = "button";
      viewDraftButton.className = "full-generated-page-view-button";
      viewDraftButton.textContent = "View draft";

      const goLiveButton = document.createElement("button");
      goLiveButton.type = "button";
      goLiveButton.className = "full-generated-page-live-button";
      goLiveButton.textContent = "Go live";

      const onViewDraft = () => {
        window.open(destinationUrl, "_blank", "noopener,noreferrer");
      };
      const onGoLive = async () => {
        goLiveButton.disabled = true;
        publishStatus.textContent = "Requesting owner signature…";
        try {
          const live = await makePublishedSiteLive(publishSite);
          destinationUrl = live.publicUrl;
          viewDraftButton.textContent = "View live";
          goLiveButton.textContent = "Live";
          publishStatus.textContent = "Site is live.";
        } catch (error) {
          goLiveButton.disabled = false;
          publishStatus.textContent = error instanceof Error ? error.message : "The site could not be made live.";
        }
      };

      listen(viewDraftButton, onViewDraft);
      listen(goLiveButton, () => { void onGoLive(); });
      controls.insertBefore(viewDraftButton, fullScreenButton);
      controls.insertBefore(goLiveButton, fullScreenButton);
      publishStatus.textContent = "Draft published. Review it before going live.";
    } catch (error) {
      publishButton.disabled = false;
      publishStatus.textContent = error instanceof Error ? error.message : "The draft could not be published.";
    }
  };

  listen(publishButton, () => { void onPublishDraft(); });
  listen(saveButton, onSavePreview);
  fullScreenButton.addEventListener("click", onToggleFullScreen);
  closeButton.addEventListener("click", onClose);
  if (mobileRegenerateWarning) controls.append(mobileRegenerateWarning);
  controls.append(publishStatus, publishButton, fullScreenButton, saveButton, closeButton);
  scale.appendChild(frame);
  viewport.appendChild(scale);
  container.append(controls, viewport);

  site.classList.add("full-generated-page");
  // The backdrop and container mount on document.body, not inside
  // .site-preview. .preview-panel toggles a `filter` rule while the build
  // gate is locked (see components/build-site-gate.tsx), and a filtered
  // ancestor becomes the containing block for any `position: fixed`
  // descendant — that re-anchored this overlay to .site-preview's own box
  // instead of the viewport, so the "full-bleed" phone layout rendered
  // offset by .site-preview's corner instead of sitting at (0, 0).
  // Mounting on body permanently escapes every ancestor
  // filter/transform/sticky containing-block trap.
  document.body.append(backdrop, container);
  layout();

  return {
    container,
    backdrop,
    frame,
    closeButton,
    fullScreenButton,
    onClose,
    onToggleFullScreen,
    onFrameTap: toggleFullScreenControls,
    controlCleanups,
    applyHeight,
    applyLayout: layout,
  };
}

export function FullWebsiteGenerator() {
  useEffect(() => {
    let activePreview: RenderedPreview | null = null;
    let activeController: AbortController | null = null;
    let generationNumber = 0;

    function restoreStudioControls() {
      const site = document.querySelector<HTMLElement>(".site-preview");
      disposeRenderedPreview(activePreview);
      activePreview = null;
      if (site) {
        clearPreviewStatus(site);
        site.classList.remove("full-generated-page");
      }
    }

    function applyActiveFrameHeight() {
      activePreview?.applyLayout();
    }

    function onMessage(event: MessageEvent) {
      if (!activePreview || event.source !== activePreview.frame.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown };
      if (data?.type === "hoodlums-generated-page-tap") {
        activePreview.onFrameTap();
        return;
      }
      if (data?.type !== "hoodlums-generated-page-height") return;
      const height = typeof data.height === "number" ? data.height : Number(data.height);
      if (!Number.isFinite(height)) return;
      activePreview.applyHeight(height);
    }

    function onViewportResize() {
      applyActiveFrameHeight();
    }

    async function onGenerate(event: Event) {
      const detail = (event as CustomEvent<GenerateDetail>).detail;
      const mode = detail.mode === "bespoke" ? "bespoke" : "free";
      const currentGeneration = ++generationNumber;
      activeController?.abort();
      restoreStudioControls();
      const controller = new AbortController();
      activeController = controller;
      const hasInspiration = Boolean(detail.inspirationUrl);
      if (mode === "bespoke") {
        setPreviewStatus(
          "generating",
          stageMessage("analysing-artwork", hasInspiration),
          STAGE_HEADLINES["analysing-artwork"],
        );
      } else {
        setPreviewStatus("generating", "Building your site…", "Building your site");
      }

      try {
        const page =
          mode === "bespoke"
            ? await requestGeneratedWebsite(detail, {
                signal: controller.signal,
                onProgress: (stage) => {
                  if (currentGeneration !== generationNumber) return;
                  setPreviewStatus("generating", stageMessage(stage, hasInspiration), STAGE_HEADLINES[stage]);
                },
              })
            : await requestFreeGeneratedWebsite(detail, { signal: controller.signal }).then((result) => ({
                html: result.html,
                inspirationUsed: false,
              }));
        if (currentGeneration !== generationNumber) return;
        const publishSite = publishableSiteFromGeneration(detail, page.html);
        const previewHtml = previewHtmlFor(page.html, detail.contractAddress?.trim() || "", detail.chain || "robinhood");
        activePreview = renderGeneratedWebsite(previewHtml, detail.imageDataUrl || "", publishSite, () => {
          generationNumber += 1;
          activeController?.abort();
          activeController = null;
          restoreStudioControls();
        });
        applyActiveFrameHeight();
        window.dispatchEvent(
          new CustomEvent("launchpad:site-generated", {
            detail: {
              style: { source: mode === "bespoke" ? "openai" : "free", inspirationUsed: page.inspirationUsed },
              fullPage: true,
              html: page.html,
            },
          }),
        );
      } catch (error) {
        if (currentGeneration !== generationNumber || isAbortError(error)) return;
        const message =
          error instanceof Error ? error.message : "The full website could not be generated.";
        setPreviewStatus(
          "failed",
          `${message} The terminal-style base preview has not been accepted as your generated website.`,
        );
        window.dispatchEvent(
          new CustomEvent("launchpad:site-generation-failed", {
            detail: {
              message,
              previewAvailable: false,
            },
          }),
        );
      } finally {
        if (activeController === controller) activeController = null;
      }
    }

    function onReopen(event: Event) {
      const detail = (event as CustomEvent<ReopenGeneratedSiteDetail>).detail;
      const site = detail?.site;
      if (!site || !site.generatedSiteHtml) return;
      generationNumber += 1;
      activeController?.abort();
      activeController = null;
      restoreStudioControls();
      const previewHtml = previewHtmlFor(site.generatedSiteHtml, site.contractAddress, site.chain);
      activePreview = renderGeneratedWebsite(previewHtml, detail?.imageDataUrl || "", site, () => {
        generationNumber += 1;
        activeController?.abort();
        activeController = null;
        restoreStudioControls();
      });
      applyActiveFrameHeight();
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("resize", onViewportResize);
    window.addEventListener("launchpad:generate-site", onGenerate);
    window.addEventListener(REOPEN_GENERATED_SITE_EVENT, onReopen);
    return () => {
      generationNumber += 1;
      activeController?.abort();
      activeController = null;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("resize", onViewportResize);
      window.removeEventListener("launchpad:generate-site", onGenerate);
      window.removeEventListener(REOPEN_GENERATED_SITE_EVENT, onReopen);
      restoreStudioControls();
    };
  }, []);

  return (
    <style>{`
      .site-preview.full-generated-page {
        min-height: 760px;
      }
      .site-preview.full-generated-page::after { display: none; }
      /* The backdrop and container mount on document.body (see
         renderGeneratedWebsite), not inside .site-preview, so this only
         needs to hide .site-preview's own remaining children (the empty
         state / reopen card) while the status banner stays visible. */
      .site-preview.full-generated-page > :not(.full-generated-page-status) { display: none !important; }
      .full-generated-page-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147482998;
        background: rgba(4, 8, 5, .82);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
      }
      .full-generated-page-container {
        position: fixed;
        top: 50%;
        left: 50%;
        z-index: 2147483000;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        width: min(1180px, calc(100vw - 32px));
        height: min(88vh, 900px);
        overflow: hidden;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 40px 140px rgba(0, 0, 0, .6);
        transform: translate(-50%, -50%);
      }
      .full-generated-page-controls {
        position: relative;
        z-index: 3;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        min-height: 56px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(198, 245, 62, .18);
        background: rgba(6, 10, 7, .94);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
      }
      /* Issue #338 fix 4b: sits on its own full-width row above the control
         buttons (flex: 1 0 100% inside the existing wrapping flex row, order
         -1 so it always leads regardless of DOM position) rather than
         needing a new grid row of its own. */
      .full-generated-page-mobile-warning {
        order: -1;
        flex: 1 0 100%;
        padding: 8px 10px;
        border: 1px solid rgba(245, 201, 62, .4);
        border-radius: 8px;
        background: rgba(245, 201, 62, .14);
        color: #f5c93e;
        font: 600 11px/1.4 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: .01em;
      }
      .full-generated-page-controls button {
        min-height: 40px;
        padding: 0 16px;
        border: 1px solid rgba(198, 245, 62, .32);
        border-radius: 999px;
        background: rgba(10, 14, 11, .92);
        color: #f3f6ef;
        font: 800 11px/1 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: .08em;
        text-transform: uppercase;
        cursor: pointer;
        transition: border-color .16s ease, background-color .16s ease, color .16s ease;
      }
      .full-generated-page-controls button:hover { border-color: rgba(198, 245, 62, .62); }
      .full-generated-page-controls button:focus-visible {
        outline: 2px solid #c6f53e;
        outline-offset: 2px;
      }
      .full-generated-page-controls button:disabled { opacity: .55; cursor: wait; }
      .full-generated-page-publish-status {
        min-width: 0;
        margin-right: auto;
        color: #a9b3ab;
        font: 700 11px/1.35 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .full-generated-page-publish-status:empty { display: none; }
      .full-generated-page-publish-button,
      .full-generated-page-live-button {
        border-color: rgba(198, 245, 62, .6) !important;
        background: #c6f53e !important;
        color: #0b100c !important;
      }
      .full-generated-page-fullscreen-button[aria-pressed="true"] {
        border-color: #c6f53e !important;
        color: #c6f53e !important;
        box-shadow: inset 0 -2px 0 #c6f53e;
      }
      .full-generated-page-viewport {
        width: 100%;
        overflow: auto;
        overflow-x: hidden;
        touch-action: pan-y;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        background: #fff;
      }
      /* Windowed mode: sized by layout()/applyHeight() in JS to the scaled
         iframe box (design width/height * the scale factor) so the visible
         footprint never exceeds what's actually available — nothing to
         scroll sideways into. Full screen clears this back to 100% below. */
      .full-generated-page-scale {
        overflow: hidden;
      }
      .full-generated-page-frame {
        display: block;
        width: 100%;
        min-height: 760px;
        border: 0;
        background: #fff;
        overflow: auto;
        overflow-x: hidden;
        touch-action: pan-y;
      }
      .full-generated-page-container.full-generated-page-fullscreen {
        inset: 0;
        width: 100vw;
        height: 100svh;
        max-width: none;
        border-radius: 0;
        transform: none;
        background: #fff;
      }
      .full-generated-page-fullscreen .full-generated-page-viewport {
        min-height: 0;
        height: 100%;
      }
      .full-generated-page-fullscreen .full-generated-page-scale {
        width: 100% !important;
        height: 100% !important;
      }
      .full-generated-page-fullscreen .full-generated-page-frame {
        width: 100% !important;
        height: 100% !important;
        min-height: 0;
        max-height: none;
        transform: none !important;
      }
      .site-preview.full-page-generating,
      .site-preview.full-page-failed {
        position: relative;
        min-height: 700px;
        overflow: hidden;
        background: #f4f6f8;
      }
      .site-preview.full-page-generating > :not(.full-generated-page-status),
      .site-preview.full-page-failed > :not(.full-generated-page-status) {
        display: none !important;
      }
      .full-generated-page-status {
        min-height: 700px;
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 14px;
        padding: 48px 24px;
        text-align: center;
        color: #132536;
        background:
          radial-gradient(circle at 20% 15%, rgba(91, 177, 214, .22), transparent 34%),
          linear-gradient(155deg, #f8fbfd, #edf3f6);
      }
      .full-generated-page-status span {
        color: #315f7b;
        font: 800 11px/1.2 system-ui, sans-serif;
        letter-spacing: .14em;
      }
      .full-generated-page-status strong {
        max-width: 680px;
        font: 800 clamp(28px, 6vw, 52px)/1.02 system-ui, sans-serif;
      }
      .full-generated-page-status p {
        max-width: 680px;
        margin: 0;
        color: #526878;
        font: 500 16px/1.65 system-ui, sans-serif;
      }
      .site-preview.full-page-generating .full-generated-page-status::after {
        width: 42px;
        height: 42px;
        content: "";
        border: 4px solid rgba(49, 95, 123, .18);
        border-top-color: #315f7b;
        border-radius: 50%;
        animation: hoodlums-page-spin .8s linear infinite;
      }
      .site-preview.full-page-failed .full-generated-page-status {
        background: linear-gradient(155deg, #fff8f6, #f7ece8);
      }
      .site-preview.full-page-failed .full-generated-page-status span { color: #a13b29; }
      @keyframes hoodlums-page-spin { to { transform: rotate(360deg); } }
      @media (max-width: 767px) {
        .site-preview.full-generated-page {
          min-height: 0;
          overflow: visible;
        }
        /* Issue #320 part 1: the overlay used to float mid-screen on
           phones, leaving dead space above the tab bar. Windowed mode now
           pins the tab bar to the very top and lets the site fill the
           entire remaining screen, edge to edge — the same full-bleed
           footprint full screen already used, so the only difference
           between the two states on a phone is the part-3 content scale,
           never the container's own size or position. Issue #338 fix 3: this
           rule kept a bare height: 100svh, never the dvh-preferred
           fallback chain #327 problem 2 added to the sibling full screen
           rule below — so windowed mode (the default view, before anyone
           taps "Full screen") kept the exact dead band at the bottom that
           #327/#329 already fixed for full screen, which read as the bug
           "returning". Same chain, same reasoning, applied here too. */
        .full-generated-page-container:not(.full-generated-page-fullscreen) {
          inset: 0;
          width: 100vw;
          height: 100vh;
          height: -webkit-fill-available;
          height: 100svh;
          height: 100dvh;
          max-width: none;
          max-height: none;
          border-radius: 0;
          transform: none;
        }
        .full-generated-page-controls {
          flex-wrap: wrap;
          justify-content: stretch;
          padding: calc(8px + env(safe-area-inset-top)) 8px 8px;
        }
        .full-generated-page-publish-status { flex: 1 0 100%; }
        .full-generated-page-controls button { flex: 1 1 120px; min-height: 40px; }
        .site-preview.full-page-generating,
        .site-preview.full-page-failed,
        .full-generated-page-status { min-height: 700px; }
        /* Issue #327 problem 2: full screen must reach every edge of the
           phone screen, including under a dynamic toolbar and the home
           indicator. 100svh still left a dead band at the bottom; 100dvh
           tracks the toolbar precisely, with svh/-webkit-fill-available as
           fallbacks for engines that predate it. Declared oldest-to-newest
           so an unsupported value is simply ignored, leaving the most
           modern supported one in effect. Desktop full screen is untouched
           — this whole block only applies at this breakpoint. */
        .full-generated-page-container.full-generated-page-fullscreen {
          height: 100vh;
          height: -webkit-fill-available;
          height: 100svh;
          height: 100dvh;
          /* Controls become an absolutely-positioned overlay (below), so
             the single remaining in-flow grid item (the viewport) should
             claim the whole container instead of sharing it with a
             reserved "auto" control-bar row. */
          grid-template-rows: minmax(0, 1fr);
        }
        /* Issue #327 problem 3: controls default to hidden in full screen
           so the site gets the entire screen, and slide in as an overlay —
           not a layout row — on tap/focus. This only adds a new stacking
           layer via position: absolute + z-index inside the existing
           .full-generated-page-container (already position: fixed), so it
           composes with the #316 body:has(.full-generated-page-container)
           chrome-hiding rule (app/globals.css) without creating any new
           conflict with the iframe's own stacking context. */
        .full-generated-page-fullscreen .full-generated-page-controls {
          position: absolute;
          inset: 0 0 auto 0;
          transform: translateY(-100%);
          opacity: 0;
          pointer-events: none;
          transition: transform .22s ease, opacity .22s ease;
        }
        .full-generated-page-fullscreen.full-generated-page-controls-visible .full-generated-page-controls {
          transform: translateY(0);
          opacity: 1;
          pointer-events: auto;
        }
      }
    `}</style>
  );
}
