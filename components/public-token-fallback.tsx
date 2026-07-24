import { CHAIN_CONFIG } from "@/lib/chains";
import type { PublicGeneratedSite } from "@/lib/public-site";

function formatSupply(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) && value ? numeric.toLocaleString("en-GB") : value;
}

/**
 * Safe token-details view used whenever a public record exists but has no
 * complete/valid generated page HTML or artwork yet. Renders plain,
 * server-controlled markup only — no generated HTML is ever interpolated
 * here.
 */
export function PublicTokenFallback({ site }: { site: PublicGeneratedSite }) {
  const chain = CHAIN_CONFIG[site.chain];

  return (
    <section className="public-token-fallback">
      <p className="public-token-fallback-ticker">${site.ticker}</p>
      <h1>{site.name}</h1>
      {site.description ? <p className="public-token-fallback-description">{site.description}</p> : null}

      <dl className="public-token-fallback-facts">
        <div>
          <dt>Supply</dt>
          <dd>{formatSupply(site.supply)}</dd>
        </div>
        <div>
          <dt>Chain</dt>
          <dd>{chain.label}</dd>
        </div>
        {site.contractAddress ? (
          <div>
            <dt>Contract</dt>
            <dd>{site.contractAddress}</dd>
          </div>
        ) : null}
        {site.xHandle ? (
          <div>
            <dt>X</dt>
            <dd>{site.xHandle}</dd>
          </div>
        ) : null}
        {site.telegram ? (
          <div>
            <dt>Telegram</dt>
            <dd>{site.telegram}</dd>
          </div>
        ) : null}
      </dl>

      <style>{`
        .public-token-fallback {
          max-width: 720px;
          margin: 0 auto;
          padding: 64px 24px;
          color: #f4f7ef;
          font-family: system-ui, sans-serif;
        }
        .public-token-fallback-ticker {
          margin: 0 0 8px;
          color: #55ff78;
          font: 700 12px "IBM Plex Mono", monospace;
          letter-spacing: .1em;
        }
        .public-token-fallback h1 { margin: 0 0 16px; font-size: clamp(28px, 5vw, 44px); }
        .public-token-fallback-description { margin: 0 0 32px; color: #b9c4bb; line-height: 1.6; }
        .public-token-fallback-facts { display: grid; gap: 12px; }
        .public-token-fallback-facts div {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 12px 0;
          border-bottom: 1px solid rgba(131,183,139,.18);
        }
        .public-token-fallback-facts dt { color: #758078; }
        .public-token-fallback-facts dd { margin: 0; color: #f4f7ef; word-break: break-all; text-align: right; }
      `}</style>
    </section>
  );
}
