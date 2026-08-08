import { CHAIN_CONFIG } from "@/lib/chains";
import { TelegramIcon, XIcon } from "@/components/icons/social-icons";
import type { PublicGeneratedSite } from "@/lib/public-site";

function formatSupply(value: string): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && value) return numeric.toLocaleString("en-GB");
  return "—";
}

// Studio-saved values may already be a bare handle ("hoodlums"), an
// @-prefixed handle, a domain-prefixed handle ("x.com/hoodlums",
// "t.me/hoodlums") or a full URL (components/provider-launcher.tsx and
// components/social-hub.tsx each save a slightly different shape), so this
// normalises all of them down to a single profile URL. Returns null for an
// empty/whitespace-only value so callers can hide the link entirely.
function socialProfileUrl(raw: string, domain: string, domainPrefixes: readonly string[]): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  let handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  for (const prefix of domainPrefixes) {
    if (handle.toLowerCase().startsWith(prefix)) {
      handle = handle.slice(prefix.length);
      break;
    }
  }
  return handle ? `https://${domain}/${handle}` : null;
}

/**
 * Safe token-details view used whenever a public record exists but has no
 * complete/valid generated page HTML or artwork yet. Renders plain,
 * server-controlled markup only — no generated HTML is ever interpolated
 * here.
 */
export function PublicTokenFallback({ site }: { site: PublicGeneratedSite }) {
  const chain = CHAIN_CONFIG[site.chain];
  const xUrl = socialProfileUrl(site.xHandle, "x.com", ["x.com/", "twitter.com/"]);
  const telegramUrl = socialProfileUrl(site.telegram, "t.me", ["t.me/"]);

  return (
    <section className="public-token-fallback">
      <p className="public-token-fallback-ticker">${site.ticker}</p>
      <h1>{site.name}</h1>
      {site.description ? <p className="public-token-fallback-description">{site.description}</p> : null}

      {xUrl || telegramUrl ? (
        <div className="public-token-fallback-socials">
          {xUrl ? (
            <a href={xUrl} target="_blank" rel="noreferrer" className="public-token-fallback-social-button">
              <XIcon className="public-token-fallback-social-icon" />
              <span>X</span>
            </a>
          ) : null}
          {telegramUrl ? (
            <a href={telegramUrl} target="_blank" rel="noreferrer" className="public-token-fallback-social-button">
              <TelegramIcon className="public-token-fallback-social-icon" />
              <span>Telegram</span>
            </a>
          ) : null}
        </div>
      ) : null}

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
        .public-token-fallback-socials { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 32px; }
        .public-token-fallback-social-button {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 9px 14px;
          color: #f4f7ef;
          text-decoration: none;
          font: 600 13px system-ui, sans-serif;
          background: #0a0f0c;
          border: 1px solid rgba(131,183,139,.18);
          border-radius: 999px;
          transition: border-color .15s ease;
        }
        .public-token-fallback-social-button:hover { border-color: rgba(85,255,120,.5); }
        .public-token-fallback-social-icon { width: 18px; height: 18px; flex: none; }
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
