import { describe, expect, it } from "vitest";
import {
  GRADUATION_PROGRESS_BPS_MAX,
  ZERO_ADDRESS,
  computeBondingCurveGraduationStatus,
  formatGraduationProgressPercent,
  type BondingCurveOnChainState,
} from "../lib/bonding-curve-status";

const TARGET = 4_000_000_000_000_000_000n; // 4 ether, matches DEFAULT_GRADUATION_TARGET_ETHER
const POOL_ADDRESS = "0x1234567890123456789012345678901234567890" as const;

function state(overrides: Partial<BondingCurveOnChainState>): BondingCurveOnChainState {
  return {
    funded: false,
    graduated: false,
    realNativeReserveWei: 0n,
    graduationTargetWei: TARGET,
    liquidityPool: ZERO_ADDRESS,
    ...overrides,
  };
}

describe("computeBondingCurveGraduationStatus", () => {
  describe("not-funded state", () => {
    it("reports zero progress before the creator funds the curve", () => {
      const status = computeBondingCurveGraduationStatus(state({ funded: false }));
      expect(status).toEqual({
        state: "not-funded",
        progressBps: 0n,
        raisedWei: 0n,
        targetWei: TARGET,
        liquidityPool: null,
      });
    });

    it("stays not-funded even if a stray non-zero reserve were ever read (defensive)", () => {
      const status = computeBondingCurveGraduationStatus(
        state({ funded: false, realNativeReserveWei: 1n }),
      );
      expect(status.state).toBe("not-funded");
      expect(status.raisedWei).toBe(0n);
      expect(status.progressBps).toBe(0n);
    });
  });

  describe("bonding state", () => {
    it("computes progress proportionally to the target, excluding fees", () => {
      const status = computeBondingCurveGraduationStatus(
        state({ funded: true, realNativeReserveWei: TARGET / 2n }),
      );
      expect(status.state).toBe("bonding");
      expect(status.progressBps).toBe(5_000n);
      expect(status.raisedWei).toBe(TARGET / 2n);
      expect(status.targetWei).toBe(TARGET);
      expect(status.liquidityPool).toBeNull();
    });

    it("reports zero progress right after funding with nothing raised yet", () => {
      const status = computeBondingCurveGraduationStatus(state({ funded: true, realNativeReserveWei: 0n }));
      expect(status.state).toBe("bonding");
      expect(status.progressBps).toBe(0n);
    });

    it("caps progress at 100% (BPS max) if reserve reads exactly at target but graduated hasn't flipped yet", () => {
      const status = computeBondingCurveGraduationStatus(
        state({ funded: true, realNativeReserveWei: TARGET }),
      );
      expect(status.state).toBe("bonding");
      expect(status.progressBps).toBe(GRADUATION_PROGRESS_BPS_MAX);
    });

    it("never exceeds 100% even for an unexpected over-target reserve read", () => {
      const status = computeBondingCurveGraduationStatus(
        state({ funded: true, realNativeReserveWei: TARGET * 2n }),
      );
      expect(status.progressBps).toBe(GRADUATION_PROGRESS_BPS_MAX);
    });

    it("floors fractional basis points the same way the contract's mulDiv does", () => {
      const status = computeBondingCurveGraduationStatus(
        state({ funded: true, graduationTargetWei: 3n, realNativeReserveWei: 1n }),
      );
      // 1 * 10000 / 3 = 3333.33... -> floors to 3333
      expect(status.progressBps).toBe(3_333n);
    });
  });

  describe("graduated state", () => {
    it("reports 100% progress and the locked pool address, ignoring the zeroed-out reserve", () => {
      const status = computeBondingCurveGraduationStatus(
        state({ funded: true, graduated: true, realNativeReserveWei: 0n, liquidityPool: POOL_ADDRESS }),
      );
      expect(status).toEqual({
        state: "graduated",
        progressBps: GRADUATION_PROGRESS_BPS_MAX,
        raisedWei: TARGET,
        targetWei: TARGET,
        liquidityPool: POOL_ADDRESS,
      });
    });

    it("treats a zero-address pool read as no pool rather than surfacing a dead link", () => {
      const status = computeBondingCurveGraduationStatus(
        state({ funded: true, graduated: true, liquidityPool: ZERO_ADDRESS }),
      );
      expect(status.state).toBe("graduated");
      expect(status.liquidityPool).toBeNull();
    });

    it("takes priority over funded when both graduated and funded are true", () => {
      const status = computeBondingCurveGraduationStatus(
        state({ funded: true, graduated: true, liquidityPool: POOL_ADDRESS }),
      );
      expect(status.state).toBe("graduated");
    });
  });
});

describe("formatGraduationProgressPercent", () => {
  it("formats whole and fractional basis points to one decimal place", () => {
    expect(formatGraduationProgressPercent(0n)).toBe("0.0%");
    expect(formatGraduationProgressPercent(5_000n)).toBe("50.0%");
    expect(formatGraduationProgressPercent(3_333n)).toBe("33.3%");
    expect(formatGraduationProgressPercent(GRADUATION_PROGRESS_BPS_MAX)).toBe("100.0%");
  });

  it("clamps out-of-range values instead of printing an absurd percentage", () => {
    expect(formatGraduationProgressPercent(-1n)).toBe("0.0%");
    expect(formatGraduationProgressPercent(GRADUATION_PROGRESS_BPS_MAX + 1n)).toBe("100.0%");
  });
});
