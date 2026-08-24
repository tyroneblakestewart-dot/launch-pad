import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string) {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("studio launch modal curve pipeline wiring (issue #412 Part 1)", () => {
  it("prefers the curve-backed launch path when a pipeline is configured for Robinhood Chain Testnet", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    expect(controller).toContain(
      'import {\n  getCurveLaunchPipelineAddress,\n  HOODLUMS_BONDING_CURVE_FUND_ABI,\n  HOODLUMS_CURVE_LAUNCH_PIPELINE_ABI,\n  resolveCurveLaunchParams,\n} from "@/lib/curve-launch-pipeline-config";',
    );
    expect(controller).toContain("getCurveLaunchPipelineAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL)");
    expect(controller).toContain("deployWithCurvePipeline(walletClient, publicClient, account, pipelineAddress, project)");
  });

  it("chains exactly three writeContract calls — launch, approve, fundCurve — reusing the unmodified curve/token contracts", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    const launchIndex = controller.indexOf('functionName: "launchTokenWithCurve"');
    const approveIndex = controller.indexOf('functionName: "approve"');
    const fundIndex = controller.indexOf('functionName: "fundCurve"');
    expect(launchIndex).toBeGreaterThan(-1);
    expect(approveIndex).toBeGreaterThan(launchIndex);
    expect(fundIndex).toBeGreaterThan(approveIndex);
    expect(controller).toContain("Step 1 of 3");
    expect(controller).toContain("Step 2 of 3");
    expect(controller).toContain("Step 3 of 3");
  });

  it("falls back to the existing plain FixedSupplyMemeToken deploy when no pipeline is configured", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    expect(controller).toContain("walletClient.deployContract({");
    expect(controller).toContain("FIXED_SUPPLY_TOKEN_ABI");
  });

  it("records the launch server-side for the homepage grid without failing the on-chain success", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    expect(controller).toContain('fetch("/api/token-launches/challenge"');
    expect(controller).toContain('fetch("/api/token-launches"');
    expect(controller).toContain("recordWarning");
  });

  it("resolves curve deploy parameters from the shared config rather than inlining any value", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    expect(controller).toContain("resolveCurveLaunchParams(currentProject.decimals)");
  });

  it("notifies the homepage grid to refetch immediately after a successful recording", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    expect(controller).toContain('import { notifyTokenLaunchCompleted } from "@/lib/token-launch-events";');
    expect(controller).toContain("notifyTokenLaunchCompleted({ tokenAddress: launch.tokenAddress, chainId: walletChainId });");
  });

  it("still applies the wallet-mismatch guard before requesting the curve-backed launch signature", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    const guardIndex = controller.indexOf("checkWalletMismatch(account)");
    const pipelineIndex = controller.indexOf("getCurveLaunchPipelineAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL)");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(pipelineIndex).toBeGreaterThan(guardIndex);
  });
});

describe("testnet /testnet launch modal also notifies the grid (issue #412 Part 1)", () => {
  it("dispatches TOKEN_LAUNCH_COMPLETED_EVENT after recording a launch", async () => {
    const launcher = await source("components/testnet-launcher.tsx");
    expect(launcher).toContain('import { notifyTokenLaunchCompleted } from "@/lib/token-launch-events";');
    expect(launcher).toContain("notifyTokenLaunchCompleted({ tokenAddress: launch.tokenAddress, chainId: walletChainId });");
  });
});
