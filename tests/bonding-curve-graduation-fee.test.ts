import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOODLUMS_BONDING_CURVE_GRADUATION_FEE_ABI, HOODLUMS_BONDING_CURVE_HEADER_ABI } from "@/lib/bonding-curve-config";
import { formatGraduationFeeNote } from "@/lib/bonding-curve-status";

// Owner decision (4 Sep 2026): a one-off 5% graduation fee on the raised
// native reserve, 100% to the treasury. The Solidity behaviour itself is
// covered by contracts/HoodlumsTestBondingCurve.t.sol; this file pins the
// contract's economics-bearing source, the TypeScript mirror/ABI, and the
// UI's rule that it only ever describes a fee the specific curve charges.

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

type AbiItemShape = { type: string; name?: string; stateMutability?: string };

describe("HoodlumsTestBondingCurve graduation fee (contract source)", () => {
  it("defines GRADUATION_FEE_BPS = 500 (5%) and charges it floor-rounded", async () => {
    const contract = await source("contracts/HoodlumsTestBondingCurve.sol");
    expect(contract).toContain("uint256 public constant GRADUATION_FEE_BPS = 500;");
    expect(contract).toContain("return Math.mulDiv(reserve, GRADUATION_FEE_BPS, BPS);");
    // Deliberately NOT ceil-rounded like _tradingFee.
    expect(contract).not.toContain("GRADUATION_FEE_BPS, BPS, Math.Rounding.Ceil");
  });

  it("credits the whole fee to the treasury balance before any external call, never to the creator or the 60/40 carry", async () => {
    const contract = await source("contracts/HoodlumsTestBondingCurve.sol");
    const graduate = contract.slice(contract.indexOf("function _graduate() internal {"), contract.indexOf("function _chargeGraduationFee()"));
    const charge = contract.slice(contract.indexOf("function _chargeGraduationFee()"), contract.indexOf("function _orderGraduationTokens"));
    // The fee lives in its own function so _graduate() keeps the local count
    // that compiles — CI's solc rejected the inline version with "Stack too deep".
    expect(graduate).toContain("uint256 nativeLiquidity = _chargeGraduationFee();");
    expect(graduate).not.toContain("uint256 reserve = realNativeReserve;");
    expect(charge).toContain("uint256 graduationFee = _graduationFee(reserve);");
    expect(charge).toContain("nativeLiquidity = reserve - graduationFee;");
    expect(charge).toContain("realNativeReserve = 0;");
    expect(charge).toContain("treasuryFeeBalance += graduationFee;");
    expect(charge).toContain("totalFeesAccrued += graduationFee;");
    expect(charge).toContain("emit GraduationFeeCharged(graduationFee);");
    expect(charge).not.toContain("creatorFeeBalance");
    expect(charge).not.toContain("_accrueFee(");
    expect(charge).not.toContain(".call");
    expect(charge).not.toContain("weth9.");
    // Effects before interactions: the charge precedes the WETH wrap.
    expect(graduate.indexOf("_chargeGraduationFee();")).toBeLessThan(graduate.indexOf("weth9.deposit{value: nativeLiquidity}();"));
    // The pool is seeded with the post-fee amount, not the reserve.
    expect(graduate).toContain("emit Graduated(pool, tokenId, tokenLiquidity, nativeLiquidity);");
  });

  it("exposes graduationFeeAtTarget() and measures minimumCurveFunding()'s pool floor against the post-fee native", async () => {
    const contract = await source("contracts/HoodlumsTestBondingCurve.sol");
    expect(contract).toContain("function graduationFeeAtTarget() external view returns (uint256) {");
    expect(contract).toContain("uint256 nativeIntoPool = graduationTarget - _graduationFee(graduationTarget);");
    expect(contract).toContain("uint256 minimumPoolTokens = (POOL_MINIMUM_LIQUIDITY_SQUARED / nativeIntoPool) + 1;");
    expect(contract).toContain("event GraduationFeeCharged(uint256 amount);");
  });

  it("leaves the buy clamp, target and progress maths untouched by the fee", async () => {
    const contract = await source("contracts/HoodlumsTestBondingCurve.sol");
    expect(contract).toContain("uint256 remainingToGraduate = graduationTarget - realNativeReserve;");
    expect(contract).toContain("if (realNativeReserve == graduationTarget) {");
    expect(contract).toContain("return Math.mulDiv(realNativeReserve, BPS, graduationTarget);");
  });

  it("is covered by the Hardhat suite: exact 5%, treasury-only, withdrawal, 4 ETH figures, clamp, funding floor", async () => {
    const tests = await source("contracts/HoodlumsTestBondingCurve.t.sol");
    for (const name of [
      "testGraduationChargesExactFivePercentOfReserveToTreasuryOnly",
      "testGraduationFeeIsWithdrawableByTreasuryOnlyAfterGraduation",
      "testGraduationFeeAtFourEtherTargetIsExactlyPointTwoEther",
      "testGraduationFeeDoesNotChangeTheTargetOrTheBuyClamp",
      "testMinimumCurveFundingMeasuresPoolFloorAgainstPostGraduationFeeNative",
    ]) {
      expect(tests).toContain(`function ${name}() public {`);
    }
    // The pool-amount assertions and the prediction helper now use the post-fee amount.
    expect(tests).toContain("wethAmount == target - _expectedGraduationFee(target)");
    expect(tests).toContain("uint256 nativeLiquidity = target - _expectedGraduationFee(target);");
    expect(tests).not.toContain('require(wethAmount == target, "fees leaked into pool liquidity");');
  });
});

