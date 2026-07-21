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

type GeneratedPageResponse = {
  html?: unknown;
  error?: string;
  source?: string;
  inspirationUsed?: boolean;
};

export async function requestGeneratedWebsite(detail: GenerateDetail): Promise<{
  html: string;
  inspirationUsed: boolean;
}> {
  if (!detail.imageDataUrl?.startsWith("data:image/")) {
    throw new Error("Upload artwork before generating the website.");
  }

  const response = await fetch("/api/generate-site-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(detail),
  });
  const payload = (await response.json().catch(() => ({}))) as GeneratedPageResponse;
  if (!response.ok) {
    throw new Error(payload.error || "The full website could not be generated.");
  }
  if (typeof payload.html !== "string") {
    throw new Error("The generated website document was missing.");
  }

  return {
    html: payload.html,
    inspirationUsed: payload.inspirationUsed === true,
  };
}

function renderGeneratedWebsite(html: string, artworkDataUrl: string) {
  const site = document.querySelector<HTMLElement>(".site-preview");
  if (!site) throw new Error("Website preview was not found.");

  const prepared = prepareGeneratedPageForPreview(html, artworkDataUrl);
  const previous = site.querySelector<HTMLIFrameElement>(".full-generated-page-frame");
  previous?.remove();

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
      const currentGeneration = ++generationNumber;
      try {
        const page = await requestGeneratedWebsite(detail);
        if (currentGeneration !== generationNumber) return;
        activeFrame = renderGeneratedWebsite(page.html, detail.imageDataUrl || "");
        window.dispatchEvent(
          new CustomEvent("launchpad:site-generated", {
            detail: {
              style: { source: "openai", inspirationUsed: page.inspirationUsed },
              fullPage: true,
            },
          }),
        );
      } catch (error) {
        if (currentGeneration !== generationNumber) return;
        window.dispatchEvent(
          new CustomEvent("launchpad:site-generation-failed", {
            detail: {
              message: error instanceof Error ? error.message : "The full website could not be generated.",
              previewAvailable: true,
            },
          }),
        );
      }
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("launchpad:generate-site", onGenerate);
    return () => {
      generationNumber += 1;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("launchpad:generate-site", onGenerate);
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
      .site-preview.full-generated-page > :not(.full-generated-page-frame) { display: none !important; }
      .full-generated-page-frame {
        display: block;
        width: 100%;
        min-height: 760px;
        border: 0;
        background: #fff;
      }
      @media (max-width: 780px) {
        .site-preview.full-generated-page,
        .full-generated-page-frame { min-height: 700px; }
      }
    `}</style>
  );
}
