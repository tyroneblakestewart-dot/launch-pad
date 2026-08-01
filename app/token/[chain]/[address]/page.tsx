import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicDexscreenerSection } from "@/components/public-dexscreener-section";
import { TokenHolderStats } from "@/components/token-holder-stats";
import { TokenTradeButtons } from "@/components/token-trade-buttons";
import { CHAIN_CONFIG } from "@/lib/chains";
import { isValidDexAddress } from "@/lib/server/dexscreener";
import { fetchTokenHolderStats } from "@/lib/server/token-holders";
import { getTradeTerminalLinks } from "@/lib/trade-terminal-links";
import type { SupportedChain } from "@/lib/types";

// No wallet signature and no database write happen anywhere on this route
// (issue #203) — it only reads public chain/market data, so it stays
// dynamic per-request with no cached page shell to invalidate.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPPORTED_CHAINS: SupportedChain[] = ["solana", "robinhood"];

type TokenPageParams = { chain: string; address: string };
type TokenPageProps = { params: Promise<TokenPageParams> };

function parseChain(value: string): SupportedChain | null {
  return (SUPPORTED_CHAINS as string[]).includes(value) ? (value as SupportedChain) : null;
}

export async function generateMetadata({ params }: TokenPageProps): Promise<Metadata> {
  const { chain, address } = await params;
  const parsedChain = parseChain(chain);
  if (!parsedChain || !isValidDexAddress(address)) return {};

  const title = `${address.slice(0, 6)}…${address.slice(-4)} on ${CHAIN_CONFIG[parsedChain].shortLabel}`;
  const description = `Live chart, trade links and holder stats for ${address} on ${CHAIN_CONFIG[parsedChain].label}.`;

  return {
    title,
    description,
    alternates: { canonical: `https://hoodlums.dev/token/${parsedChain}/${address}` },
    openGraph: { type: "website", title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function TokenPage({ params }: TokenPageProps) {
  const { chain, address } = await params;
  const parsedChain = parseChain(chain);
  if (!parsedChain || !isValidDexAddress(address)) notFound();

  const tradeLinks = getTradeTerminalLinks(parsedChain, address);
  const holderStats = await fetchTokenHolderStats(parsedChain, address);
  const chainInfo = CHAIN_CONFIG[parsedChain];

  return (
    <main className="token-page">
      <header className="token-page-header">
        <p className="token-page-chain">{chainInfo.label}</p>
        <h1>{address}</h1>
        <a href={`${chainInfo.explorerBaseUrl}${address}`} target="_blank" rel="noreferrer">
          VIEW ON {chainInfo.explorerLabel.toUpperCase()} ↗
        </a>
      </header>

      <TokenTradeButtons links={tradeLinks} />
      <PublicDexscreenerSection address={address} />
      <TokenHolderStats stats={holderStats} />

      <style>{`
        .token-page {
          min-height: 100vh;
          padding-top: 40px;
          color: #f4f7ef;
          font-family: system-ui, sans-serif;
        }
        .token-page-header {
          max-width: 960px;
          margin: 0 auto;
          padding: 0 24px 24px;
        }
        .token-page-chain {
          margin: 0 0 8px;
          color: #55ff78;
          font: 700 11px "IBM Plex Mono", monospace;
          letter-spacing: .08em;
        }
        .token-page-header h1 {
          margin: 0 0 16px;
          font-size: clamp(16px, 4vw, 24px);
          font-family: "IBM Plex Mono", monospace;
          word-break: break-all;
        }
        .token-page-header a {
          display: inline-block;
          padding: 10px 13px;
          border: 1px solid rgba(85,255,120,.45);
          border-radius: 6px;
          color: #55ff78;
          background: rgba(85,255,120,.06);
          font: 800 8px "IBM Plex Mono", monospace;
          letter-spacing: .06em;
          text-decoration: none;
        }
      `}</style>
    </main>
  );
}
