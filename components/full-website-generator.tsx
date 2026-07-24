"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GeneratedSiteVariantSelector } from "@/components/generated-site-variant-selector";
import { prepareGeneratedPageForPreview } from "@/lib/generated-site-page";
import {
  getDefaultGeneratedSiteVariant,
  parseGeneratedSiteVariants,
  selectGeneratedSiteVariant,
  type GeneratedSiteVariant,
} from "@/lib/generated-site-variants";

export type GenerateDetail = {
  name: string;
  ticker: string;
  description: string;
  imageDataUrl?: string;
  inspirationUrl?: string;
};

type GeneratedPageResponse = {
  variants?: unknown;
  error?: string;
  source?: string;
  inspirationUsed?: boolean;
};

type PreviewStatus = "generating" | "failed";

export type SelectedSiteGeneratedEventDetail = {
  style: {
    source: "openai";
    inspirationUsed: boolean;
  };
  fullPage: true;
  html: string;
  variantId: string;
  variantLabel: string;
  variantDescription: string;
};

export function buildSelectedSiteGeneratedEventDetail(
  variant: GeneratedSiteVariant,
  inspirationUsed: boolean,
): SelectedSiteGeneratedEventDetail {
  return {
    style: { source: "openai", inspirationUsed },
    fullPage: true,
    html: variant.html,
    variantId: variant.id,
    variantLabel: variant.label,
    variantDescription: variant.description,
  };
}

export function shouldAcceptActiveFrameMessage(
  eventSource: unknown,
  activeFrameWindow: unknown,
): boolean {
  return Boolean(activeFrameWindow && eventSource === activeFrameWindow);
}

export async function requestGeneratedWebsite(detail: GenerateDetail): Promise<{
  variants: GeneratedSiteVariant[];
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
    throw new Error(payload.error || "The five website designs could not be generated.");
  }

  const variants = parseGeneratedSiteVariants(payload.variants);
  if (!variants) {
    throw new Error("The generator did not return five complete, distinct website designs.");
  }

  return {
    variants,
    inspirationUsed: payload.inspirationUsed === true,
  };
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
    mode === "generating" ? "5-DIRECTION WEBSITE GENERATOR" : "GENERATION STOPPED";
  status.querySelector("strong")!.textContent =
    mode === "generating" ? "Building five distinct site designs…" : "No new designs were produced";
  status.querySelector("p")!.textContent = message;

  site.classList.toggle("full-page-generating", mode === "generating");
  site.classList.toggle("full-page-failed", mode === "failed");
  return site;
}

function clearPreviewStatus(site: HTMLElement) {
  site.classList.remove("full-page-generating", "full-page-failed");
  site.querySelector(".full-generated-page-status")?.remove();
}

