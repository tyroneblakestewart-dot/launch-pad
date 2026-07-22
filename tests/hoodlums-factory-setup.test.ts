import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS,
  APPROVED_FACTORY_OWNER_ADDRESS,
} from "@/lib/hoodlums-token-factory-deployment";
import {
  HOODLUMS_TOKEN_FACTORY_ABI,
  HOODLUMS_TOKEN_FACTORY_ARTIFACT_READY,
  HOODLUMS_TOKEN_FACTORY_BYTECODE,
} from "@/lib/hoodlums-token-factory-artifact";

const ROOT = process.cwd();

async function readSource(relativePath: string): Promise<string> {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

describe("HoodlumsTokenFactory artifact", () => {
  it("keeps the approved owner and treasury addresses exactly as specified by the owner", () => {
    expect(APPROVED_FACTORY_OWNER_ADDRESS).toBe("0x505217CBbe3059993877983b4fDAD5C6e32AF1F5");
    expect(APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS).toBe("0xCF6F11C6dc4FFa50bF820030FC9164675704984a");
  });

  it("only exposes the constructor and the read functions the setup panel needs", () => {
    const functionNames = HOODLUMS_TOKEN_FACTORY_ABI.filter(
      (item) => item.type === "function",
    ).map((item) => (item as { name: string }).name);

    expect(functionNames.sort()).toEqual(["feeRecipient", "launchCount", "launchFee", "owner"]);
    // launchToken must stay out of this artifact until a follow-up change
    // deliberately routes public launches through the factory.
    expect(functionNames).not.toContain("launchToken");
  });

  it("derives readiness from whether real bytecode has been generated", () => {
    expect(HOODLUMS_TOKEN_FACTORY_ARTIFACT_READY).toBe(HOODLUMS_TOKEN_FACTORY_BYTECODE.length > 2);
  });
});

describe("factory setup route", () => {
  it("renders the HoodlumsFactorySetup component from a dedicated testnet-only route", async () => {
    const page = await readSource("app/factory-setup/page.tsx");
    expect(page).toContain("HoodlumsFactorySetup");
  });

  it("never accepts a private key or seed phrase field", async () => {
    const component = await readSource("components/hoodlums-factory-setup.tsx");
    expect(component).not.toMatch(/private.?key/i);
    expect(component).not.toMatch(/seed.?phrase/i);
    expect(component).not.toMatch(/mnemonic/i);
  });

  it("does not call launchToken, so public launches are not routed through the factory yet", async () => {
    const component = await readSource("components/hoodlums-factory-setup.tsx");
    expect(component).not.toContain("launchToken");
  });

  it("gates the deploy action on chain, owner and artifact-readiness guards from the shared module", async () => {
    const component = await readSource("components/hoodlums-factory-setup.tsx");
    expect(component).toContain("isApprovedFactoryChain");
    expect(component).toContain("isApprovedFactoryOwner");
    expect(component).toContain("HOODLUMS_TOKEN_FACTORY_ARTIFACT_READY");
    expect(component).toContain("buildFactoryConstructorArgs");
    expect(component).toContain("verifyDeployedFactory");
  });

  it("re-verifies the chain and owner immediately before signing, not just from stale UI state", async () => {
    const component = await readSource("components/hoodlums-factory-setup.tsx");
    const deployFunction = component.slice(component.indexOf("async function deploy()"));
    expect(deployFunction).toContain("isApprovedFactoryChain(liveChainId)");
    expect(deployFunction).toContain("isApprovedFactoryOwner(liveAccount)");
  });

  it("shows the transaction hash, factory address and explorer links after deployment", async () => {
    const component = await readSource("components/hoodlums-factory-setup.tsx");
    expect(component).toContain("deployment.transactionHash");
    expect(component).toContain("deployment.factoryAddress");
    expect(component).toContain("FACTORY_DEPLOYMENT_EXPLORER_BASE_URL");
  });

  it("offers a copyable and downloadable deployment record and documents the next manual gate", async () => {
    const component = await readSource("components/hoodlums-factory-setup.tsx");
    expect(component).toContain("copyRecord");
    expect(component).toContain("downloadRecord");
    expect(component).toContain("nextManualGate");
  });
});
