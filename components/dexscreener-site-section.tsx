"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchDexscreenerPair,
  formatDexscreenerLiquidity,
  type DexscreenerPairResult,
} from "@/lib/dexscreener-client";

function getFieldValue(labelText: string) {
  const labels = Array.from(document.querySelectorAll(".builder-panel label"));
  const label = labels.find(
    (item) => item.querySelector(".field-label")?.textContent?.replace("OPTIONAL", "").trim() === labelText,
  );
  return (label?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null)?.value.trim() || "";
}

export function DexscreenerSiteSection() {
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<DexscreenerPairResult>({ found: false });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let container: HTMLDivElement | null = null;

    const ensureMount = () => {
      const roadmap = document.querySelector(".site-preview #roadmap");
      if (!roadmap?.parentElement) return;

      if (!container?.isConnected) {
        container = document.createElement("div");
        container.className = "dexscreener-portal-mount";
        roadmap.parentElement.insertBefore(container, roadmap);
        setMount(container);
      }
    };

    const interval = window.setInterval(() => {
      ensureMount();
      const nextAddress = getFieldValue("Contract / mint address");
      setAddress((current) => (current === nextAddress ? current : nextAddress));
    }, 350);

    ensureMount();

    return () => {
      window.clearInterval(interval);
      container?.remove();
    };
  }, []);

  useEffect(() => {
    if (!address) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        setResult(await fetchDexscreenerPair(address, controller.signal));
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setResult({ address, found: false, error: "Dexscreener pair lookup failed." });
      } finally {
        setLoading(false);
      }
    }, 650);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [address]);

  if (!mount) return null;

  const visibleResult = address && result.address === address ? result : { found: false };
  const visibleLoading = Boolean(address && loading);
  const searchUrl = address
    ? `https://dexscreener.com/search?q=${encodeURIComponent(address)}`
    : "https://dexscreener.com";

  return createPortal(
    <section className="preview-content dexscreener-section" id="chart">
      <div className="dexscreener-heading">
        <div>
          <div className="section-tag">{"// LIVE MARKET"}</div>
          <h3>DEXSCREENER</h3>
        </div>
        <a href={visibleResult.pairUrl || searchUrl} target="_blank" rel="noreferrer">
          OPEN DEXSCREENER ↗
        </a>
      </div>

      {visibleResult.found && visibleResult.embedUrl ? (
        <div className="dexscreener-frame-shell">
          <div className="dexscreener-status">
            <span><i /> LIVE PAIR</span>
            <b>{visibleResult.dexId?.toUpperCase()} · {formatDexscreenerLiquidity(visibleResult.liquidityUsd)}</b>
          </div>
          <iframe
            title="Live Dexscreener chart"
            src={visibleResult.embedUrl}
            loading="lazy"
            allow="clipboard-write"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <div className="dexscreener-empty">
          <span className={visibleLoading ? "dexscreener-loader active" : "dexscreener-loader"} />
          <div>
            <strong>{visibleLoading ? "Searching Dexscreener…" : address ? "Trading pair not detected yet" : "Chart activates after launch"}</strong>
            <p>
              {visibleResult.error || (address
                ? "Once liquidity creates a Dexscreener pair, the live chart will appear here automatically."
                : "Add the contract or mint address after launch. The page will then find and display the most liquid pair.")}
            </p>
          </div>
          <a href={searchUrl} target="_blank" rel="noreferrer">CHECK DEXSCREENER ↗</a>
        </div>
      )}

      <style>{`
        .dexscreener-section {
          background:
            radial-gradient(circle at 82% 18%, color-mix(in srgb, var(--generated-primary, #55ff78) 12%, transparent), transparent 32%),
            #060a07;
        }
        .dexscreener-heading {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 22px;
        }
        .dexscreener-heading h3 { margin-bottom: 0; }
        .dexscreener-heading > a,
        .dexscreener-empty > a {
          flex: none;
          padding: 10px 13px;
          border: 1px solid color-mix(in srgb, var(--generated-primary, #55ff78) 45%, transparent);
          border-radius: var(--generated-radius-value, 6px);
          color: var(--generated-primary, #55ff78);
          background: color-mix(in srgb, var(--generated-primary, #55ff78) 6%, transparent);
          font: 800 8px var(--mono);
          letter-spacing: .06em;
        }
        .dexscreener-frame-shell {
          overflow: hidden;
          border: 1px solid color-mix(in srgb, var(--generated-primary, #55ff78) 34%, transparent);
          border-radius: var(--generated-radius-value, 8px);
          background: #050806;
          box-shadow: 0 22px 60px rgba(0,0,0,.32);
        }
        .dexscreener-status {
          min-height: 38px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 0 13px;
          border-bottom: 1px solid color-mix(in srgb, var(--generated-primary, #55ff78) 20%, transparent);
          color: #758078;
          font: 700 8px var(--mono);
        }
        .dexscreener-status span { display: flex; align-items: center; gap: 7px; color: var(--generated-primary, #55ff78); }
        .dexscreener-status i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--generated-primary, #55ff78);
          box-shadow: 0 0 10px var(--generated-primary, #55ff78);
          animation: living-status-pulse 1.8s ease-in-out infinite;
        }
        .dexscreener-frame-shell iframe {
          display: block;
          width: 100%;
          height: clamp(430px, 58vw, 650px);
          border: 0;
          background: #050806;
        }
        .dexscreener-empty {
          min-height: 210px;
          display: grid;
          grid-template-columns: auto minmax(0,1fr) auto;
          align-items: center;
          gap: 18px;
          padding: 28px;
          border: 1px dashed color-mix(in srgb, var(--generated-primary, #55ff78) 32%, transparent);
          border-radius: var(--generated-radius-value, 8px);
          background: color-mix(in srgb, var(--generated-primary, #55ff78) 3%, #050806);
        }
        .dexscreener-empty strong { display: block; margin-bottom: 7px; color: var(--generated-text, #f4f7ef); font-size: 15px; }
        .dexscreener-empty p { max-width: 620px; margin: 0; color: var(--generated-muted, #7b877d); font: 9px/1.7 var(--mono); }
        .dexscreener-loader {
          width: 46px;
          height: 46px;
          border: 1px solid color-mix(in srgb, var(--generated-primary, #55ff78) 24%, transparent);
          border-top-color: var(--generated-primary, #55ff78);
          border-radius: 50%;
        }
        .dexscreener-loader.active { animation: dexscreener-spin .8s linear infinite; }
        @keyframes dexscreener-spin { to { transform: rotate(360deg); } }
        @media (max-width: 700px) {
          .dexscreener-heading { align-items: start; flex-direction: column; }
          .dexscreener-empty { grid-template-columns: auto 1fr; padding: 20px; }
          .dexscreener-empty > a { grid-column: 1 / -1; text-align: center; }
          .dexscreener-frame-shell iframe { height: 470px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .dexscreener-loader.active, .dexscreener-status i { animation: none !important; }
        }
      `}</style>
    </section>,
    mount,
  );
}
