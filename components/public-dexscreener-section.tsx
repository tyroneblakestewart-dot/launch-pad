"use client";

import { useEffect, useState } from "react";
import {
  fetchDexscreenerPair,
  formatDexscreenerLiquidity,
  type DexscreenerPairResult,
} from "@/lib/dexscreener-client";

/**
 * Standalone Dexscreener chart section for the public `app/[slug]` page.
 * Unlike the studio's `DexscreenerSiteSection`, this takes the contract
 * address directly as a prop instead of polling the studio DOM, since the
 * public page has no studio form to read from.
 */
export function PublicDexscreenerSection({ address }: { address: string }) {
  const [result, setResult] = useState<DexscreenerPairResult>({ found: false });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();

    async function run() {
      setLoading(true);
      try {
        setResult(await fetchDexscreenerPair(address, controller.signal));
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setResult({ address, found: false, error: "Dexscreener pair lookup failed." });
      } finally {
        setLoading(false);
      }
    }

    run();
    return () => controller.abort();
  }, [address]);

  const visibleResult = result.address === address ? result : { found: false };
  const searchUrl = `https://dexscreener.com/search?q=${encodeURIComponent(address)}`;

  return (
    <section className="public-dexscreener-section" id="chart">
      <div className="public-dexscreener-heading">
        <h2>Dexscreener</h2>
        <a href={visibleResult.pairUrl || searchUrl} target="_blank" rel="noreferrer">
          OPEN DEXSCREENER ↗
        </a>
      </div>

      {visibleResult.found && visibleResult.embedUrl ? (
        <div className="public-dexscreener-frame-shell">
          <div className="public-dexscreener-status">
            <span>LIVE PAIR</span>
            <b>
              {visibleResult.dexId?.toUpperCase()} · {formatDexscreenerLiquidity(visibleResult.liquidityUsd)}
            </b>
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
        <div className="public-dexscreener-empty">
          <strong>{loading ? "Searching Dexscreener…" : "Trading pair not detected yet"}</strong>
          <p>
            {visibleResult.error ||
              "Once liquidity creates a Dexscreener pair, the live chart will appear here automatically."}
          </p>
          <a href={searchUrl} target="_blank" rel="noreferrer">
            CHECK DEXSCREENER ↗
          </a>
        </div>
      )}

      <style>{`
        .public-dexscreener-section {
          max-width: 960px;
          margin: 0 auto;
          padding: 0 24px 64px;
          color: #f4f7ef;
          font-family: system-ui, sans-serif;
        }
        .public-dexscreener-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 18px;
        }
        .public-dexscreener-heading h2 { margin: 0; font-size: 20px; }
        .public-dexscreener-heading a,
        .public-dexscreener-empty a {
          flex: none;
          padding: 10px 13px;
          border: 1px solid rgba(85,255,120,.45);
          border-radius: 6px;
          color: #55ff78;
          background: rgba(85,255,120,.06);
          font: 800 8px "IBM Plex Mono", monospace;
          letter-spacing: .06em;
          text-decoration: none;
        }
        .public-dexscreener-frame-shell {
          overflow: hidden;
          border: 1px solid rgba(85,255,120,.34);
          border-radius: 8px;
          background: #050806;
        }
        .public-dexscreener-status {
          min-height: 38px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 0 13px;
          border-bottom: 1px solid rgba(85,255,120,.2);
          color: #55ff78;
          font: 700 8px "IBM Plex Mono", monospace;
        }
        .public-dexscreener-frame-shell iframe {
          display: block;
          width: 100%;
          height: clamp(430px, 58vw, 650px);
          border: 0;
          background: #050806;
        }
        .public-dexscreener-empty {
          display: grid;
          gap: 14px;
          padding: 28px;
          border: 1px dashed rgba(85,255,120,.32);
          border-radius: 8px;
          background: rgba(85,255,120,.03);
        }
        .public-dexscreener-empty p { margin: 0; color: #7b877d; font: 12px/1.7 "IBM Plex Mono", monospace; }
      `}</style>
    </section>
  );
}
