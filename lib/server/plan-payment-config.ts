import { formatEther, isAddress, toHex } from "viem";
import {
  planPaymentDefinition,
  type PaidLaunchPath,
  type PlanPaymentQuote,
} from "@/lib/plan-payments";

export class PlanPaymentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanPaymentConfigurationError";
  }
}

type PaymentEnvironment = Record<string, string | undefined>;

function required(environment: PaymentEnvironment, key: string): string {
  const value = environment[key]?.trim() || "";
  if (!value) {
    throw new PlanPaymentConfigurationError(`${key} is not configured.`);
  }
  return value;
}

function positiveBigInt(value: string, key: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new PlanPaymentConfigurationError(`${key} must be a positive integer amount in wei.`);
  }
  const amount = BigInt(value);
  if (amount <= 0n) {
    throw new PlanPaymentConfigurationError(`${key} must be greater than zero.`);
  }
  return amount;
}

function positiveChainId(value: string | undefined): number {
  const chainId = Number(value?.trim() || "46630");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new PlanPaymentConfigurationError(
      "HOODLUMS_PAYMENT_CHAIN_ID must be a positive integer.",
    );
  }
  return chainId;
}

function absoluteUrl(value: string, key: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new PlanPaymentConfigurationError(`${key} must be an absolute HTTP(S) URL.`);
  }
}

export function getPlanPaymentQuote(
  plan: PaidLaunchPath,
  environment: PaymentEnvironment = process.env,
): PlanPaymentQuote {
  const definition = planPaymentDefinition(plan);
  const treasuryAddress = required(environment, "HOODLUMS_TREASURY_ADDRESS");
  if (!isAddress(treasuryAddress)) {
    throw new PlanPaymentConfigurationError(
      "HOODLUMS_TREASURY_ADDRESS must be a valid EVM address.",
    );
  }

  const amount = positiveBigInt(
    required(environment, definition.amountWeiEnvironmentKey),
    definition.amountWeiEnvironmentKey,
  );
  const chainId = positiveChainId(environment.HOODLUMS_PAYMENT_CHAIN_ID);
  const rpcUrl = absoluteUrl(
    required(environment, "HOODLUMS_PAYMENT_RPC_URL"),
    "HOODLUMS_PAYMENT_RPC_URL",
  );
  const explorerBaseUrl = absoluteUrl(
    environment.HOODLUMS_PAYMENT_EXPLORER_URL?.trim() ||
      "https://explorer.testnet.chain.robinhood.com",
    "HOODLUMS_PAYMENT_EXPLORER_URL",
  );

  return {
    plan,
    label: definition.label,
    usdCents: definition.usdCents,
    amountWei: toHex(amount),
    amountEth: formatEther(amount),
    treasuryAddress,
    chainId,
    chainIdHex: toHex(chainId),
    chainName: environment.HOODLUMS_PAYMENT_CHAIN_NAME?.trim() || "Robinhood Chain",
    rpcUrl,
    explorerBaseUrl,
  };
}
