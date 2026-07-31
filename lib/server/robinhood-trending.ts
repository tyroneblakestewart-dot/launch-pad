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
 * Dexscreener's public "top boosts" + per-token "pairs" endpoints (issue
 * #185 follow-up on PR #190, replacing the GMGN feed): no API key, no
 * Cloudflare bot-management issue. Boosted listings are paid promotions
 * across every chain Dexscreener indexes, not an organic swap-volume
 * ranking, so this filters down to entries whose `chainId` names Robinhood
 * Chain.
 */
const BOOSTS_ENDPOINT = "https://api.dexscreener.com/token-boosts/top/v1";
const ROBINHOOD_CHAIN_SLUG = "robinhood";
const FEED_TIMEOUT_MS = 6_000;
const MAX_TOKENS = 10;

// Dexscreener's documented rate limit is 60 req/min. A single trending-panel
// refresh fans out to 1 (boosts) + up to MAX_TOKENS (per-token pair) calls,
// so the combined result is cached briefly to keep repeat polls (every 60s
// per open tab) from multiplying that fan-out across every visitor.
const FEED_CACHE_TTL_MS = 45_000;

type DexBoost = {
  chainId?: string;
  tokenAddress?: string;
  icon?: string;
};

type DexPairSummary = {
  baseToken?: { name?: string; symbol?: string };
  priceChange?: { m5?: number; h1?: number };
  marketCap?: number | null;
  fdv?: number | null;
  liquidity?: { usd?: number | null };
  url?: string;
};

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function filterRobinhoodBoosts(payload: unknown): DexBoost[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter(
      (item): item is DexBoost =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as DexBoost).tokenAddress === "string" &&
            typeof (item as DexBoost).chainId === "string" &&
            (item as DexBoost).chainId!.toLowerCase().includes(ROBINHOOD_CHAIN_SLUG),
        ),
    )
    .slice(0, MAX_TOKENS);
}

function selectBestPairSummary(pairs: DexPairSummary[]): DexPairSummary | null {
  return (
    [...pairs].sort(
      (a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0),
    )[0] || null
  );
}

export function buildTrendingToken(
  boost: DexBoost,
  pair: DexPairSummary | null,
  rank: number,
): TrendingToken | null {
  if (!boost.tokenAddress || !boost.chainId) return null;
  return {
    rank,
    name: pair?.baseToken?.name || pair?.baseToken?.symbol || "Unknown",
    ticker: pair?.baseToken?.symbol || "?",
    address: boost.tokenAddress,
    artworkUrl: boost.icon || "",
    marketCapUsd: toNumber(pair?.marketCap ?? pair?.fdv),
    priceChangePercent: toNumber(pair?.priceChange?.m5 ?? pair?.priceChange?.h1),
    url: pair?.url || `https://dexscreener.com/${boost.chainId}/${boost.tokenAddress}`,
  };
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Dexscreener request failed with status ${response.status}`);
  }
  return response.json();
}

async function fetchTrendingTokensUncached(): Promise<TrendingFeedResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const boosts = filterRobinhoodBoosts(await fetchJson(BOOSTS_ENDPOINT, controller.signal));
    if (boosts.length === 0) return { tokens: [], error: false };

    const pairs = await Promise.all(
      boosts.map(async (boost) => {
        try {
          const payload = await fetchJson(
            `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(
              boost.chainId!,
            )}/${encodeURIComponent(boost.tokenAddress!)}`,
            controller.signal,
          );
          return selectBestPairSummary(Array.isArray(payload) ? (payload as DexPairSummary[]) : []);
        } catch {
          return null;
        }
      }),
    );

    const tokens = boosts
      .map((boost, index) => buildTrendingToken(boost, pairs[index], index + 1))
      .filter((token): token is TrendingToken => token !== null);

    return { tokens, error: false };
  } catch (err) {
    console.error("[robinhood-trending] Dexscreener request failed:", err);
    return { tokens: [], error: true };
  } finally {
    clearTimeout(timeout);
  }
}

let cache: { expiresAt: number; result: Promise<TrendingFeedResult> } | null = null;

export function resetRobinhoodTrendingCacheForTests(): void {
  cache = null;
}

/**
 * Server-only fetch of Robinhood Chain's boosted-token feed from Dexscreener.
 * Any failure — request error, bad JSON, timeout — resolves to an
 * error-flagged empty result instead of throwing; having zero boosted
 * Robinhood Chain tokens right now is a normal, non-error empty result.
 */
export function fetchRobinhoodTrendingTokens(): Promise<TrendingFeedResult> {
  if (cache && cache.expiresAt > Date.now()) return cache.result;
  const result = fetchTrendingTokensUncached();
  cache = { expiresAt: Date.now() + FEED_CACHE_TTL_MS, result };
  return result;
}
