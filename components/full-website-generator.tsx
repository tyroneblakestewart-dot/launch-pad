"use client";

import { useEffect } from "react";
import { prepareGeneratedPageForPreview } from "@/lib/generated-site-page";
import {
  GENERATE_SITE_PAGE_NDJSON_CONTENT_TYPE,
  parseGenerateSitePageStreamLine,
  splitNdjsonLines,
  type GenerateSitePageStreamStage,
} from "@/lib/generate-site-page-stream-protocol";

type GenerateDetail = {
  name: string;
  ticker: string;
  description: string;
  imageDataUrl?: string;
  inspirationUrl?: string;
};

type PreviewStatus = "generating" | "failed";

type StreamOutcome =
  | { kind: "complete"; html: string; source: string; inspirationUsed: boolean }
  | { kind: "error"; message: string };

export async function requestGeneratedWebsiteStream(
  detail: GenerateDetail,
  onProgress: (stage: GenerateSitePageStreamStage) => void,
  signal: AbortSignal,
): Promise<{ html: string; source: string; inspirationUsed: boolean }> {
  if (!detail.imageDataUrl?.startsWith("data:image/")) {
    throw new Error("Upload artwork before generating the website.");
  }

  const response = await fetch("/api/generate-site-page", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: GENERATE_SITE_PAGE_NDJSON_CONTENT_TYPE,
    },
    body: JSON.stringify(detail),
    signal,
  });

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "The full website could not be generated.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: StreamOutcome | null = null;

  try {
    while (!outcome) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const { lines, remainder } = splitNdjsonLines(buffer);
        buffer = remainder;
        for (const line of lines) {
          const event = parseGenerateSitePageStreamLine(line);
          if (!event) continue;
          if (event.type === "progress") {
            onProgress(event.stage);
          } else if (event.type === "complete") {
            outcome = {
              kind: "complete",
              html: event.html,
              source: event.source,
              inspirationUsed: event.inspirationUsed,
            };
            break;
          } else if (event.type === "error") {
            outcome = { kind: "error", message: event.error };
            break;
          }
        }
      }
      if (outcome) break;

      if (done) {
        // A proxy may drop the trailing newline on the final NDJSON line;
        // parse whatever is left in the buffer defensively.
        const event = parseGenerateSitePageStreamLine(buffer);
        if (event?.type === "complete") {
          outcome = {
            kind: "complete",
            html: event.html,
            source: event.source,
            inspirationUsed: event.inspirationUsed,
          };
        } else if (event?.type === "error") {
          outcome = { kind: "error", message: event.error };
        }
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  if (!outcome) throw new Error("The full website could not be generated.");
  if (outcome.kind === "error") throw new Error(outcome.message);
  return { html: outcome.html, source: outcome.source, inspirationUsed: outcome.inspirationUsed };
}

function previewElement(): HTMLElement {
  const site = document.querySelector<HTMLElement>(".site-preview");
  if (!site) throw new Error("Website preview was not found.");
  return site;
}

function setPreviewStatus(mode: PreviewStatus, message: string) {
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
    mode === "generating" ? "Building the finished website…" : "No finished website was produced";
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

function stageMessage(stage: GenerateSitePageStreamStage, hasInspiration: boolean): string {
  switch (stage) {
    case "analysing-artwork":
      return hasInspiration
        ? "Analysing the uploaded artwork and the inspiration website, then combining them into one original standalone page. The old Hoodlums preview is hidden because it is not the result."
        : "Analysing the uploaded artwork and building one original standalone page. The old Hoodlums preview is hidden because it is not the result.";
    case "preparing-design":
      return "Fusing the verified artwork identity and inspiration presentation into one design brief.";
    case "building-page":
      return "Generating the finished single-file website from the fused brief.";
    case "checking-safety":
      return "Running final completeness and safety checks before showing the result.";
    default:
      return "Working on your standalone website.";
  }
}

function renderGeneratedWebsite(
  html: string,
  artworkDataUrl: string,
  previousFrame: HTMLIFrameElement | null,
) {
  const site = previewElement();
  const prepared = prepareGeneratedPageForPreview(html, artworkDataUrl);
  disposeFrame(previousFrame);
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
      const hasInspiration = Boolean(detail.inspirationUrl);
      setPreviewStatus("generating", stageMessage("analysing-artwork", hasInspiration));

      try {
        const page = await requestGeneratedWebsiteStream(
          detail,
          (stage) => {
            if (currentGeneration !== generationNumber) return;
            setPreviewStatus("generating", stageMessage(stage, hasInspiration));
          },
          controller.signal,
        );
        if (currentGeneration !== generationNumber) return;
        activeFrame = renderGeneratedWebsite(page.html, detail.imageDataUrl || "", activeFrame);
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
      disposeFrame(activeFrame);
      activeFrame = null;
      const site = document.querySelector<HTMLElement>(".site-preview");
      if (site) {
        clearPreviewStatus(site);
        site.classList.remove("full-generated-page");
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
