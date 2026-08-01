import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string) {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("bonding curve graduation status UI", () => {
  it("is wired into the bonding-curve page in both the desktop and legacy layouts", async () => {
    const page = await source("app/(app)/bonding-curve/page.tsx");
    expect(page).toContain('import { BondingCurveGraduationStatus } from "@/components/bonding-curve-graduation-status"');

    const occurrences = page.split("<BondingCurveGraduationStatus").length - 1;
    expect(occurrences).toBe(2);
  });

  it("reads the curve address the same way the factory address is read", async () => {
    const component = await source("components/bonding-curve-graduation-status.tsx");
    expect(component).toContain('import { getBondingCurveAddress, HOODLUMS_BONDING_CURVE_READ_ABI } from "@/lib/bonding-curve-config"');
    expect(component).toContain("getBondingCurveAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL)");
  });

  it("handles the not-yet-configured curve without crashing or going blank", async () => {
    const component = await source("components/bonding-curve-graduation-status.tsx");
    expect(component).toContain("if (!address)");
    expect(component).toContain("No bonding curve is configured");
  });

  it("handles an RPC/contract read failure without crashing or going blank", async () => {
    const component = await source("components/bonding-curve-graduation-status.tsx");
    expect(component).toContain('view.kind === "error"');
    expect(component).toContain("catch (error)");
    expect(component).toContain("Retry");
  });

  it("renders the not-funded (bonding not yet open) state", async () => {
    const component = await source("components/bonding-curve-graduation-status.tsx");
    expect(component).toContain('status.state === "not-funded"');
    expect(component).toContain("NOT YET FUNDED");
    expect(component).toContain("Trading isn");
  });

  it("renders the bonding state with a progress bar driven by the shared progress formatter", async () => {
    const component = await source("components/bonding-curve-graduation-status.tsx");
    expect(component).toContain("BONDING</span>");
    expect(component).toContain("formatGraduationProgressPercent(status.progressBps)");
    expect(component).toContain("Number(status.progressBps) / 100");
    expect(component).toContain("formatEther(status.raisedWei)");
    expect(component).toContain("formatEther(status.targetWei)");
  });

  it("renders the graduated state with the locked pool address, an explorer link, and a locked-liquidity note", async () => {
    const component = await source("components/bonding-curve-graduation-status.tsx");
    expect(component).toContain('status.state === "graduated"');
    expect(component).toContain("GRADUATED</span>");
    expect(component).toContain("permanently locked");
    expect(component).toContain("CHAIN_CONFIG.robinhood.explorerBaseUrl");
    expect(component).toContain("status.liquidityPool");
  });

  it("computes progress and pool visibility from the shared pure status module, not ad-hoc math", async () => {
    const component = await source("components/bonding-curve-graduation-status.tsx");
    expect(component).toContain('import {\n  computeBondingCurveGraduationStatus,');
    expect(component).toContain("computeBondingCurveGraduationStatus({");
  });
});
