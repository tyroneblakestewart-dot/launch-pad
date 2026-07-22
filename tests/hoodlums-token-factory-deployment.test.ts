import { describe, expect, it } from "vitest";
import {
  APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS,
  APPROVED_FACTORY_OWNER_ADDRESS,
  buildFactoryConstructorArgs,
  buildFactoryDeploymentRecord,
  isApprovedFactoryChain,
  isApprovedFactoryOwner,
  parseFactoryDeploymentResult,
  verifyDeployedFactory,
} from "@/lib/hoodlums-token-factory-deployment";

describe("isApprovedFactoryChain", () => {
  it("accepts Robinhood Chain Testnet in hex or decimal form, case-insensitively", () => {
    expect(isApprovedFactoryChain("0xb626")).toBe(true);
    expect(isApprovedFactoryChain("0xB626")).toBe(true);
    expect(isApprovedFactoryChain("46630")).toBe(true);
  });

  it("rejects every other chain id, including Monad testnet and mainnet-shaped ids", () => {
    expect(isApprovedFactoryChain("0x279f")).toBe(false);
    expect(isApprovedFactoryChain("1")).toBe(false);
    expect(isApprovedFactoryChain("")).toBe(false);
    expect(isApprovedFactoryChain(null)).toBe(false);
    expect(isApprovedFactoryChain(undefined)).toBe(false);
  });
});

describe("isApprovedFactoryOwner", () => {
  it("matches only the exact approved owner address, case-insensitively", () => {
    expect(isApprovedFactoryOwner(APPROVED_FACTORY_OWNER_ADDRESS)).toBe(true);
    expect(isApprovedFactoryOwner(APPROVED_FACTORY_OWNER_ADDRESS.toLowerCase())).toBe(true);
    expect(isApprovedFactoryOwner(APPROVED_FACTORY_OWNER_ADDRESS.toUpperCase())).toBe(true);
  });

  it("rejects the fee recipient address, other addresses, and empty input", () => {
    expect(isApprovedFactoryOwner(APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS)).toBe(false);
    expect(isApprovedFactoryOwner("0x0000000000000000000000000000000000dEaD")).toBe(false);
    expect(isApprovedFactoryOwner("")).toBe(false);
    expect(isApprovedFactoryOwner(null)).toBe(false);
    expect(isApprovedFactoryOwner(undefined)).toBe(false);
  });
});

describe("buildFactoryConstructorArgs", () => {
  it("returns owner, treasury and zero fee in the exact required order", () => {
    expect(buildFactoryConstructorArgs()).toEqual([
      APPROVED_FACTORY_OWNER_ADDRESS,
      APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS,
      0n,
    ]);
  });
});

describe("parseFactoryDeploymentResult", () => {
  const TX_HASH = "0xaaaa000000000000000000000000000000000000000000000000000000000000";
  const FACTORY_ADDRESS = "0x1111111111111111111111111111111111111a";

  it("extracts the factory address and transaction hash from a valid receipt", () => {
    const parsed = parseFactoryDeploymentResult({ contractAddress: FACTORY_ADDRESS }, TX_HASH);
    expect(parsed).toEqual({ factoryAddress: FACTORY_ADDRESS, transactionHash: TX_HASH });
  });

  it("throws when the receipt has no contract address", () => {
    expect(() => parseFactoryDeploymentResult({ contractAddress: null }, TX_HASH)).toThrow(
      /contract address/i,
    );
  });

  it("throws when no transaction hash was returned", () => {
    expect(() => parseFactoryDeploymentResult({ contractAddress: FACTORY_ADDRESS }, "")).toThrow(
      /transaction hash/i,
    );
  });
});

describe("verifyDeployedFactory", () => {
  const goodValues = {
    owner: APPROVED_FACTORY_OWNER_ADDRESS,
    feeRecipient: APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS,
    launchFee: 0n,
    launchCount: 0n,
  };

  it("passes every check when the deployed factory matches the approved config exactly", () => {
    const result = verifyDeployedFactory(goodValues);
    expect(result.allPassed).toBe(true);
    expect(result.checks).toHaveLength(4);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it("fails owner() when the deployed owner differs, even if everything else matches", () => {
    const result = verifyDeployedFactory({ ...goodValues, owner: APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS });
    expect(result.allPassed).toBe(false);
    const ownerCheck = result.checks.find((check) => check.label === "owner()");
    expect(ownerCheck?.passed).toBe(false);
  });

  it("fails feeRecipient() when the deployed treasury differs", () => {
    const result = verifyDeployedFactory({ ...goodValues, feeRecipient: APPROVED_FACTORY_OWNER_ADDRESS });
    expect(result.allPassed).toBe(false);
    const feeRecipientCheck = result.checks.find((check) => check.label === "feeRecipient()");
    expect(feeRecipientCheck?.passed).toBe(false);
  });

  it("fails launchFee() when the deployed fee is nonzero", () => {
    const result = verifyDeployedFactory({ ...goodValues, launchFee: 1n });
    expect(result.allPassed).toBe(false);
    const launchFeeCheck = result.checks.find((check) => check.label === "launchFee()");
    expect(launchFeeCheck?.passed).toBe(false);
  });

  it("fails launchCount() when the factory already recorded a launch", () => {
    const result = verifyDeployedFactory({ ...goodValues, launchCount: 1n });
    expect(result.allPassed).toBe(false);
    const launchCountCheck = result.checks.find((check) => check.label === "launchCount()");
    expect(launchCountCheck?.passed).toBe(false);
  });
});

describe("buildFactoryDeploymentRecord", () => {
  it("assembles a JSON-serialisable record with chain id, addresses, tx hash, explorer links and no secrets", () => {
    const verification = verifyDeployedFactory({
      owner: APPROVED_FACTORY_OWNER_ADDRESS,
      feeRecipient: APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS,
      launchFee: 0n,
      launchCount: 0n,
    });

    const record = buildFactoryDeploymentRecord({
      factoryAddress: "0x1111111111111111111111111111111111111a",
      transactionHash: "0xaaaa000000000000000000000000000000000000000000000000000000000000",
      verification,
      deployedAtIso: "2026-07-22T00:00:00.000Z",
    });

    expect(record.chainId).toBe(46630);
    expect(record.network).toBe("Robinhood Chain Testnet");
    expect(record.factoryAddress).toBe("0x1111111111111111111111111111111111111a");
    expect(record.ownerAddress).toBe(APPROVED_FACTORY_OWNER_ADDRESS);
    expect(record.feeRecipientAddress).toBe(APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS);
    expect(record.initialLaunchFee).toBe("0");
    expect(record.explorerFactoryUrl).toContain("0x1111111111111111111111111111111111111a");
    expect(record.explorerTransactionUrl).toContain("0xaaaa");
    expect(record.verification.allPassed).toBe(true);

    // No secret-shaped fields, and the record must survive a JSON round trip
    // (rules out any stray bigint or function value slipping in).
    const serialised = JSON.stringify(record);
    expect(serialised).not.toMatch(/privateKey|seedPhrase|mnemonic/i);
    expect(JSON.parse(serialised)).toEqual(record);
  });
});
