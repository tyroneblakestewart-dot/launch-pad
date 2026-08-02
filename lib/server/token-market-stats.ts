import type { SupportedChain } from "../types";
import {
  BLOCKSCOUT_API_BASE,
  fetchJson,
  fetchTokenHolderStats,
  type BlockscoutTokenInfo,
  type TokenHolder,
} from "./token-holders";
import {
  buildDexscreenerPairResult,
  fetchDexPairsForAddress,
  selectBestPair,
} from "./dexscreener";

const STATS_TIMEOUT_MS = 6_000;
const MAX_TRADES = 12;

export type TokenTrade = {
  type: "buy" | "sell";
  wallet: string;
  amountRaw: string;
  time: string;
  txHash: string;
};

export type TokenChartInfo =
  | { found: false }
  | { found: true; pairUrl: string; embedUrl: string; dexId: string };

export type TokenMarketStats =
  | { supported: false }
  | {
      supported: true;
      name: string | null;
      symbol: string | null;
      decimals: number | null;
      priceUsd: number | null;
      priceChange24hPercent: number | null;
      marketCapUsd: number | null;
      liquidityUsd: number | null;
      volume24hUsd: number | null;
      holderCount: number | null;
      holders: TokenHolder[];
      lpAddress: string | null;
      trades: TokenTrade[];
      chart: TokenChartInfo;
      error?: string;
    };

type BlockscoutTransferItem = {
  from?: { hash?: string };
  to?: { hash?: string };
  timestamp?: string;
  tx_hash?: string;
  total?: { value?: string };
};
type BlockscoutTransfersPage = { items?: BlockscoutTransferItem[] };

function relativeTime(isoTimestamp: string | undefined): string {
  if (!isoTimestamp) return "";
  const then = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.floor(diffHours / 24)}d`;
}

/**
 * Classifies raw Blockscout token-transfer items into buy/sell rows relative
 * to the token's LP pool address: a transfer OUT of the pool is a buy (the
 * pool sent tokens to a wallet), a transfer IN to the pool is a sell.
 * Wallet-to-wallet transfers that never touch the pool aren't trades and are
 * dropped. Pure function so classification is unit-testable without a
 * network call, mirroring `lib/bonding-curve-status.ts`'s pure-mapper style.
 */
export function classifyTrades(
  items: BlockscoutTransferItem[],
  lpAddress: string | null,
): TokenTrade[] {
  if (!lpAddress) return [];
  const lower = lpAddress.toLowerCase();

  const trades: TokenTrade[] = [];
  for (const item of items) {
    const from = item.from?.hash?.toLowerCase();
    const to = item.to?.hash?.toLowerCase();
    if (from === lower && to) {
      trades.push({
        type: "buy",
        wallet: to,
        amountRaw: item.total?.value || "0",
        time: relativeTime(item.timestamp),
        txHash: item.tx_hash || "",
      });
    } else if (to === lower && from) {
      trades.push({
        type: "sell",
        wallet: from,
        amountRaw: item.total?.value || "0",
        time: relativeTime(item.timestamp),
        txHash: item.tx_hash || "",
      });
    }
    if (trades.length >= MAX_TRADES) break;
  }
  return trades;
}

/**
 * Aggregated market snapshot for the public token page (issue #225): token
 * identity, market cap, liquidity, 24h volume, holders and recent trades.
 * Holder/LP-exclusion logic is reused from `fetchTokenHolderStats` rather
 * than duplicated; identity and market cap primarily read the same
 * Blockscout endpoint that function already calls, and liquidity/volume/
 * price/chart data come from the Dexscreener pair also already fetched
 * there for LP-address detection. Only wired up for `robinhood` today,
 * matching `fetchTokenHolderStats`'s chain support. Never throws — any
 * failure resolves to a result with empty/null fields and an `error`
 * message so the page always degrades gracefully instead of breaking.
 */
export async function fetchTokenMarketStats(
  chain: SupportedChain,
  address: string,
): Promise<TokenMarketStats> {
  if (chain !== "robinhood") return { supported: false };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATS_TIMEOUT_MS);
  try {
    const [holderStats, info, pairs, transfers] = await Promise.all([
      fetchTokenHolderStats(chain, address),
      fetchJson<BlockscoutTokenInfo>(
        `${BLOCKSCOUT_API_BASE}/tokens/${encodeURIComponent(address)}`,
        controller.signal,
      ),
      fetchDexPairsForAddress(address),
      fetchJson<BlockscoutTransfersPage>(
        `${BLOCKSCOUT_API_BASE}/tokens/${encodeURIComponent(address)}/transfers`,
        controller.signal,
      ),
    ]);

    const pair = selectBestPair(pairs);
    const chartResult = buildDexscreenerPairResult(pair);
    const chart: TokenChartInfo = chartResult.found
      ? {
          found: true,
          pairUrl: chartResult.pairUrl,
          embedUrl: chartResult.embedUrl,
          dexId: chartResult.dexId,
        }
      : { found: false };

    const lpAddress = pair?.pairAddress ? pair.pairAddress.toLowerCase() : null;
    const trades = classifyTrades(Array.isArray(transfers?.items) ? transfers.items : [], lpAddress);

    const priceFromPair = pair?.priceUsd ? Number(pair.priceUsd) : null;
    const priceFromBlockscout = info?.exchange_rate ? Number(info.exchange_rate) : null;
    const priceUsd = priceFromPair !== null && Number.isFinite(priceFromPair)
      ? priceFromPair
      : priceFromBlockscout !== null && Number.isFinite(priceFromBlockscout)
        ? priceFromBlockscout
        : null;

    const marketCapFromPair = pair?.marketCap ?? pair?.fdv ?? null;
    const marketCapFromBlockscout = info?.circulating_market_cap
      ? Number(info.circulating_market_cap)
      : null;
    const marketCapUsd = marketCapFromPair !== null && Number.isFinite(marketCapFromPair)
      ? marketCapFromPair
      : marketCapFromBlockscout !== null && Number.isFinite(marketCapFromBlockscout)
        ? marketCapFromBlockscout
        : null;

    const decimals = info?.decimals !== undefined ? Number(info.decimals) : null;

    return {
      supported: true,
      name: info?.name ?? null,
      symbol: info?.symbol ?? null,
      decimals: decimals !== null && Number.isFinite(decimals) ? decimals : null,
      priceUsd,
      priceChange24hPercent: pair?.priceChange?.h24 ?? null,
      marketCapUsd,
      liquidityUsd: pair?.liquidity?.usd ?? null,
      volume24hUsd: pair?.volume?.h24 ?? null,
      holderCount: holderStats.supported ? holderStats.holderCount : null,
      holders: holderStats.supported ? holderStats.holders : [],
      lpAddress,
      trades,
      chart,
      error: holderStats.supported ? holderStats.error : undefined,
    };
  } catch {
    return {
      supported: true,
      name: null,
      symbol: null,
      decimals: null,
      priceUsd: null,
      priceChange24hPercent: null,
      marketCapUsd: null,
      liquidityUsd: null,
      volume24hUsd: null,
      holderCount: null,
      holders: [],
      lpAddress: null,
      trades: [],
      chart: { found: false },
      error: "Market data lookup failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
