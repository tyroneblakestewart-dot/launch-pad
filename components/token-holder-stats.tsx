import type { TokenHolderStats as TokenHolderStatsResult } from "@/lib/server/token-holders";

function shortenAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function formatPercent(percent: number | null): string {
  return percent === null ? "—" : `${percent < 0.01 ? "<0.01" : percent.toFixed(2)}%`;
}

export function TokenHolderStats({ stats }: { stats: TokenHolderStatsResult }) {
  return (
    <section className="token-holder-stats" aria-label="Holder stats">
      <div className="token-holder-stats-heading">
        <h2>Holders</h2>
        {stats.supported && stats.holderCount !== null ? (
          <b>{stats.holderCount.toLocaleString("en-GB")} holders</b>
        ) : null}
      </div>

      {!stats.supported ? (
        <p className="token-holder-stats-empty">Holder stats aren&rsquo;t available for this chain yet.</p>
      ) : stats.error || stats.holders.length === 0 ? (
        <p className="token-holder-stats-empty">
          {stats.error || "No holder data found for this token yet."}
        </p>
      ) : (
        <>
          <ol className="token-holder-stats-list">
            {stats.holders.map((holder, index) => (
              <li key={holder.address}>
                <span className="token-holder-stats-rank">{index + 1}</span>
                <span className="token-holder-stats-address">{shortenAddress(holder.address)}</span>
                <span className="token-holder-stats-percent">{formatPercent(holder.percent)}</span>
              </li>
            ))}
          </ol>
          <p className="token-holder-stats-note">Liquidity pool address excluded from this list.</p>
        </>
      )}

      <style>{`
        .token-holder-stats {
          max-width: 960px;
          margin: 0 auto;
          padding: 0 24px 64px;
          color: #f4f7ef;
          font-family: system-ui, sans-serif;
        }
        .token-holder-stats-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 18px;
        }
        .token-holder-stats-heading h2 { margin: 0; font-size: 20px; }
        .token-holder-stats-heading b { color: #55ff78; font: 700 11px "IBM Plex Mono", monospace; }
        .token-holder-stats-empty { color: #7b877d; font: 12px/1.7 "IBM Plex Mono", monospace; }
        .token-holder-stats-list {
          display: grid;
          gap: 1px;
          margin: 0 0 12px;
          padding: 0;
          list-style: none;
          border: 1px solid rgba(85,255,120,.2);
          border-radius: 8px;
          overflow: hidden;
        }
        .token-holder-stats-list li {
          display: grid;
          grid-template-columns: 28px 1fr auto;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          background: rgba(85,255,120,.03);
          font: 11px/1.4 "IBM Plex Mono", monospace;
        }
        .token-holder-stats-rank { color: #7b877d; }
        .token-holder-stats-address { color: #f4f7ef; word-break: break-all; }
        .token-holder-stats-percent { color: #55ff78; text-align: right; }
        .token-holder-stats-note { margin: 0; color: #7b877d; font: 10px/1.6 "IBM Plex Mono", monospace; }
      `}</style>
    </section>
  );
}
