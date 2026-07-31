export type TrendingToken = {
  rank: number;
  name: string;
  ticker: string;
  addressLabel: string;
  marketCapUsd: number;
  percentChange5m: number;
  artworkUrl: string;
  linkUrl: string;
};

export type RobinhoodTrendingResult = {
  tokens: TrendingToken[];
  error: boolean;
};

const TRENDING_TIMEOUT_MS = 6_000;
const TRENDING_CACHE_TTL_MS = 60_000;
const TRENDING_TOKEN_LIMIT = 10;

// GMGN has no officially documented third-party API, so this endpoint is a
// best-effort placeholder (issue #185) — confirm the real endpoint and
// response shape with the owner, then override via GMGN_API_BASE_URL if it
// differs, and adjust mapGmgnPayloadToTrendingTokens's field names below.
const DEFAULT_GMGN_BASE_URL = "https://gmgn.ai/defi/quotation/v1/rank/robinhood/swaps/5m";

type GlobalWithTrendingCache = typeof globalThis & {
  __hoodlumsRobinhoodTrendingCache?: { expiresAt: number; result: Promise<RobinhoodTrendingResult> };
};

function trendingCacheSlot(): GlobalWithTrendingCache {
  return globalThis as GlobalWithTrendingCache;
}

export function resetRobinhoodTrendingCacheForTests(): void {
  delete trendingCacheSlot().__hoodlumsRobinhoodTrendingCache;
}

function shortenAddress(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 6)}…`;
}

function toFiniteNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDisplayText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

type GmgnTrendingItemRaw = {
  symbol?: unknown;
  name?: unknown;
  address?: unknown;
  market_cap?: unknown;
  price_change_5m?: unknown;
  logo?: unknown;
};

/**
 * Maps a GMGN trending-rank payload to this app's own token shape. See the
 * DEFAULT_GMGN_BASE_URL comment above — this mapping is unconfirmed and
 * exists so the panel and route have a stable, testable contract to build
 * against while the real integration is verified with the owner.
 */
export function mapGmgnPayloadToTrendingTokens(payload: unknown): TrendingToken[] {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? (payload as { data: unknown[] }).data
      : [];

  return items.slice(0, TRENDING_TOKEN_LIMIT).map((raw, index) => {
    const item = (raw || {}) as GmgnTrendingItemRaw;
    const address = toDisplayText(item.address, "");
    return {
      rank: index + 1,
      name: toDisplayText(item.name, toDisplayText(item.symbol, "Unknown")),
      ticker: toDisplayText(item.symbol, "?"),
      addressLabel: address ? shortenAddress(address) : "",
      marketCapUsd: toFiniteNumber(item.market_cap),
      percentChange5m: toFiniteNumber(item.price_change_5m),
      artworkUrl: toDisplayText(item.logo, ""),
      linkUrl: address
        ? `https://gmgn.ai/robinhood/token/${encodeURIComponent(address)}`
        : "https://gmgn.ai/",
    };
  });
}

async function fetchGmgnTrending(): Promise<RobinhoodTrendingResult> {
  const apiKey = process.env.GMGN_API_KEY?.trim() || "";
  if (!apiKey) return { tokens: [], error: true };

  const baseUrl = process.env.GMGN_API_BASE_URL?.trim() || DEFAULT_GMGN_BASE_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRENDING_TIMEOUT_MS);
  try {
    const response = await fetch(baseUrl, {
      headers: { Accept: "application/json", "X-Api-Key": apiKey },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return { tokens: [], error: true };

    const payload = await response.json();
    return { tokens: mapGmgnPayloadToTrendingTokens(payload), error: false };
  } catch {
    return { tokens: [], error: true };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Cached globally for TRENDING_CACHE_TTL_MS (not per-IP), so this bounds
 * outbound GMGN calls to roughly once a minute regardless of page traffic —
 * matching the issue's "revalidate every 60 seconds" spec and standing in
 * for per-request rate limiting on what is likely a paid external API.
 */
export async function getRobinhoodTrending(): Promise<RobinhoodTrendingResult> {
  const cache = trendingCacheSlot();
  const cached = cache.__hoodlumsRobinhoodTrendingCache;
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const result = fetchGmgnTrending();
  cache.__hoodlumsRobinhoodTrendingCache = { expiresAt: Date.now() + TRENDING_CACHE_TTL_MS, result };
  return result;
}
