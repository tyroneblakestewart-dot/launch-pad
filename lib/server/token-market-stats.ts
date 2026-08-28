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
      chart: TokenChartInfo;
      error?: string;
    };

/**
 * Aggregated market snapshot for the public token page (issue #225): token
 * identity, market cap, liquidity, 24h volume and holders. Holder/LP-
 * exclusion logic is reused from `fetchTokenHolderStats` rather than
 * duplicated; identity and market cap primarily read the same Blockscout
 * endpoint that function already calls, and liquidity/volume/price/chart
 * data come from the Dexscreener pair also already fetched there for
 * LP-address detection. Only wired up for `robinhood` today, matching
 * `fetchTokenHolderStats`'s chain support. Never throws — any failure
 * resolves to a result with empty/null fields and an `error` message so the
 * page always degrades gracefully instead of breaking. Recent trades used to
 * live here too (a Blockscout LP-transfer heuristic that only ever worked
 * once a token had a Dexscreener-indexed pool, never a still-bonding curve
 * token) — issue #430 replaced it with a real on-chain read of the bonding
 * curve's own trade events (lib/server/token-trades-rpc.ts), so the
 * Blockscout `/transfers` fetch and its classifier were removed here rather
 * than left as a dead, wasted request on every page load.
 */
export async function fetchTokenMarketStats(
  chain: SupportedChain,
  address: string,
): Promise<TokenMarketStats> {
  if (chain !== "robinhood") return { supported: false };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATS_TIMEOUT_MS);
  try {
    const [holderStats, info, pairs] = await Promise.all([
      fetchTokenHolderStats(chain, address),
      fetchJson<BlockscoutTokenInfo>(
        `${BLOCKSCOUT_API_BASE}/tokens/${encodeURIComponent(address)}`,
        controller.signal,
      ),
      fetchDexPairsForAddress(address),
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
      chart: { found: false },
      error: "Market data lookup failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
