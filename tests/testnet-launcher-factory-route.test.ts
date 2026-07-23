import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string) {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("/testnet route factory routing", () => {
  it("wires components/testnet-launcher.tsx (the page actually rendered by app/testnet/page.tsx) through the factory", async () => {
    const page = await source("app/testnet/page.tsx");
    expect(page).toContain("TestnetLauncher");

    const launcher = await source("components/testnet-launcher.tsx");

    // Retains the existing wallet + chain-switch guard behaviour untouched.
    expect(launcher).toContain('import { getInjectedEvmProvider } from "@/lib/wallet-provider";');
    expect(launcher).toContain("getInjectedEvmProvider()");
    expect(launcher).toContain('method: "wallet_switchEthereumChain"');
    expect(launcher).toContain('chainId: "0xb626"');

    // Reads the configured factory for the connected chain.
    expect(launcher).toContain(
      'import { getFactoryAddress, HOODLUMS_TOKEN_FACTORY_ABI } from "@/lib/factory-config";',
    );
    expect(launcher).toContain("getFactoryAddress(robinhoodTestnet.id)");

    // Reads launchFee() immediately before sending and pays it exactly.
    const launchFeeIndex = launcher.indexOf('functionName: "launchFee"');
    const launchTokenIndex = launcher.indexOf('functionName: "launchToken"');
    expect(launchFeeIndex).toBeGreaterThan(-1);
    expect(launchTokenIndex).toBeGreaterThan(launchFeeIndex);
    expect(launcher).toContain("value: launchFee");

    // Resolves the created token address from the TokenLaunched event.
    expect(launcher).toContain(
      'import { extractLaunchedTokenAddress } from "@/lib/factory-launch";',
    );
    expect(launcher).toContain("extractLaunchedTokenAddress(receipt.logs)");

    // Falls back to the existing direct FixedSupplyMemeToken deployment when
    // no factory address is configured for the connected chain.
    expect(launcher).toContain("walletClient.deployContract({");
    expect(launcher).toContain("FIXED_SUPPLY_TOKEN_ABI");
    expect(launcher).toContain("FIXED_SUPPLY_TOKEN_BYTECODE");

    // Keeps the existing LaunchResult / result UI / explorer link.
    expect(launcher).toContain("type LaunchResult");
    expect(launcher).toContain("explorer.testnet.chain.robinhood.com/address/");
    expect(launcher).toContain("Open in testnet explorer");
  });

  it("does not route the studio's separate deployment controller through this change", async () => {
    const controller = await source(
      "components/robinhood-testnet-deployment-controller.tsx",
    );
    expect(controller).not.toContain("factory-config");
    expect(controller).not.toContain("factory-launch");
  });
});
