"use client";

import { useEffect } from "react";
import { prepareGeneratedPageForPreview } from "@/lib/generated-site-page";

type GenerateDetail = {
  name: string;
  ticker: string;
  description: string;
  imageDataUrl?: string;
  inspirationUrl?: string;
};

type ProgressEvent = {
  type: "progress";
  stage?: unknown;
  message?: unknown;
  receivedCharacters?: unknown;
};
type CompleteEvent = {
  type: "complete";
  html?: unknown;
  source?: unknown;
  inspirationUsed?: unknown;
};
type ErrorEvent = { type: "error"; error?: unknown; providerError?: unknown };
type NdjsonEvent = ProgressEvent | CompleteEvent | ErrorEvent | { type?: unknown };

export type GenerationProgress = {
  stage: string;
  message: string;
  receivedCharacters?: number;
};

type PreviewStatus = "generating" | "failed";

const STAGE_HEADLINES: Record<string, string> = {
  "analysing-artwork": "Analysing artwork…",
  "preparing-design": "Preparing design…",
  "building-page": "Writing website…",
  "checking-safety": "Checking safety…",
};

function isAbortError(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && (error as { name?: unknown }).name === "AbortError";
}

async function consumeNdjsonBody(
  response: Response,
  onEvent: (event: NdjsonEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("The website generation stream was empty.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function drain(finalChunk: string) {
    buffer += finalChunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as NdjsonEvent);
        } catch {
          // Ignore a malformed NDJSON line rather than aborting the whole stream.
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    drain(decoder.decode(value, { stream: true }));
  }

  drain(decoder.decode());
  const finalLine = buffer.trim();
  if (finalLine) {
    try {
      onEvent(JSON.parse(finalLine) as NdjsonEvent);
    } catch {
      // Ignore a malformed trailing line.
    }
  }
}

export async function requestGeneratedWebsite(
  detail: GenerateDetail,
  onProgress: (progress: GenerationProgress) => void,
  signal: AbortSignal,
): Promise<{ html: string; inspirationUsed: boolean }> {
  if (!detail.imageDataUrl?.startsWith("data:image/")) {
    throw new Error("Upload artwork before generating the website.");
  }

  const response = await fetch("/api/generate-site-page", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(detail),
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "The full website could not be generated.");
  }

  let completeResult: { html: string; inspirationUsed: boolean } | null = null;
  let failureMessage: string | null = null;

  await consumeNdjsonBody(response, (event) => {
    if (!event || typeof event !== "object") return;
    if (event.type === "progress") {
      const progress = event as ProgressEvent;
      if (typeof progress.stage === "string" && typeof progress.message === "string") {
        onProgress({
          stage: progress.stage,
          message: progress.message,
          receivedCharacters:
            typeof progress.receivedCharacters === "number" ? progress.receivedCharacters : undefined,
        });
      }
      return;
    }
    if (event.type === "complete") {
      const complete = event as CompleteEvent;
      if (typeof complete.html === "string") {
        completeResult = { html: complete.html, inspirationUsed: complete.inspirationUsed === true };
      }
      return;
    }
    if (event.type === "error") {
      const failure = event as ErrorEvent;
      failureMessage = typeof failure.error === "string" ? failure.error : "The full website could not be generated.";
    }
  });

  if (completeResult) return completeResult;
  throw new Error(failureMessage || "The website generation stream ended before completing.");
}

function previewElement(): HTMLElement {
  const site = document.querySelector<HTMLElement>(".site-preview");
  if (!site) throw new Error("Website preview was not found.");
  return site;
}

function setPreviewStatus(mode: PreviewStatus, message: string, progress?: GenerationProgress) {
  const site = previewElement();
  let status = site.querySelector<HTMLElement>(".full-generated-page-status");
  if (!status) {
    status = document.createElement("section");
    status.className = "full-generated-page-status";
    status.setAttribute("aria-live", "polite");
    status.innerHTML = "<span></span><strong></strong><p></p><em></em>";
    site.appendChild(status);
  }

  const headline = progress ? STAGE_HEADLINES[progress.stage] : undefined;

  status.querySelector("span")!.textContent =
    mode === "generating" ? "STANDALONE WEBSITE GENERATOR" : "GENERATION STOPPED";
  status.querySelector("strong")!.textContent =
    mode === "generating" ? headline || "Building the finished website…" : "No finished website was produced";
  status.querySelector("p")!.textContent = message;
  status.querySelector("em")!.textContent =
    progress?.receivedCharacters ? `${progress.receivedCharacters.toLocaleString()} characters written so far` : "";

  site.classList.toggle("full-page-generating", mode === "generating");
  site.classList.toggle("full-page-failed", mode === "failed");
  return site;
}

