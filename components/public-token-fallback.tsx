import { TelegramMark, XMark } from "@/components/brand-icons";
import { CHAIN_CONFIG } from "@/lib/chains";
import type { PublicGeneratedSite } from "@/lib/public-site";
import { extractTelegramHandle, extractTwitterHandle, telegramProfileUrl, xProfileUrl } from "@/lib/social-links";

function formatSupply(value: string): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && value) return numeric.toLocaleString("en-GB");
  return "—";
}

/**
 * Safe token-details view used whenever a public record exists but has no
 * complete/valid generated page HTML or artwork yet. Renders plain,
 * server-controlled markup only — no generated HTML is ever interpolated
 * here. The X/Telegram hrefs below are always built by this code as
 * https://x.com/<handle> or https://t.me/<handle> from a normalised handle
 * — the raw stored string is never interpolated into an href, so that
 * guarantee holds for the social links too.
 */
export function PublicTokenFallback({ site }: { site: PublicGeneratedSite }) {
  const chain = CHAIN_CONFIG[site.chain];
  const xHandle = extractTwitterHandle(site.xHandle);
  const telegramHandle = extractTelegramHandle(site.telegram);
  const showSocials = Boolean(xHandle || telegramHandle);

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
        {site.xHandle && !xHandle ? (
          <div>
            <dt>X</dt>
            <dd>{site.xHandle}</dd>
          </div>
        ) : null}
        {site.telegram && !telegramHandle ? (
          <div>
            <dt>Telegram</dt>
            <dd>{site.telegram}</dd>
          </div>
        ) : null}
      </dl>

      {showSocials ? (
        <div className="public-token-fallback-socials">
          {xHandle ? (
            <a
              className="public-token-fallback-social-link"
              href={xProfileUrl(xHandle)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <XMark className="public-token-fallback-social-icon" aria-hidden="true" />
              <span>@{xHandle}</span>
            </a>
          ) : null}
          {telegramHandle ? (
            <a
              className="public-token-fallback-social-link"
              href={telegramProfileUrl(telegramHandle)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <TelegramMark className="public-token-fallback-social-icon" aria-hidden="true" />
              <span>@{telegramHandle}</span>
            </a>
          ) : null}
        </div>
      ) : null}

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
        .public-token-fallback-socials {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 20px;
        }
        .public-token-fallback-social-link {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-height: 44px;
          min-width: 44px;
          padding: 10px 18px;
          border-radius: 999px;
          background: rgba(85, 255, 120, .1);
          border: 1px solid rgba(131, 183, 139, .35);
          color: #f4f7ef;
          text-decoration: none;
          font-weight: 600;
          max-width: 100%;
          overflow-wrap: anywhere;
        }
        .public-token-fallback-social-link:hover,
        .public-token-fallback-social-link:focus-visible {
          background: rgba(85, 255, 120, .18);
          border-color: rgba(85, 255, 120, .5);
        }
        .public-token-fallback-social-icon { width: 20px; height: 20px; flex-shrink: 0; }
      `}</style>
    </section>
  );
}
