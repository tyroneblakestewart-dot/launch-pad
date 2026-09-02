// Pure, bigint-exact Uniswap V3 sqrtPriceX96 -> "native per whole token"
// price math (issue #466's post-graduation pool feed). Both sides of every
// pool this platform's curves graduate into are 18-decimal (the platform
// token via FixedSupplyMemeToken, and WETH9), so the raw on-chain ratio is
// already the human-readable one — no decimal adjustment is needed.
//
// Uniswap V3's own price convention: `(sqrtPriceX96 / 2^96)^2` is the price
// of token0 denominated in token1 — how many token1 units per 1 token0 unit.
// The result is scaled to an 18-decimal fixed-point integer (matching every
// other *Raw amount field in this codebase, wei-per-whole-unit) so callers
// can decode it exactly the same way as any other amount, via viem's
// `formatEther`.

const Q96 = 2n ** 96n;
const WEI_PER_ETHER = 10n ** 18n;

/** Price of token1 per 1 whole token0, scaled to 18 decimals. */
function priceToken1PerToken0Raw(sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 <= 0n) return 0n;
  return (sqrtPriceX96 * sqrtPriceX96 * WEI_PER_ETHER) / (Q96 * Q96);
}

/**
 * The pool's current spot price, expressed as native-currency wei per one
 * whole platform token — the same quantity `tradeSpotPriceNativePerToken`
 * (lib/candle-bucketing.ts) derives from a bonding curve's virtual reserves,
 * so both sources decode identically downstream. `tokenIsToken0` says which
 * side of the pool the platform token sits on: when true, token1 is the
 * native/WETH side and the raw token1-per-token0 price *is* the answer
 * directly; when false (the platform token is token1, WETH is token0), the
 * answer is the reciprocal.
 */
export function computeSpotPriceNativePerTokenRaw(sqrtPriceX96: bigint, tokenIsToken0: boolean): string {
  const token1PerToken0Raw = priceToken1PerToken0Raw(sqrtPriceX96);
  if (tokenIsToken0) return token1PerToken0Raw.toString();
  if (token1PerToken0Raw <= 0n) return "0";
  return ((WEI_PER_ETHER * WEI_PER_ETHER) / token1PerToken0Raw).toString();
}
