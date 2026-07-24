"use client";

import { useMemo } from "react";
import { prepareGeneratedPageForPreview } from "@/lib/generated-site-page";
import type { GeneratedSiteVariant } from "@/lib/generated-site-variants";

export function GeneratedSiteVariantSelector({
  variants,
  selectedId,
  artworkDataUrl,
  onSelect,
}: {
  variants: readonly GeneratedSiteVariant[];
  selectedId: string;
  artworkDataUrl: string;
  onSelect: (variant: GeneratedSiteVariant) => void;
}) {
  const prepared = useMemo(
    () =>
      variants.map((variant) => ({
        ...variant,
        preparedHtml: prepareGeneratedPageForPreview(variant.html, artworkDataUrl),
      })),
    [variants, artworkDataUrl],
  );

  return (
    <section className="generated-site-variant-selector" aria-labelledby="design-variant-title">
      <header>
        <div>
          <span>5 ARTWORK-DRIVEN DIRECTIONS</span>
          <h3 id="design-variant-title">Choose the site design</h3>
          <p>Select any preview to switch the large site below. No extra generation call is made.</p>
        </div>
        <strong>{prepared.findIndex((variant) => variant.id === selectedId) + 1} / 5 selected</strong>
      </header>

      <div className="generated-site-variant-strip">
        {prepared.map((variant, index) => {
          const selected = variant.id === selectedId;
          return (
            <article
              className={selected ? "generated-site-variant-card selected" : "generated-site-variant-card"}
              key={variant.id}
            >
              <div className="generated-site-variant-thumbnail" aria-hidden="true">
                <iframe
                  title={`${variant.label} design preview`}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  loading="eager"
                  srcDoc={variant.preparedHtml}
                  tabIndex={-1}
                />
              </div>
              <div className="generated-site-variant-copy">
                <span>DESIGN {index + 1}</span>
                <h4>{variant.label}</h4>
                <p>{variant.description}</p>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(variant)}
                >
                  {selected ? "SELECTED ✓" : "USE THIS DESIGN"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <style>{`
        .generated-site-variant-selector {
          display: grid;
          gap: 18px;
          padding: 24px;
          color: #f4f7ef;
          background: #060a07;
          border-bottom: 1px solid rgba(131,183,139,.2);
          font-family: system-ui, sans-serif;
        }
        .generated-site-variant-selector > header {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 18px;
        }
        .generated-site-variant-selector header span {
          color: #b9ef4d;
          font: 800 9px "IBM Plex Mono", monospace;
          letter-spacing: .14em;
        }
        .generated-site-variant-selector h3 { margin: 5px 0 4px; font-size: clamp(22px, 4vw, 34px); }
        .generated-site-variant-selector header p { max-width: 680px; margin: 0; color: #8e9a90; font-size: 13px; }
        .generated-site-variant-selector header strong {
          flex: none;
          color: #b9ef4d;
          font: 800 10px "IBM Plex Mono", monospace;
        }
        .generated-site-variant-strip {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: minmax(235px, 1fr);
          gap: 14px;
          overflow-x: auto;
          padding: 2px 2px 10px;
          scroll-snap-type: x proximity;
          scrollbar-color: rgba(185,239,77,.45) transparent;
        }
        .generated-site-variant-card {
          min-width: 0;
          overflow: hidden;
          scroll-snap-align: start;
          border: 1px solid rgba(131,183,139,.2);
          border-radius: 12px;
          background: #0a0f0b;
          transition: border-color .18s ease, transform .18s ease, box-shadow .18s ease;
        }
        .generated-site-variant-card.selected {
          border-color: #b9ef4d;
          box-shadow: 0 0 0 2px rgba(185,239,77,.13), 0 18px 38px rgba(0,0,0,.28);
        }
        .generated-site-variant-card:focus-within { outline: 2px solid #b9ef4d; outline-offset: 2px; }
        .generated-site-variant-thumbnail {
          position: relative;
          height: 170px;
          overflow: hidden;
          background: #fff;
          border-bottom: 1px solid rgba(131,183,139,.16);
        }
        .generated-site-variant-thumbnail iframe {
          position: absolute;
          inset: 0 auto auto 0;
          width: 1200px;
          height: 800px;
          border: 0;
          pointer-events: none;
          transform: scale(.21);
          transform-origin: top left;
          background: #fff;
        }
        .generated-site-variant-copy { display: grid; gap: 7px; padding: 14px; }
        .generated-site-variant-copy > span {
          color: #718075;
          font: 700 8px "IBM Plex Mono", monospace;
          letter-spacing: .12em;
        }
        .generated-site-variant-copy h4 { margin: 0; color: #f4f7ef; font-size: 15px; }
        .generated-site-variant-copy p { min-height: 48px; margin: 0; color: #8e9a90; font-size: 11px; line-height: 1.45; }
        .generated-site-variant-copy button {
          min-height: 38px;
          margin-top: 3px;
          border: 1px solid rgba(185,239,77,.42);
          border-radius: 7px;
          color: #b9ef4d;
          background: rgba(185,239,77,.06);
          font: 850 9px "IBM Plex Mono", monospace;
          letter-spacing: .06em;
          cursor: pointer;
        }
        .generated-site-variant-copy button[aria-pressed="true"] {
          color: #071008;
          background: #b9ef4d;
          border-color: #b9ef4d;
        }
        @media (hover:hover) and (pointer:fine) {
          .generated-site-variant-card:hover { transform: translateY(-2px); border-color: rgba(185,239,77,.55); }
        }
        @media (max-width: 700px) {
          .generated-site-variant-selector { padding: 18px 14px; }
          .generated-site-variant-selector > header { align-items: start; flex-direction: column; }
          .generated-site-variant-strip { grid-auto-columns: minmax(255px, 82vw); }
        }
        @media (prefers-reduced-motion: reduce) {
          .generated-site-variant-card { transition: none; }
        }
      `}</style>
    </section>
  );
}
