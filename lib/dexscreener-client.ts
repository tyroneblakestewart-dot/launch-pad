/**
 * Shared client-side helper for `/api/dexscreener-pair`, used by both the
 * studio preview (`components/dexscreener-site-section.tsx`) and the
 * public page's Dexscreener section so the fetch/parse logic exists once.
 */

export type DexscreenerPairResult = {
  address?: string;
  found?: boolean;
  pairUrl?: string;
  embedUrl?: string;
  chainId?: string;
  dexId?: string;
  liquidityUsd?: number;
  error?: string;
};

export async function fetchDexscreenerPair(
  address: string,
  signal?: AbortSignal,
): Promise<DexscreenerPairResult> {
  const response = await fetch(`/api/dexscreener-pair?address=${encodeURIComponent(address)}`, {
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as DexscreenerPairResult;
  if (!response.ok) {
    return { address, found: false, error: payload.error || "Pair lookup failed." };
  }
  return { ...payload, address };
}

export function formatDexscreenerLiquidity(value?: number): string {
  if (!value) return "Liquidity detected";
  return `${new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)} liquidity`;
}
