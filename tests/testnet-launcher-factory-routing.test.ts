import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TARGET = path.join(ROOT, "components", "testnet-launcher.tsx");

function extractFunctionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `expected to find "${signature}" in testnet-launcher.tsx`).toBeGreaterThan(-1);

  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i);
    }
  }
  throw new Error(`unbalanced braces reading "${signature}"`);
}

describe("/testnet Robinhood deploy routing", () => {
  it("imports getFactoryAddress and the shared launchTokenViaFactory helper", async () => {
    const source = await readFile(TARGET, "utf8");
    expect(source).toContain('import { getFactoryAddress } from "@/lib/factory-config";');
    expect(source).toContain('import { launchTokenViaFactory } from "@/lib/factory-launch";');
  });

  it("routes deployRobinhoodToken() through the factory when one is configured, and keeps the direct-deploy fallback", async () => {
    const source = await readFile(TARGET, "utf8");
    const body = extractFunctionBody(source, "async function deployRobinhoodToken(): Promise<LaunchResult> {");

    // Path selection reads the configured factory address for the connected chain.
    expect(body).toContain("getFactoryAddress(robinhoodTestnet.id)");

    const factoryBranchIndex = body.indexOf("if (factoryAddress) {");
    expect(factoryBranchIndex).toBeGreaterThan(-1);

    const launchCallIndex = body.indexOf("launchTokenViaFactory(");
    expect(launchCallIndex).toBeGreaterThan(factoryBranchIndex);

    // The factory branch must return its own result rather than falling
    // through into the direct-deploy path below it.
    const returnAfterLaunchIndex = body.indexOf("return {", launchCallIndex);
    expect(returnAfterLaunchIndex).toBeGreaterThan(launchCallIndex);

    // The original direct FixedSupplyMemeToken deploy remains, after the
    // factory branch, as the fallback for chains with no configured factory.
    const fallbackDeployIndex = body.indexOf("walletClient.deployContract({");
    expect(fallbackDeployIndex).toBeGreaterThan(returnAfterLaunchIndex);
    const fallbackBody = body.slice(fallbackDeployIndex);
    expect(fallbackBody).toContain("FIXED_SUPPLY_TOKEN_ABI");
    expect(fallbackBody).toContain("FIXED_SUPPLY_TOKEN_BYTECODE");
  });

  it("passes the exact recipient/name/symbol/supply/decimals through to the factory helper", async () => {
    const source = await readFile(TARGET, "utf8");
    const body = extractFunctionBody(source, "async function deployRobinhoodToken(): Promise<LaunchResult> {");
    const factoryCallStart = body.indexOf("launchTokenViaFactory(");
    const factoryCallArgs = body.slice(factoryCallStart, body.indexOf("setStatus", factoryCallStart));

    expect(factoryCallArgs).toContain("name: name.trim()");
    expect(factoryCallArgs).toContain("symbol: symbol.trim().toUpperCase()");
    expect(factoryCallArgs).toContain("wholeTokenSupply: BigInt(supply)");
    expect(factoryCallArgs).toContain("decimals,");
    expect(factoryCallArgs).toContain("recipient: account as Address");
  });
});
