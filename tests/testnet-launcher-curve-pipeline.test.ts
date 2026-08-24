import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string) {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("/testnet curve launch pipeline wiring (Milestone A, issue #409 Part 1)", () => {
  it("prefers the curve-backed launch path when a pipeline is configured for the connected chain", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    expect(launcher).toContain(
      'import {\n  getCurveLaunchPipelineAddress,\n  HOODLUMS_BONDING_CURVE_FUND_ABI,\n  HOODLUMS_CURVE_LAUNCH_PIPELINE_ABI,\n  resolveCurveLaunchParams,\n} from "@/lib/curve-launch-pipeline-config";',
    );
    expect(launcher).toContain("getCurveLaunchPipelineAddress(robinhoodTestnet.id)");
    expect(launcher).toContain("deployRobinhoodTokenWithCurve(walletClient, publicClient, account, pipelineAddress)");
  });

  it("chains exactly three writeContract calls — launch, approve, fundCurve — reusing the unmodified curve/token contracts", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    const launchIndex = launcher.indexOf('functionName: "launchTokenWithCurve"');
    const approveIndex = launcher.indexOf('functionName: "approve"');
    const fundIndex = launcher.indexOf('functionName: "fundCurve"');
    expect(launchIndex).toBeGreaterThan(-1);
    expect(approveIndex).toBeGreaterThan(launchIndex);
    expect(fundIndex).toBeGreaterThan(approveIndex);
    expect(launcher).toContain("Step 1 of 3");
    expect(launcher).toContain("Step 2 of 3");
    expect(launcher).toContain("Step 3 of 3");
  });

  it("falls back to the existing factory/direct-deploy path when no pipeline is configured", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    expect(launcher).toContain("const factoryAddress = getFactoryAddress(robinhoodTestnet.id);");
    expect(launcher).toContain("walletClient.deployContract({");
  });

  it("records the launch server-side for the future homepage grid without failing the on-chain success", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    expect(launcher).toContain('fetch("/api/token-launches/challenge"');
    expect(launcher).toContain('fetch("/api/token-launches"');
    expect(launcher).toContain("recordWarning");
  });

  it("resolves curve deploy parameters from the shared config rather than inlining any value", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    expect(launcher).toContain("resolveCurveLaunchParams(decimals)");
  });
});

describe("/testnet wallet-mismatch guard (Milestone A, issue #409 Part 4)", () => {
  it("reuses the describeWalletMismatch pattern and the Account panel's confirmed-wallet storage", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    expect(launcher).toContain('import {\n  ACCOUNT_WALLET_STORAGE_KEY,\n  parseStoredAccountWallet,\n} from "@/lib/account-wallet-state";');
    expect(launcher).toContain('import { describeWalletMismatch } from "@/lib/social-studio-queue";');
    expect(launcher).toContain("window.localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY)");
    expect(launcher).toContain("describeWalletMismatch(activeAccount, confirmedAccount)");
  });

  it("checks for a mismatch before requesting the launch signature", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    const guardIndex = launcher.indexOf("checkWalletMismatch(wallet)");
    const deployIndex = launcher.indexOf("await deployRobinhoodToken()");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(deployIndex).toBeGreaterThan(guardIndex);
  });

  it("offers explicit switch-wallet and continue-anyway choices naming both addresses", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    expect(launcher).toContain("Switch wallet");
    expect(launcher).toContain("Continue anyway");
    expect(launcher).toContain("continueWithMismatchedWallet");
  });

  it("mirrors the 390px mobile breakpoint already used elsewhere on this page (rule 7)", async () => {
    const css = await source("components/testnet-launcher.module.css");
    expect(css).toContain("@media (max-width: 500px)");
    expect(css).toContain(".mismatchActions { grid-template-columns: 1fr; }");
  });
});
