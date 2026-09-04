import { formatEther, type Address } from "viem";
import { formatNativeAmountSixSigFigsTrimmed } from "./token-page-format";

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
 * part 1, precision fixed in issue #447 item 4), e.g.
 * "0.0000099 / 0.01 ETH · 0%" — raised and target both go through the same
 * six-significant-figure, trailing-zeros-trimmed
 * `formatNativeAmountSixSigFigsTrimmed` helper (a fixed 2dp/1dp format reads
 * as "0.00 / 0.0 ETH" for a small testnet target, wrong at both ends),
 * progress stays at 0dp.
 */
export function formatGraduationSummary(raisedWei: bigint, targetWei: bigint, progressBps: bigint): string {
  const clampedBps =
    progressBps < 0n ? 0n : progressBps > GRADUATION_PROGRESS_BPS_MAX ? GRADUATION_PROGRESS_BPS_MAX : progressBps;
  const raised = formatNativeAmountSixSigFigsTrimmed(Number(formatEther(raisedWei)));
  const target = formatNativeAmountSixSigFigsTrimmed(Number(formatEther(targetWei)));
  const pct = (Number(clampedBps) / 100).toFixed(0);
  return `${raised} / ${target} ETH · ${pct}%`;
}

/** Formats the header band's "x ETH remaining" line (issue #443 part 1, precision fixed in issue #447 item 4) using the same shared six-significant-figure helper as formatGraduationSummary. */
export function formatGraduationRemainingLabel(remainingWei: bigint): string {
  return `${formatNativeAmountSixSigFigsTrimmed(Number(formatEther(remainingWei)))} ETH remaining`;
}

/**
 * Plain-English note for the swap panel describing a curve's one-off
 * graduation fee, built from that curve's own on-chain `GRADUATION_FEE_BPS()`
 * (never a hard-coded percentage). Returns `null` for `0n` — a curve deployed
 * before the fee existed charges nothing, and the panel then renders no note
 * at all rather than describing a fee it does not take.
 */
export function formatGraduationFeeNote(graduationFeeBps: bigint, graduated: boolean): string | null {
  if (graduationFeeBps <= 0n) return null;
  const feePercent = Number(graduationFeeBps) / 100;
  const poolPercent = Number(10_000n - graduationFeeBps) / 100;
  return graduated
    ? `${feePercent}% graduation fee went to the treasury · ${poolPercent}% of raised ETH is locked in the pool`
    : `${feePercent}% graduation fee to treasury at graduation · ${poolPercent}% of raised ETH locks into the pool`;
}