export function FullWebsiteGenerator() {
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  const [variants, setVariants] = useState<GeneratedSiteVariant[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [artworkDataUrl, setArtworkDataUrl] = useState("");
  const [inspirationUsed, setInspirationUsed] = useState(false);
  const [activeHeight, setActiveHeight] = useState(1800);
  const activeFrameRef = useRef<HTMLIFrameElement>(null);
  const generationNumber = useRef(0);

  const selectedVariant = useMemo(
    () => selectGeneratedSiteVariant(variants, selectedId),
    [variants, selectedId],
  );

  const selectedHtml = useMemo(() => {
    if (!selectedVariant || !artworkDataUrl) return "";
    return prepareGeneratedPageForPreview(selectedVariant.html, artworkDataUrl);
  }, [selectedVariant, artworkDataUrl]);

  const clearGeneratedView = useCallback(() => {
    setVariants([]);
    setSelectedId("");
    setArtworkDataUrl("");
    setInspirationUsed(false);
    setActiveHeight(1800);
    activeFrameRef.current = null;
    const site = document.querySelector<HTMLElement>(".site-preview");
    site?.classList.remove("full-generated-page");
  }, []);

  const selectVariant = useCallback(
    (variant: GeneratedSiteVariant, nextInspirationUsed = inspirationUsed) => {
      if (!variants.some((item) => item.id === variant.id)) return;
      setSelectedId(variant.id);
      setActiveHeight(1800);
      window.dispatchEvent(
        new CustomEvent(
          "launchpad:site-generated",
          { detail: buildSelectedSiteGeneratedEventDetail(variant, nextInspirationUsed) },
        ),
      );
    },
    [variants, inspirationUsed],
  );

  useEffect(() => {
    const site = previewElement();
    const container = document.createElement("div");
    container.className = "generated-site-variant-mount";
    site.appendChild(container);
    setMount(container);
    return () => {
      container.remove();
      setMount(null);
    };
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const activeWindow = activeFrameRef.current?.contentWindow;
      if (!shouldAcceptActiveFrameMessage(event.source, activeWindow)) return;
      const data = event.data as { type?: unknown; height?: unknown };
      if (data?.type !== "hoodlums-generated-page-height") return;
      const height = typeof data.height === "number" ? data.height : Number(data.height);
      if (!Number.isFinite(height)) return;
      setActiveHeight(Math.min(16_000, Math.max(700, Math.ceil(height))));
    }

    async function onGenerate(event: Event) {
      const detail = (event as CustomEvent<GenerateDetail>).detail;
      const currentGeneration = ++generationNumber.current;
      clearGeneratedView();

      const sourceMessage = detail.inspirationUrl
        ? "Analysing the artwork and inspiration once, then building five different composition systems in parallel."
        : "Analysing the artwork once, then building five different composition systems in parallel.";
      setPreviewStatus("generating", sourceMessage);

      try {
        const page = await requestGeneratedWebsite(detail);
        if (currentGeneration !== generationNumber.current) return;
        const first = getDefaultGeneratedSiteVariant(page.variants);
        if (!first) throw new Error("No default design was available.");

        const site = previewElement();
        clearPreviewStatus(site);
        site.classList.add("full-generated-page");
        setVariants(page.variants);
        setArtworkDataUrl(detail.imageDataUrl || "");
        setInspirationUsed(page.inspirationUsed);
        setSelectedId(first.id);
        setActiveHeight(1800);
        window.dispatchEvent(
          new CustomEvent("launchpad:site-generated", {
            detail: buildSelectedSiteGeneratedEventDetail(first, page.inspirationUsed),
          }),
        );
      } catch (error) {
        if (currentGeneration !== generationNumber.current) return;
        clearGeneratedView();
        const message =
          error instanceof Error ? error.message : "The five website designs could not be generated.";
        setPreviewStatus(
          "failed",
          `${message} No stale design has been accepted as the new result.`,
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

    function onGenerationInvalidated(event: Event) {
      const detail = (event as CustomEvent<{ previewAvailable?: boolean }>).detail;
      if (detail?.previewAvailable === true) return;
      generationNumber.current += 1;
      clearGeneratedView();
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("launchpad:generate-site", onGenerate);
    window.addEventListener("launchpad:site-generation-failed", onGenerationInvalidated);
    return () => {
      generationNumber.current += 1;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("launchpad:generate-site", onGenerate);
      window.removeEventListener("launchpad:site-generation-failed", onGenerationInvalidated);
      const site = document.querySelector<HTMLElement>(".site-preview");
      if (site) clearPreviewStatus(site);
    };
  }, [clearGeneratedView]);

  const portal =
    mount && variants.length === 5 && selectedVariant && selectedHtml
      ? createPortal(
          <div className="full-generated-page-shell">
            <GeneratedSiteVariantSelector
              variants={variants}
              selectedId={selectedId}
              artworkDataUrl={artworkDataUrl}
              onSelect={(variant) => selectVariant(variant)}
            />
            <div className="full-generated-page-active-heading">
              <span>ACTIVE DESIGN</span>
              <strong>{selectedVariant.label}</strong>
              <p>{selectedVariant.description}</p>
            </div>
            <iframe
              key={selectedVariant.id}
              ref={activeFrameRef}
              className="full-generated-page-frame"
              title={`${selectedVariant.label} generated token landing page`}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              loading="eager"
              srcDoc={selectedHtml}
              style={{ height: activeHeight }}
            />
          </div>,
          mount,
        )
      : null;

  return (
    <>
      {portal}
      <style>{`
        .site-preview.full-generated-page {
          min-height: 760px;
          overflow: hidden;
          border-radius: 12px;
          background: #fff;
        }
        .site-preview.full-generated-page::after { display: none; }
        .site-preview.full-generated-page > :not(.generated-site-variant-mount):not(.full-generated-page-status) { display: none !important; }
        .generated-site-variant-mount,
        .full-generated-page-shell { display: block; width: 100%; }
        .full-generated-page-active-heading {
          display: grid;
          grid-template-columns: auto auto minmax(0,1fr);
          align-items: center;
          gap: 12px;
          padding: 13px 20px;
          color: #f4f7ef;
          background: #081009;
          border-bottom: 1px solid rgba(131,183,139,.2);
          font-family: system-ui, sans-serif;
        }
        .full-generated-page-active-heading span {
          color: #b9ef4d;
          font: 800 8px "IBM Plex Mono", monospace;
          letter-spacing: .12em;
        }
        .full-generated-page-active-heading strong { font-size: 13px; }
        .full-generated-page-active-heading p { margin: 0; color: #7f8b81; font-size: 11px; }
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
          .full-generated-page-active-heading { grid-template-columns: auto 1fr; }
          .full-generated-page-active-heading p { grid-column: 1 / -1; }
        }
      `}</style>
    </>
  );
}
