import { fetchDexPairsForAddress, selectBestPair, type DexPair } from "./dexscreener";

export type TrendingToken = {
  rank: number;
  name: string;
  ticker: string;
  address: string;
  artworkUrl: string;
  marketCapUsd: number;
  priceChangePercent: number;
  url: string;
};

export type TrendingFeedResult = { tokens: TrendingToken[]; error: boolean };

/**
 * Confirmed by the project owner in issue #185: GMGN's 5-minute Robinhood
 * Chain swap-ranking endpoint. `GMGN_API_KEY` is a server-only bearer token
 * (never a `NEXT_PUBLIC_` value) that must be set in the deployment
 * environment, not committed here.
 */
const GMGN_ENDPOINT =
  "https://gmgn.ai/defi/quotation/v1/rank/robinhood/swaps/5m?orderby=swaps&direction=desc";

const FEED_TIMEOUT_MS = 6_000;
const MAX_TOKENS = 10;

type GmgnRankItem = {
  address?: string;
  symbol?: string;
  name?: string;
  logo?: string;
  price_change_percent5m?: number | string;
  market_cap?: number | string;
  usd_market_cap?: number | string;
};

type GmgnPayload = {
  data?: { rank?: GmgnRankItem[] } | GmgnRankItem[];
};

function toNumber(value: number | string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapGmgnPayloadToTrendingTokens(payload: GmgnPayload | null | undefined): TrendingToken[] {
  const items = Array.isArray(payload?.data) ? payload?.data : payload?.data?.rank;
  if (!Array.isArray(items)) return [];

  return items
    .filter((item): item is GmgnRankItem => Boolean(item?.address && (item.symbol || item.name)))
    .slice(0, MAX_TOKENS)
    .map((item, index) => ({
      rank: index + 1,
      name: item.name || item.symbol || "Unknown",
      ticker: item.symbol || "?",
      address: item.address || "",
      artworkUrl: item.logo || "",
      marketCapUsd: toNumber(item.usd_market_cap ?? item.market_cap),
      priceChangePercent: toNumber(item.price_change_percent5m),
      url: `https://gmgn.ai/robinhood/token/${item.address}`,
    }));
}

/**
 * Server-only fetch of the Robinhood Chain trending feed. Without
 * `GMGN_API_KEY` configured, or on any request failure, this resolves to an
 * empty, error-flagged result instead of throwing — the trending panel
 * shows "Feed unavailable" rather than pretending the integration is live.
 */
export async function fetchRobinhoodTrendingTokens(): Promise<TrendingFeedResult> {
  const apiKey = process.env.GMGN_API_KEY?.trim();
  console.log("[robinhood-trending] key present:", !!apiKey);
  if (!apiKey) return { tokens: [], error: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(GMGN_ENDPOINT, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        // Vercel's serverless fetch sends no User-Agent by default, which is
        // a common trigger for Cloudflare bot-management 403s independent of
        // IP reputation. A standard browser UA is a low-risk mitigation to
        // try before changing the (owner-confirmed, see issue #185) endpoint.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable body>");
      console.error(
        `[robinhood-trending] GMGN request failed with status ${response.status}:`,
        body,
      );
      return { tokens: [], error: true };
    }

    const payload = (await response.json()) as GmgnPayload;
    return { tokens: mapGmgnPayloadToTrendingTokens(payload), error: false };
  } catch (err) {
    console.error("[robinhood-trending] GMGN request threw:", err);
    return { tokens: [], error: true };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Dexscreener's public "top boosts" feed (no API key). It lists currently
 * boosted (paid-promotion) tokens across all chains, not an organic
 * swap-volume ranking — the closest thing to a live "trending" signal
 * Dexscreener's public API offers per issue #185's follow-up discussion.
 */
const DEX_BOOSTS_ENDPOINT = "https://api.dexscreener.com/token-boosts/top/v1";
const SOLANA_CHAIN_ID = "solana";
const BOOSTS_TIMEOUT_MS = 6_000;

// A single panel refresh already fans out to 1 + up to MAX_TOKENS requests
// against Dexscreener; caching the combined result keeps repeat 60s polls
// across multiple open tabs from multiplying that against Dexscreener's
// stated 60 req/min limit.
const SOLANA_FEED_CACHE_TTL_MS = 30_000;

type DexBoostItem = { chainId?: string; tokenAddress?: string };

let solanaFeedCache: { expiresAt: number; result: Promise<TrendingFeedResult> } | null = null;

export function resetSolanaTrendingCacheForTests(): void {
  solanaFeedCache = null;
}

async function fetchSolanaBoostAddresses(): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BOOSTS_TIMEOUT_MS);
  try {
    const response = await fetch(DEX_BOOSTS_ENDPOINT, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Dexscreener boosts request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as DexBoostItem[] | null;
    if (!Array.isArray(payload)) return [];

    const seen = new Set<string>();
    const addresses: string[] = [];
    for (const item of payload) {
      const address = item?.tokenAddress;
      if (item?.chainId !== SOLANA_CHAIN_ID || !address || seen.has(address)) continue;
      seen.add(address);
      addresses.push(address);
      if (addresses.length >= MAX_TOKENS) break;
    }
    return addresses;
  } finally {
    clearTimeout(timeout);
  }
}

function pairToTrendingToken(pair: DexPair, rank: number): TrendingToken | null {
  const address = pair.baseToken?.address;
  const ticker = pair.baseToken?.symbol;
  if (!address || !ticker) return null;

  return {
    rank,
    name: pair.baseToken?.name || ticker,
    ticker,
    address,
    artworkUrl: pair.info?.imageUrl || "",
    marketCapUsd: toNumber(pair.marketCap ?? pair.fdv ?? undefined),
    priceChangePercent: toNumber(pair.priceChange?.h24 ?? undefined),
    url: pair.url || `https://dexscreener.com/solana/${address}`,
  };
}

async function fetchSolanaTrendingTokensUncached(): Promise<TrendingFeedResult> {
  try {
    const addresses = await fetchSolanaBoostAddresses();
    if (addresses.length === 0) return { tokens: [], error: false };

    const pairsByAddress = await Promise.all(addresses.map((address) => fetchDexPairsForAddress(address)));
    const tokens = pairsByAddress
      .map((pairs) => selectBestPair(pairs))
      .map((pair, index) => (pair ? pairToTrendingToken(pair, index + 1) : null))
      .filter((token): token is TrendingToken => token !== null);

    return { tokens, error: false };
  } catch (err) {
    console.error("[solana-trending] Dexscreener request threw:", err);
    return { tokens: [], error: true };
  }
}

/**
 * Server-only fetch of live Solana trending tokens: discovers currently
 * boosted Solana addresses via Dexscreener's public boosts feed, then
 * enriches each with the same `/latest/dex/tokens` lookup already used by
 * `lib/server/dexscreener.ts` to get a name, ticker, price change and
 * market cap. No API key required. Any failure resolves to an empty,
 * error-flagged result instead of throwing.
 */
export function fetchSolanaTrendingTokens(): Promise<TrendingFeedResult> {
  if (solanaFeedCache && solanaFeedCache.expiresAt > Date.now()) return solanaFeedCache.result;

  const result = fetchSolanaTrendingTokensUncached();
  solanaFeedCache = { expiresAt: Date.now() + SOLANA_FEED_CACHE_TTL_MS, result };
  return result;
}