describe("graduation fee ABI", () => {
  it("is its own single view-function ABI, so the header ABI's pinned list is unchanged and a pre-fee curve's revert can be isolated", () => {
    const items = HOODLUMS_BONDING_CURVE_GRADUATION_FEE_ABI as unknown as readonly AbiItemShape[];
    expect(items.filter((item) => item.type === "function").map((item) => item.name)).toEqual(["GRADUATION_FEE_BPS"]);
    expect(items.every((item) => item.type !== "function" || item.stateMutability === "view")).toBe(true);
    const headerNames = (HOODLUMS_BONDING_CURVE_HEADER_ABI as unknown as readonly AbiItemShape[]).map((item) => item.name);
    expect(headerNames).not.toContain("GRADUATION_FEE_BPS");
  });
});

describe("useTokenCurveStatus reads each curve's own graduation fee, treating a revert as no fee", () => {
  it("reads GRADUATION_FEE_BPS through the dedicated ABI with a catch to 0n, carries it on the ready status, and compares it in statusesEqual", async () => {
    const hook = await source("lib/use-token-curve-status.ts");
    expect(hook).toContain("HOODLUMS_BONDING_CURVE_GRADUATION_FEE_ABI");
    expect(hook).toContain('functionName: "GRADUATION_FEE_BPS" })');
    expect(hook).toContain(".catch(() => 0n)");
    expect(hook).toContain("graduationFeeBps: bigint;");
    expect(hook).toContain("a.graduationFeeBps === b.graduationFeeBps &&");
    expect(hook).toContain("graduationFeeBps,\n        };");
  });
});

describe("formatGraduationFeeNote", () => {
  it("returns null for a curve that charges no graduation fee, so nothing is rendered", () => {
    expect(formatGraduationFeeNote(0n, false)).toBeNull();
    expect(formatGraduationFeeNote(0n, true)).toBeNull();
  });

  it("describes the live 5% / 95% split in both phases from the on-chain bps", () => {
    expect(formatGraduationFeeNote(500n, false)).toBe(
      "5% graduation fee to treasury at graduation · 95% of raised ETH locks into the pool",
    );
    expect(formatGraduationFeeNote(500n, true)).toBe(
      "5% graduation fee went to the treasury · 95% of raised ETH is locked in the pool",
    );
  });

  it("never hard-codes 5% — a different on-chain value formats accordingly", () => {
    expect(formatGraduationFeeNote(250n, false)).toContain("2.5% graduation fee");
    expect(formatGraduationFeeNote(250n, false)).toContain("97.5% of raised ETH");
  });
});

describe("swap panel graduation-fee note (components/token-page/token-left-column.tsx)", () => {
  it("derives one note from the curve's own bps and renders it under the fee line in both the bonding and trading-closed panels", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('import { formatGraduationFeeNote, type BondingCurveGraduationStatus } from "@/lib/bonding-curve-status";');
    expect(component).toContain("graduationFeeBps: bigint;");
    expect(component).toContain("graduationFeeBps: curveStatus.graduationFeeBps,");
    expect(component).toContain(
      'formatGraduationFeeNote(curveView.graduationFeeBps, curveView.graduation.state === "graduated")',
    );
    expect(component.split("{graduationFeeNote && <p className={styles.feeNote}>{graduationFeeNote}</p>}").length - 1).toBe(2);
    // The existing trading-fee notes are unchanged.
    expect(component).toContain("formatFeeNote(TRADING_FEE_BPS, PROTOCOL_FEE_SHARE_BPS, CREATOR_FEE_SHARE_BPS, false)");
    expect(component).toContain("formatFeeNote(TRADING_FEE_BPS, PROTOCOL_FEE_SHARE_BPS, CREATOR_FEE_SHARE_BPS, true)");
  });

  it("no longer claims the full curve balance moved to the pool, and only mentions the fee when the curve charges one", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).not.toContain("its full curve balance moved into");
    expect(component).toContain('{curveView.graduationFeeBps > 0n ? ", less the graduation fee," : ""}');
    expect(component).toContain("Trading closed");
    expect(component).toContain("View liquidity pool");
  });
});

describe("documentation of the graduation fee", () => {
  it("is described on /bonding-curve and in README with the same 5% / 100% treasury figures", async () => {
    const page = await source("app/(app)/bonding-curve/page.tsx");
    expect(page).toContain("<span>Graduation fee</span>");
    expect(page).toContain("<strong>5% of raised ETH · 100% treasury</strong>");
    expect(page).toContain("<div><dt>Graduation fee</dt><dd>5% to treasury</dd></div>");
    expect(page).toContain("Remaining tokens + 95% of raised test ETH seed a locked pool");
    const readme = await source("README.md");
    expect(readme).toContain("`GRADUATION_FEE_BPS = 500`");
    expect(readme).toContain("100% to the treasury's claimable balance");
  });
});
