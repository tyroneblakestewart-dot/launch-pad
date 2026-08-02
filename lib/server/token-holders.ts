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
const BLOCKSCOUT_API_BASE = "https://explorer.testnet.chain.robinhood.com/api/v2";

type BlockscoutTokenInfo = { holders_count?: string; holders?: string; total_supply?: string };
type BlockscoutHolderItem = { address?: { hash?: string }; value?: string };
type BlockscoutHoldersPage = { items?: BlockscoutHolderItem[] };

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
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
