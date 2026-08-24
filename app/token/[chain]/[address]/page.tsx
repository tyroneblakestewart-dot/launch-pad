import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Address } from "viem";
import { TokenPageView } from "@/components/token-page/token-page-view";
import { CHAIN_CONFIG, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { isValidDexAddress } from "@/lib/server/dexscreener";
import { fetchTokenMarketStats } from "@/lib/server/token-market-stats";
import { resolveTokenCurveAddress } from "@/lib/server/token-launch-curve-lookup";
import { getTradeTerminalLinks } from "@/lib/trade-terminal-links";
import type { SupportedChain } from "@/lib/types";

// No wallet signature and no database write happen anywhere on this route
// (issue #203) — it only reads public chain/market data, so it stays
// dynamic per-request with no cached page shell to invalidate.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPPORTED_CHAINS: SupportedChain[] = ["solana", "robinhood"];

// CHAIN_CONFIG.label carries the wallet-facing "Robinhood Chain Testnet"
// name (lib/chains.ts is left untouched, since that name must stay accurate
// wherever a wallet reads it); this is neutral display copy for public page
// metadata instead (issue #308).
const CHAIN_DISPLAY_LABEL: Record<SupportedChain, string> = {
  solana: CHAIN_CONFIG.solana.label,
  robinhood: "Robinhood Chain · 46630",
};

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
  const description = `Live chart, trade links and holder stats for ${address} on ${CHAIN_DISPLAY_LABEL[parsedChain]}.`;

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

  // Only Robinhood Chain has a numeric EVM chain id today; Solana has no
  // terminal-support entries either way, so 0 is a safe non-match there.
  const chainId = parsedChain === "robinhood" ? ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL : 0;
  const tradeLinks = getTradeTerminalLinks(parsedChain, address, chainId);
  const marketStats = await fetchTokenMarketStats(parsedChain, address);
  const chainInfo = CHAIN_CONFIG[parsedChain];
  // Every launch through HoodlumsCurveLaunchPipeline deploys its own curve
  // (Milestone A, issue #409), so this looks up the curve token_launches
  // recorded for *this* token address, falling back to the legacy
  // single-curve-per-chain env var for anything launched before that table
  // existed (see lib/server/token-launch-curve-lookup.ts). `TokenLeftColumn`
  // still confirms on-chain that the resolved curve actually trades this
  // token before showing live swap controls.
  const curveAddress: Address | null =
    parsedChain === "robinhood" ? await resolveTokenCurveAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, address) : null;

  return (
    <TokenPageView
      chain={parsedChain}
      address={address}
      chainInfo={chainInfo}
      marketStats={marketStats}
      tradeLinks={tradeLinks}
      curveAddress={curveAddress}
    />
  );
}
