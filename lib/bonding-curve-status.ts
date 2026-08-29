import { formatEther, type Address } from "viem";

// Pure re-implementation of the display model derived from
// contracts/HoodlumsTestBondingCurve.sol's public state. Progress mirrors
// the contract's own `graduationProgressBps()`: realNativeReserve /
// graduationTarget, in basis points. realNativeReserve already excludes
// every accrued trading fee (fees live separately in treasuryFeeBalance /
// creatorFeeBalance and are never added to realNativeReserve), so this
// naturally excludes fees from the progress figure too.

export const GRADUATION_PROGRESS_BPS_MAX = 10_000n;
export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export type BondingCurveGraduationState = "not-funded" | "bonding" | "graduated";

export interface BondingCurveOnChainState {
  funded: boolean;
  graduated: boolean;
  /** `realNativeReserve()` — post-fee native currently raised on the curve. */
  realNativeReserveWei: bigint;
  /** `graduationTarget()` — the immutable post-fee target. */
  graduationTargetWei: bigint;
  /** `liquidityPool()` — `ZERO_ADDRESS` before graduation. */
  liquidityPool: Address;
}

export interface BondingCurveGraduationStatus {
  state: BondingCurveGraduationState;
  /** 0-10000; matches the contract's `graduationProgressBps()`. */
  progressBps: bigint;
  raisedWei: bigint;
  targetWei: bigint;
  /** The locked pool address once graduated, otherwise `null`. */
  liquidityPool: Address | null;
}

/**
 * Maps raw on-chain bonding-curve reads to the three UI display states:
 * not-funded (creator hasn't placed the supply into the curve yet), bonding
 * (trading open, progressing toward the target), and graduated (target hit,
 * liquidity permanently locked). `_graduate()` zeroes `realNativeReserve` on
 * the contract itself, so the graduated branch reports the target as fully
 * raised rather than echoing that reset value.
 */
export function computeBondingCurveGraduationStatus(
  onChain: BondingCurveOnChainState,
): BondingCurveGraduationStatus {
  const targetWei = onChain.graduationTargetWei;

  if (onChain.graduated) {
    const pool = onChain.liquidityPool === ZERO_ADDRESS ? null : onChain.liquidityPool;
    return {
      state: "graduated",
      progressBps: GRADUATION_PROGRESS_BPS_MAX,
      raisedWei: targetWei,
      targetWei,
      liquidityPool: pool,
    };
  }

  if (!onChain.funded) {
    return { state: "not-funded", progressBps: 0n, raisedWei: 0n, targetWei, liquidityPool: null };
  }

  const raisedWei = onChain.realNativeReserveWei;
  const progressBps =
    targetWei <= 0n
      ? 0n
      : raisedWei >= targetWei
        ? GRADUATION_PROGRESS_BPS_MAX
        : (raisedWei * GRADUATION_PROGRESS_BPS_MAX) / targetWei;

  return { state: "bonding", progressBps, raisedWei, targetWei, liquidityPool: null };
}

/** Formats progress basis points (0-10000) as a one-decimal percentage string, e.g. "42.5%". */
export function formatGraduationProgressPercent(progressBps: bigint): string {
  const clamped =
    progressBps < 0n ? 0n : progressBps > GRADUATION_PROGRESS_BPS_MAX ? GRADUATION_PROGRESS_BPS_MAX : progressBps;
  return `${(Number(clamped) / 100).toFixed(1)}%`;
}

/**
 * Formats the token page v2 header band's graduation summary (issue #443
 * part 1), e.g. "3.12 / 4.0 ETH · 78%" — raised at 2dp, target at 1dp,
 * progress at 0dp, matching design/token-page-v2/token-page-data-inventory.md
 * section 1.
 */
export function formatGraduationSummary(raisedWei: bigint, targetWei: bigint, progressBps: bigint): string {
  const clampedBps =
    progressBps < 0n ? 0n : progressBps > GRADUATION_PROGRESS_BPS_MAX ? GRADUATION_PROGRESS_BPS_MAX : progressBps;
  const raised = Number(formatEther(raisedWei)).toFixed(2);
  const target = Number(formatEther(targetWei)).toFixed(1);
  const pct = (Number(clampedBps) / 100).toFixed(0);
  return `${raised} / ${target} ETH · ${pct}%`;
}

/** Formats the header band's "x.xx ETH remaining" line (issue #443 part 1). */
export function formatGraduationRemainingLabel(remainingWei: bigint): string {
  return `${Number(formatEther(remainingWei)).toFixed(2)} ETH remaining`;
}
