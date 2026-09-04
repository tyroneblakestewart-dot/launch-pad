// Pure re-implementation of the fee arithmetic in
// contracts/HoodlumsTestBondingCurve.sol's `_tradingFee` (ceil-rounded 1% of
// BPS) and `buy()`'s net-of-fee accounting. Used by
// scripts/graduate-hoodlums-bonding-curve.ts to compute the exact gross
// native amount that nets to a specific remaining-to-graduate value, since
// `buy()` only calls `_graduate()` when `realNativeReserve` lands exactly on
// `graduationTarget`.

export const BPS = 10_000n;
export const TRADING_FEE_BPS = 100n;
/** Mirrors the contract's `PROTOCOL_FEE_SHARE_BPS` (issue #112) — the treasury's share of every trading fee. */
export const PROTOCOL_FEE_SHARE_BPS = 6_000n;
/** Mirrors the contract's `CREATOR_FEE_SHARE_BPS` (issue #112) — the creator's share of every trading fee. */
export const CREATOR_FEE_SHARE_BPS = 4_000n;

function mulDivCeil(a: bigint, b: bigint, c: bigint): bigint {
  return (a * b + c - 1n) / c;
}

/** Mirrors `_tradingFee`: ceil-rounded so any nonzero amount pays a strictly positive fee. */
export function tradingFee(amount: bigint): bigint {
  if (amount <= 0n) return 0n;
  return mulDivCeil(amount, TRADING_FEE_BPS, BPS);
}

/** Net native amount a `buy()` call would credit toward `realNativeReserve` for a given gross `msg.value`. */
export function buyNetFromGross(grossNativeIn: bigint): bigint {
  if (grossNativeIn <= 0n) return 0n;
  return grossNativeIn - tradingFee(grossNativeIn);
}

/**
 * Smallest gross native input whose post-fee net equals `targetNet` exactly.
 *
 * `buyNetFromGross` is non-decreasing in its input and never skips a value
 * (each 1% fee-bracket boundary repeats a net value rather than jumping past
 * it), so for every non-negative `targetNet` an exact gross solution exists.
 * Binary search for the smallest gross whose net is >= targetNet always
 * lands exactly on it.
 */
export function grossNativeInForExactNet(targetNet: bigint): bigint {
  if (targetNet < 0n) {
    throw new Error(`targetNet must be non-negative, got: ${targetNet.toString()}`);
  }
  if (targetNet === 0n) return 0n;

  let lo = targetNet;
  // The fee is 1% of gross, so gross is at most ~1.02x the net amount;
  // this upper bound leaves ample margin.
  let hi = targetNet + targetNet / 50n + 100n;

  while (lo < hi) {
    const mid = lo + (hi - lo) / 2n;
    if (buyNetFromGross(mid) >= targetNet) {
      hi = mid;
    } else {
      lo = mid + 1n;
    }
  }

  if (buyNetFromGross(lo) !== targetNet) {
    throw new Error(`Could not find an exact gross native input for net ${targetNet.toString()}`);
  }
  return lo;
}

/**
 * Mirrors the contract's `GRADUATION_FEE_BPS` (owner decision, 4 Sep 2026):
 * a one-off 5% of the post-trading-fee native reserve, charged once at
 * graduation and credited 100% to the treasury's claimable balance. Only the
 * remaining 95% seeds the locked pool. Curves deployed before this constant
 * existed charge nothing — the UI reads the live `GRADUATION_FEE_BPS()` per
 * curve (lib/use-token-curve-status.ts) rather than trusting this mirror.
 */
export const GRADUATION_FEE_BPS = 500n;

/** Mirrors `_graduationFee`: floor-rounded, so rounding only ever favours pool liquidity over the fee. */
export function graduationFee(reserve: bigint, graduationFeeBps: bigint = GRADUATION_FEE_BPS): bigint {
  if (reserve <= 0n || graduationFeeBps <= 0n) return 0n;
  return (reserve * graduationFeeBps) / BPS;
}

/** Native currency that actually reaches the locked pool when a curve with this target graduates. */
export function graduationPoolLiquidity(targetWei: bigint, graduationFeeBps: bigint = GRADUATION_FEE_BPS): bigint {
  if (targetWei <= 0n) return 0n;
  return targetWei - graduationFee(targetWei, graduationFeeBps);
}
