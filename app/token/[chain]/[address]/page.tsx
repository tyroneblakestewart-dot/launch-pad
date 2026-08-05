import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Address } from "viem";
import { TokenPageView } from "@/components/token-page/token-page-view";
import { CHAIN_CONFIG, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getBondingCurveAddress } from "@/lib/bonding-curve-config";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";
import { isValidDexAddress } from "@/lib/server/dexscreener";
import { fetchTokenMarketStats } from "@/lib/server/token-market-stats";
import { getTradeTerminalLinks } from "@/lib/trade-terminal-links";
import type { SupportedChain } from "@/lib/types";

// No wallet signature and no database write happen anywhere on this route
// (issue #203) — it only reads public chain/market data, so it stays
// dynamic per-request with no cached page shell to invalidate.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPPORTED_CHAINS: SupportedChain[] = ["solana", "robinhood"];

type TokenPageParams = { chain: string; address: string };
type TokenPageProps = {
  params: Promise<TokenPageParams>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

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

export default async function TokenPage({ params, searchParams }: TokenPageProps) {
  const { chain, address } = await params;
  const parsedChain = parseChain(chain);
  if (!parsedChain || !isValidDexAddress(address)) notFound();

  const tradeLinks = getTradeTerminalLinks(parsedChain, address);
  const [marketStats, { content }] = await Promise.all([
    fetchTokenMarketStats(parsedChain, address),
    resolvePageContent("token-page", (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM]),
  ]);
  const chainInfo = CHAIN_CONFIG[parsedChain];
  // Only one bonding curve is configured per chain today (see
  // lib/bonding-curve-config.ts), so this reads that single curve's
  // address; `TokenLeftColumn` confirms on-chain whether it actually
  // trades *this* token before showing live swap controls.
  const curveAddress: Address | null =
    parsedChain === "robinhood" ? getBondingCurveAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL) ?? null : null;

  return (
    <TokenPageView
      chain={parsedChain}
      address={address}
      chainInfo={chainInfo}
      marketStats={marketStats}
      tradeLinks={tradeLinks}
      curveAddress={curveAddress}
      content={{
        tradesTabLabel: content.trades_tab_label,
        holdersTabLabel: content.holders_tab_label,
        emptyTradesText: content.empty_trades_text,
        emptyHoldersText: content.empty_holders_text,
        tradeOnLabel: content.trade_on_label,
        emptyTerminalsText: content.empty_terminals_text,
        aboutLabel: content.about_label,
        emptyDescriptionText: content.empty_description_text,
        chatEmptyState: content.chat_empty_state,
        chatConnectPrompt: content.chat_connect_prompt,
      }}
    />
  );
}
