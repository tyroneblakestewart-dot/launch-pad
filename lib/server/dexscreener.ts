export type DexPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  url?: string;
  liquidity?: { usd?: number | null };
  volume?: { h24?: number | null };
};

export type DexscreenerPairResult =
  | { found: false }
  | {
      found: true;
      pairUrl: string;
      embedUrl: string;
      chainId: string;
      dexId: string;
      liquidityUsd: number;
    };

export const DEX_ADDRESS_PATTERN = /^[A-Za-z0-9]{24,80}$/;

export function isValidDexAddress(value: string): boolean {
  return DEX_ADDRESS_PATTERN.test(value);
}

export function selectBestPair(pairs: DexPair[]): DexPair | null {
  return (
    [...pairs]
      .filter((item) => item.chainId && item.pairAddress)
      .sort((a, b) => {
        const liquidityDifference =
          Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0);
        if (liquidityDifference !== 0) return liquidityDifference;
        return Number(b.volume?.h24 || 0) - Number(a.volume?.h24 || 0);
      })[0] || null
  );
}

export function buildDexscreenerPairResult(pair: DexPair | null): DexscreenerPairResult {
  if (!pair?.chainId || !pair.pairAddress) return { found: false };

  const pairUrl = pair.url || `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`;
  return {
    found: true,
    pairUrl,
    embedUrl: `${pairUrl}?embed=1&theme=dark&trades=0&info=0`,
    chainId: pair.chainId,
    dexId: pair.dexId || "DEX",
    liquidityUsd: Number(pair.liquidity?.usd || 0),
  };
}

const LOOKUP_TIMEOUT_MS = 6_000;

// 30-60s window: long enough to spare Dexscreener a call on every page view
// of a public token page, short enough that a newly-live pair shows up
// without a regeneration or republish.
const LOOKUP_CACHE_TTL_MS = 45_000;

type PairCacheEntry = { expiresAt: number; result: Promise<DexscreenerPairResult> };

// `app/[slug]/page.tsx` renders with `dynamic = "force-dynamic"`, which
// disables Next's per-request fetch cache, and `unstable_cache` requires a
// live Next.js incremental-cache instance that isn't available in this
// project's Vitest setup — so the lookup keeps its own small in-memory TTL
// cache instead, keyed on address, scoped to this module/server instance.
const pairCache = new Map<string, PairCacheEntry>();

export function resetDexscreenerPairCacheForTests(): void {
  pairCache.clear();
}

async function fetchDexscreenerPair(address: string): Promise<DexscreenerPairResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!response.ok) return { found: false };

    const payload = (await response.json()) as { pairs?: DexPair[] | null };
    const pairs = Array.isArray(payload.pairs) ? payload.pairs : [];
    return buildDexscreenerPairResult(selectBestPair(pairs));
  } catch {
    return { found: false };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Direct server-side Dexscreener lookup used by `app/[slug]/page.tsx` to
 * substitute the free-site chart section at request time (issue #173).
 * Distinct from `/api/dexscreener-pair` (used by client components that
 * poll while a creator is typing an address): this is a one-shot call made
 * once per page render, so it talks to Dexscreener directly instead of
 * round-tripping through this app's own API. Any failure — invalid
 * address, network error, timeout, bad response — resolves to `not found`
 * so the page falls back to the coming-soon panel instead of failing the
 * whole request. The result (including a failure's `not found`) is cached
 * per address for `LOOKUP_CACHE_TTL_MS` (issue #176) so repeat views within
 * the window don't re-hit Dexscreener.
 */
export async function lookupDexscreenerPair(address: string): Promise<DexscreenerPairResult> {
  if (!isValidDexAddress(address)) return { found: false };

  const cached = pairCache.get(address);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const result = fetchDexscreenerPair(address);
  pairCache.set(address, { expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS, result });
  return result;
}
