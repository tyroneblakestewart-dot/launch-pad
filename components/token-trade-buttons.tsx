import type { TradeTerminalLink } from "@/lib/trade-terminal-links";

/**
 * Row of referral-coded "trade on X" links for the confirmed-supporting
 * terminals on this token's chain. Plain server-rendered anchors — no
 * wallet connection or signature is involved in showing or following them.
 */
export function TokenTradeButtons({ links }: { links: TradeTerminalLink[] }) {
  if (links.length === 0) return null;

  return (
    <section className="token-trade-buttons" aria-label="Trade this token">
      {links.map((link) => (
        <a key={link.id} href={link.url} target="_blank" rel="noreferrer">
          TRADE ON {link.label.toUpperCase()} ↗
        </a>
      ))}

      <style>{`
        .token-trade-buttons {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          max-width: 960px;
          margin: 0 auto;
          padding: 0 24px 24px;
        }
        .token-trade-buttons a {
          flex: none;
          padding: 12px 16px;
          border: 1px solid rgba(85,255,120,.45);
          border-radius: 6px;
          color: #55ff78;
          background: rgba(85,255,120,.06);
          font: 800 10px "IBM Plex Mono", monospace;
          letter-spacing: .06em;
          text-decoration: none;
        }
      `}</style>
    </section>
  );
}
