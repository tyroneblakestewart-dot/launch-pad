// Pure Uniswap V3 sqrtPriceX96 -> spot price math (issue #466), kept
// dependency-free and bigint-exact so it's directly unit-testable without a
// network call, matching lib/bonding-curve-fee-math.ts's own pure-bigint
// style. Every token this platform's factory/curve mints is a plain ERC20
// with the default (18) decimals, and so is WETH9 — this module assumes
// 18/18 decimals on both sides of the pool, exactly as issue #466 specifies,
// rather than threading a decimals parameter through for a case that cannot
// occur on this platform's own launches.

const Q96 = 2n ** 96n;
const WAD = 10n ** 18n;

/**
 * Uniswap V3's sqrtPriceX96 encodes price = token1/token0 as
 * sqrt(price) * 2^96. Squaring and rescaling to a fixed-point WAD (1e18)
 * value keeps this bigint-exact — sqrtPriceX96 is a uint160, far beyond
 * Number's safe integer range once squared — and is directly the
 * ETH-per-whole-token price whenever token1 is the native (WETH) side, since
 * equal 18/18 decimals cancel out the usual decimals-adjustment factor.
 */
function priceToken1PerToken0Wad(sqrtPriceX96: bigint): bigint {
  return (sqrtPriceX96 * sqrtPriceX96 * WAD) / (Q96 * Q96);
}

/**
 * Derives a pool swap's spot price as ETH (native) per whole project token,
 * WAD-scaled so it round-trips through viem's `formatEther` exactly like
 * every other `...Raw` wei-style field on `TokenTrade`. When the native side
 * is token0, the raw token1/token0 ratio is tokens-per-ETH, so the
 * WAD-scaled reciprocal is taken instead.
 */
export function computePoolSpotPriceNativePerTokenRaw(sqrtPriceX96: bigint, nativeIsToken0: boolean): bigint {
  const token1PerToken0 = priceToken1PerToken0Wad(sqrtPriceX96);
  if (!nativeIsToken0) return token1PerToken0;
  if (token1PerToken0 === 0n) return 0n;
  return (WAD * WAD) / token1PerToken0;
}
