import type { Address } from "viem";
import {
  ROBINHOOD_TESTNET,
  ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
  ROBINHOOD_TESTNET_CHAIN_ID_HEX,
} from "./chains";

/**
 * Fixed, owner-approved configuration for the first HoodlumsTokenFactory
 * deployment on Robinhood Chain Testnet. These values come directly from the
 * launch issue and must not be changed or reinterpreted here.
 */
export const APPROVED_FACTORY_OWNER_ADDRESS: Address =
  "0x505217CBbe3059993877983b4fDAD5C6e32AF1F5";
export const APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS: Address =
  "0xCF6F11C6dc4FFa50bF820030FC9164675704984a";
export const APPROVED_FACTORY_INITIAL_LAUNCH_FEE = 0n;

export const FACTORY_DEPLOYMENT_CHAIN_ID = ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL;
export const FACTORY_DEPLOYMENT_CHAIN_ID_HEX = ROBINHOOD_TESTNET_CHAIN_ID_HEX.toLowerCase();
export const FACTORY_DEPLOYMENT_EXPLORER_BASE_URL = ROBINHOOD_TESTNET.blockExplorerUrls[0];

export function normaliseChainIdHex(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  const radix = trimmed.startsWith("0x") ? 16 : 10;
  const numeric = Number.parseInt(trimmed.replace(/^0x/, ""), radix);
  return Number.isFinite(numeric) ? `0x${numeric.toString(16)}` : "";
}

export function isApprovedFactoryChain(chainIdHex: string | null | undefined): boolean {
  return normaliseChainIdHex(chainIdHex) === FACTORY_DEPLOYMENT_CHAIN_ID_HEX;
}

export function isApprovedFactoryOwner(address: string | null | undefined): boolean {
  if (!address) return false;
  return address.trim().toLowerCase() === APPROVED_FACTORY_OWNER_ADDRESS.toLowerCase();
}

/** Constructor args in the exact order required by HoodlumsTokenFactory.sol. */
export function buildFactoryConstructorArgs(): readonly [Address, Address, bigint] {
  return [
    APPROVED_FACTORY_OWNER_ADDRESS,
    APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS,
    APPROVED_FACTORY_INITIAL_LAUNCH_FEE,
  ];
}

export type FactoryDeploymentReceiptLike = {
  contractAddress?: string | null;
};

export type ParsedFactoryDeployment = {
  factoryAddress: Address;
  transactionHash: string;
};

export function parseFactoryDeploymentResult(
  receipt: FactoryDeploymentReceiptLike,
  transactionHash: string | null | undefined,
): ParsedFactoryDeployment {
  if (!receipt.contractAddress) {
    throw new Error("The deployment receipt did not include a contract address.");
  }
  if (!transactionHash) {
    throw new Error("The deployment did not return a transaction hash.");
  }
  return {
    factoryAddress: receipt.contractAddress as Address,
    transactionHash,
  };
}

export type FactoryReadBackValues = {
  owner: string;
  feeRecipient: string;
  launchFee: bigint;
  launchCount: bigint;
};

export type FactoryVerificationCheck = {
  label: string;
  expected: string;
  actual: string;
  passed: boolean;
};

export type FactoryVerificationResult = {
  allPassed: boolean;
  checks: FactoryVerificationCheck[];
};

/** Read-back validation: owner(), feeRecipient(), launchFee() and launchCount() must match the approved config. */
export function verifyDeployedFactory(values: FactoryReadBackValues): FactoryVerificationResult {
  const checks: FactoryVerificationCheck[] = [
    {
      label: "owner()",
      expected: APPROVED_FACTORY_OWNER_ADDRESS,
      actual: values.owner,
      passed:
        Boolean(values.owner) &&
        values.owner.toLowerCase() === APPROVED_FACTORY_OWNER_ADDRESS.toLowerCase(),
    },
    {
      label: "feeRecipient()",
      expected: APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS,
      actual: values.feeRecipient,
      passed:
        Boolean(values.feeRecipient) &&
        values.feeRecipient.toLowerCase() === APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS.toLowerCase(),
    },
    {
      label: "launchFee()",
      expected: "0",
      actual: values.launchFee.toString(),
      passed: values.launchFee === 0n,
    },
    {
      label: "launchCount()",
      expected: "0",
      actual: values.launchCount.toString(),
      passed: values.launchCount === 0n,
    },
  ];

  return { allPassed: checks.every((check) => check.passed), checks };
}

export type FactoryDeploymentRecord = {
  network: string;
  chainId: number;
  factoryAddress: string;
  transactionHash: string;
  ownerAddress: string;
  feeRecipientAddress: string;
  initialLaunchFee: string;
  explorerFactoryUrl: string;
  explorerTransactionUrl: string;
  verification: FactoryVerificationResult;
  deployedAt: string;
  nextManualGate: string;
};

const NEXT_MANUAL_GATE =
  "Review this deployment record and the verification checks above. Only after that " +
  "review should the factory address be configured and /testnet changed to call " +
  "launchToken() — public token launches are not routed through this factory yet.";

/** Assembles the copyable/downloadable deployment record. Contains no secrets. */
export function buildFactoryDeploymentRecord(input: {
  factoryAddress: string;
  transactionHash: string;
  verification: FactoryVerificationResult;
  deployedAtIso: string;
}): FactoryDeploymentRecord {
  return {
    network: "Robinhood Chain Testnet",
    chainId: FACTORY_DEPLOYMENT_CHAIN_ID,
    factoryAddress: input.factoryAddress,
    transactionHash: input.transactionHash,
    ownerAddress: APPROVED_FACTORY_OWNER_ADDRESS,
    feeRecipientAddress: APPROVED_FACTORY_FEE_RECIPIENT_ADDRESS,
    initialLaunchFee: "0",
    explorerFactoryUrl: `${FACTORY_DEPLOYMENT_EXPLORER_BASE_URL}/address/${input.factoryAddress}`,
    explorerTransactionUrl: `${FACTORY_DEPLOYMENT_EXPLORER_BASE_URL}/tx/${input.transactionHash}`,
    verification: input.verification,
    deployedAt: input.deployedAtIso,
    nextManualGate: NEXT_MANUAL_GATE,
  };
}
