import type { BondingCurveGraduationStatus } from "@/lib/bonding-curve-status";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getCurveProgress } from "@/lib/server/curve-progress-cache";
import { resolveTokenCurveAddress } from "@/lib/server/token-launch-curve-lookup";
import type { SupportedChain } from "@/lib/types";
import { readUniswapSwapChainSlugs, resolveUniswapSwapUrl, type UniswapSwapChainSlugs } from "@/lib/uniswap-swap-link";

export type TokenBuyVenueDeps = {
  /** Test seam — defaults to the configured NEXT_PUBLIC_UNISWAP_SWAP_CHAIN_SLUGS map. */
  slugs?: UniswapSwapChainSlugs;
  /** Test seam — defaults to lib/server/token-launch-curve-lookup.ts. */
  resolveCurveAddress?: (chainId: number, tokenAddress: string) => Promise<`0x${string}` | null>;
  /** Test seam — defaults to the 20s-cached on-chain read in lib/server/curve-progress-cache.ts. */
  readProgress?: (chainId: number, curveAddress: string) => Promise<BondingCurveGraduationStatus | null>;
};

/**
 * Where a published site's Buy button should send a visitor right now
 * (owner direction, 13 Sep 2026): the Uniswap app with the token pre-filled
 * once the token has graduated into its locked Uniswap V3 pool, otherwise
 * `undefined` so the caller keeps the token's Hoodlums trade page — the
 * only place a still-bonding token can be bought.
 *
 * Reads nothing on-chain unless a Uniswap slug is configured for the chain
 * (see lib/uniswap-swap-link.ts), so with the default, unset config this is
 * a synchronous no-op and the served page behaves exactly as before. When a
 * slug is set, the graduation state comes from the same 20s-cached curve
 * read the homepage grid and token page already share, keyed by the
 * specific curve `token_launches` recorded for this token. Any failure —
 * no launch record, no curve, an RPC error — degrades to `undefined`
 * (Hoodlums trade page), never to a Uniswap link for a token that has not
 * graduated and never to a rendering error on the public site.
 */
export async function resolvePublishedSiteBuyHref(
  facts: { chain: SupportedChain; contractAddress: string },
  deps: TokenBuyVenueDeps = {},
): Promise<string | undefined> {
  const contractAddress = facts.contractAddress.trim();
  if (!contractAddress) return undefined;
  // Only Robinhood Chain launches have a bonding curve to graduate from.
  if (facts.chain !== "robinhood") return undefined;

  const swapUrl = resolveUniswapSwapUrl(facts.chain, contractAddress, deps.slugs ?? readUniswapSwapChainSlugs());
  if (!swapUrl) return undefined;

  try {
    const chainId = ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL;
    const curveAddress = await (deps.resolveCurveAddress ?? resolveTokenCurveAddress)(chainId, contractAddress);
    if (!curveAddress) return undefined;
    const status = await (deps.readProgress ?? getCurveProgress)(chainId, curveAddress);
    return status?.state === "graduated" ? swapUrl : undefined;
  } catch {
    return undefined;
  }
}