function clearPreviewStatus(site: HTMLElement) {
  site.classList.remove("full-page-generating", "full-page-failed");
  site.querySelector(".full-generated-page-status")?.remove();
}

function renderGeneratedWebsite(html: string, artworkDataUrl: string) {
  const site = previewElement();
  const prepared = prepareGeneratedPageForPreview(html, artworkDataUrl);
  const previous = site.querySelector<HTMLIFrameElement>(".full-generated-page-frame");
  if (previous) {
    previous.srcdoc = "";
    previous.remove();
  }
  clearPreviewStatus(site);

  const frame = document.createElement("iframe");
  frame.className = "full-generated-page-frame";
  frame.title = "Generated token landing page";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("loading", "eager");
  frame.style.height = "1800px";
  frame.srcdoc = prepared;

  site.classList.add("full-generated-page");
  site.appendChild(frame);
  return frame;
}

export function FullWebsiteGenerator() {
  useEffect(() => {
    let activeFrame: HTMLIFrameElement | null = null;
    let activeController: AbortController | null = null;
    let generationNumber = 0;

    function onMessage(event: MessageEvent) {
      if (!activeFrame || event.source !== activeFrame.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown };
      if (data?.type !== "hoodlums-generated-page-height") return;
      const height = typeof data.height === "number" ? data.height : Number(data.height);
      if (!Number.isFinite(height)) return;
      activeFrame.style.height = `${Math.min(16_000, Math.max(700, Math.ceil(height)))}px`;
    }

    async function onGenerate(event: Event) {
      const detail = (event as CustomEvent<GenerateDetail>).detail;
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const currentGeneration = ++generationNumber;
      const sourceMessage = detail.inspirationUrl
        ? "Analysing the uploaded artwork and the inspiration website, then combining them into one original standalone page. The old Hoodlums preview is hidden because it is not the result."
        : "Analysing the uploaded artwork and building one original standalone page. The old Hoodlums preview is hidden because it is not the result.";
      setPreviewStatus("generating", sourceMessage);

      try {
        const page = await requestGeneratedWebsite(
          detail,
          (progress) => {
            if (currentGeneration !== generationNumber) return;
            setPreviewStatus("generating", sourceMessage, progress);
          },
          controller.signal,
        );
        if (currentGeneration !== generationNumber) return;
        activeFrame = renderGeneratedWebsite(page.html, detail.imageDataUrl || "");
        window.dispatchEvent(
          new CustomEvent("launchpad:site-generated", {
            detail: {
              style: { source: "openai", inspirationUsed: page.inspirationUsed },
              fullPage: true,
              html: page.html,
            },
          }),
        );
      } catch (error) {
        if (currentGeneration !== generationNumber) return;
        if (isAbortError(error)) return;
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
      }
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("launchpad:generate-site", onGenerate);
    return () => {
      generationNumber += 1;
      activeController?.abort();
      window.removeEventListener("message", onMessage);
      window.removeEventListener("launchpad:generate-site", onGenerate);
      if (activeFrame) {
        activeFrame.srcdoc = "";
        activeFrame.remove();
        activeFrame = null;
      }
      const site = document.querySelector<HTMLElement>(".site-preview");
      if (site) {
        site.classList.remove("full-generated-page");
        clearPreviewStatus(site);
      }
    };
  }, []);

  return (
    <style>{`
      .site-preview.full-generated-page {
        min-height: 760px;
        overflow: hidden;
        border-radius: 12px;
        background: #fff;
      }
      .site-preview.full-generated-page::after { display: none; }
      .site-preview.full-generated-page > :not(.full-generated-page-frame):not(.full-generated-page-status) { display: none !important; }
      .full-generated-page-frame {
        display: block;
        width: 100%;
        min-height: 760px;
        border: 0;
        background: #fff;
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
      .full-generated-page-status em {
        max-width: 680px;
        margin: 0;
        font: 600 13px/1.5 system-ui, sans-serif;
        font-style: normal;
        color: #6d8494;
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
      @media (max-width: 780px) {
        .site-preview.full-generated-page,
        .full-generated-page-frame,
        .site-preview.full-page-generating,
        .site-preview.full-page-failed,
        .full-generated-page-status { min-height: 700px; }
      }
    `}</style>
  );
}
