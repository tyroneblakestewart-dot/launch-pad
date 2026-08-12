import type { SupportedChain } from "../types";
import { fetchDexPairsForAddress, selectBestPair } from "./dexscreener";

export type TokenHolder = { address: string; balance: string; percent: number | null };

export type TokenHolderStats =
  | { supported: false }
  | {
      supported: true;
      holderCount: number | null;
      holders: TokenHolder[];
      lpAddress: string | null;
      error?: string;
    };

const HOLDERS_TIMEOUT_MS = 6_000;
const MAX_HOLDERS = 10;

// The Robinhood Chain Testnet explorer (`lib/chains.ts`'s `explorerBaseUrl`)
// runs Blockscout, whose v2 REST API (https://docs.blockscout.com/devs/apis/rest)
// is stable across instances built on that software.
export const BLOCKSCOUT_API_BASE = "https://explorer.testnet.chain.robinhood.com/api/v2";

// Exported so `lib/server/token-market-stats.ts` can read the same token-info
// endpoint (name/symbol/decimals/market cap) without a second definition of
// the Blockscout base URL or shape.
export type BlockscoutTokenInfo = {
  name?: string;
  symbol?: string;
  decimals?: string;
  holders_count?: string;
  holders?: string;
  total_supply?: string;
  exchange_rate?: string | null;
  circulating_market_cap?: string | null;
};
type BlockscoutHolderItem = { address?: { hash?: string }; value?: string };
type BlockscoutHoldersPage = { items?: BlockscoutHolderItem[] };

export async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Best-effort holder stats from public chain-explorer data. Only wired up
 * for `robinhood` today (the confirmed chain in issue #203); Solana holder
 * counts would need a different, unconfirmed data source, so that chain
 * resolves to `{ supported: false }` instead of guessing. Any lookup
 * failure still resolves (never throws) so the token page degrades to a
 * clean "stats unavailable" state rather than a broken page.
 */
export async function fetchTokenHolderStats(
  chain: SupportedChain,
  address: string,
): Promise<TokenHolderStats> {
  if (chain !== "robinhood") return { supported: false };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HOLDERS_TIMEOUT_MS);
  try {
    const [info, holdersPage, pairs] = await Promise.all([
      fetchJson<BlockscoutTokenInfo>(
        `${BLOCKSCOUT_API_BASE}/tokens/${encodeURIComponent(address)}`,
        controller.signal,
      ),
      fetchJson<BlockscoutHoldersPage>(
        `${BLOCKSCOUT_API_BASE}/tokens/${encodeURIComponent(address)}/holders`,
        controller.signal,
      ),
      fetchDexPairsForAddress(address),
    ]);

    if (!info && !holdersPage) {
      return {
        supported: true,
        holderCount: null,
        holders: [],
        lpAddress: null,
        error: "Holder data is not available for this token yet.",
      };
    }

    // Excludes the LP pool address from top holders so pooled liquidity
    // never displays as if it were a whale holder (issue #203).
    const lpAddress = selectBestPair(pairs)?.pairAddress?.toLowerCase() || null;
    const totalSupply = Number(info?.total_supply || 0);
    const rawHolderCount = Number(info?.holders_count ?? info?.holders ?? NaN);

    const items = Array.isArray(holdersPage?.items) ? holdersPage.items : [];
    const holders: TokenHolder[] = items
      .filter((item) => {
        const hash = item.address?.hash?.toLowerCase();
        return Boolean(hash) && hash !== lpAddress;
      })
      .slice(0, MAX_HOLDERS)
      .map((item) => ({
        address: item.address!.hash!,
        balance: item.value || "0",
        percent: totalSupply > 0 ? (Number(item.value || 0) / totalSupply) * 100 : null,
      }));

    return {
      supported: true,
      holderCount: Number.isFinite(rawHolderCount) ? rawHolderCount : null,
      holders,
      lpAddress,
    };
  } catch {
    return {
      supported: true,
      holderCount: null,
      holders: [],
      lpAddress: null,
      error: "Holder data lookup failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// 60s window: matches `lib/server/dexscreener.ts`'s `lookupDexscreenerPair`
// cache (issue #286) — long enough to spare Blockscout a call on every page
// view of a public token site, short enough that a freshly-launched token's
// holder stats show up without a regeneration or republish. Same in-memory
// TTL-map approach as that lookup, for the same reason: `app/[slug]/page.tsx`
// renders with `dynamic = "force-dynamic"`, so Next's fetch cache is off, and
// `unstable_cache` isn't available under this project's Vitest setup.
const HOLDER_STATS_CACHE_TTL_MS = 60_000;

type HolderStatsCacheEntry = { expiresAt: number; result: Promise<TokenHolderStats> };

const holderStatsCache = new Map<string, HolderStatsCacheEntry>();

export function resetTokenHolderStatsCacheForTests(): void {
  holderStatsCache.clear();
}

/** Cached wrapper around `fetchTokenHolderStats` for request-time callers like `app/[slug]/page.tsx`. */
export async function lookupTokenHolderStats(
  chain: SupportedChain,
  address: string,
): Promise<TokenHolderStats> {
  const key = `${chain}:${address.toLowerCase()}`;
  const cached = holderStatsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const result = fetchTokenHolderStats(chain, address);
  holderStatsCache.set(key, { expiresAt: Date.now() + HOLDER_STATS_CACHE_TTL_MS, result });
  return result;
}
