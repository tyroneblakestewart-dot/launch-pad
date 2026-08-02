// Pure slippage-floor math for the token page's swap panel (issue #225),
// mirroring the `minTokensOut` / `minNativeOut` guard on
// contracts/HoodlumsTestBondingCurve.sol's `buy()` / `sell()`.

const BPS_DENOMINATOR = 10_000n;

/**
 * Smallest acceptable output for a quoted buy/sell given a slippage
 * tolerance in basis points (e.g. 100 = 1%). Passed as `minTokensOut` /
 * `minNativeOut` so the trade reverts instead of executing at a worse price.
 */
export function applySlippageFloor(quotedOutput: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new Error(`slippageBps must be an integer between 0 and 10000, got: ${slippageBps}`);
  }
  if (quotedOutput <= 0n) return 0n;
  return (quotedOutput * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR;
}
