import {
  encodeFunctionData,
  formatEther,
  formatUnits,
  isAddress,
  parseUnits,
  toHex,
  type Address,
} from "viem";
import {
  paymentCatalogPrice,
  planPaymentDefinition,
  resolvePaymentBillingPeriod,
  type PaidLaunchPath,
  type PaymentBillingPeriod,
  type PlanPaymentQuote,
} from "@/lib/plan-payments";

export class PlanPaymentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanPaymentConfigurationError";
  }
}

type PaymentEnvironment = Record<string, string | undefined>;

export const USDT_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

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

function tokenDecimals(environment: PaymentEnvironment): number {
  const raw = required(environment, "HOODLUMS_USDT_DECIMALS");
  const decimals = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new PlanPaymentConfigurationError(
      "HOODLUMS_USDT_DECIMALS must be an integer from 0 to 18.",
    );
  }
  return decimals;
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

function configuredAddress(
  environment: PaymentEnvironment,
  key: string,
): Address {
  const address = required(environment, key);
  if (!isAddress(address)) {
    throw new PlanPaymentConfigurationError(`${key} must be a valid EVM address.`);
  }
  return address;
}

export function getPlanPaymentQuote(
  plan: PaidLaunchPath,
  billingInput: unknown = "monthly",
  environment: PaymentEnvironment = process.env,
): PlanPaymentQuote {
  const definition = planPaymentDefinition(plan);
  const billingPeriod = resolvePaymentBillingPeriod(plan, billingInput);
  const catalog = paymentCatalogPrice(plan, billingPeriod);
  const treasuryAddress = configuredAddress(environment, "HOODLUMS_TREASURY_ADDRESS");
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
  const common = {
    plan,
    label: definition.label,
    billingPeriod,
    subscriptionDays: catalog.subscriptionDays,
    usdCents: catalog.usdCents,
    treasuryAddress,
    chainId,
    chainIdHex: toHex(chainId),
    chainName: environment.HOODLUMS_PAYMENT_CHAIN_NAME?.trim() || "Robinhood Chain",
    rpcUrl,
    explorerBaseUrl,
  } as const;

  if (definition.kind === "one_off") {
    const key = definition.nativeAmountWeiEnvironmentKey;
    if (!key) {
      throw new PlanPaymentConfigurationError("The native payment amount is not configured.");
    }
    const amount = positiveBigInt(required(environment, key), key);
    return {
      ...common,
      asset: "ETH",
      amountAtomic: toHex(amount),
      amountDisplay: formatEther(amount),
      tokenAddress: null,
      tokenDecimals: null,
      transactionTo: treasuryAddress,
      transactionValue: toHex(amount),
      transactionData: "0x",
    };
  }

  const usdtAddress = configuredAddress(environment, "HOODLUMS_USDT_TOKEN_ADDRESS");
  const decimals = tokenDecimals(environment);
  const wholeUsdt = (catalog.usdCents / 100).toString();
  const amount = parseUnits(wholeUsdt, decimals);
  const transferData = encodeFunctionData({
    abi: USDT_TRANSFER_ABI,
    functionName: "transfer",
    args: [treasuryAddress, amount],
  });

  return {
    ...common,
    asset: "USDT",
    amountAtomic: toHex(amount),
    amountDisplay: formatUnits(amount, decimals),
    tokenAddress: usdtAddress,
    tokenDecimals: decimals,
    transactionTo: usdtAddress,
    transactionValue: "0x0",
    transactionData: transferData,
  };
}

export function normalisePaymentBillingPeriod(
  plan: PaidLaunchPath,
  billing: unknown,
): PaymentBillingPeriod {
  return resolvePaymentBillingPeriod(plan, billing);
}
