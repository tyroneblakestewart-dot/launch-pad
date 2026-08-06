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
  type PaymentTokenOption,
  type PlanPaymentQuote,
} from "@/lib/plan-payments";

export class PlanPaymentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanPaymentConfigurationError";
  }
}

type PaymentEnvironment = Record<string, string | undefined>;

type ConfiguredPaymentToken = {
  symbol: string;
  contractAddress: Address | null;
  decimals: number | null;
  enabled: boolean;
  note: string | null;
};

export const ERC20_TRANSFER_ABI = [
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

// Backwards-compatible export for existing integrations and tests.
export const USDT_TRANSFER_ABI = ERC20_TRANSFER_ABI;

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

function validDecimals(value: unknown, label: string): number {
  const raw = typeof value === "number" ? String(value) : String(value ?? "").trim();
  const decimals = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new PlanPaymentConfigurationError(`${label} must be an integer from 0 to 18.`);
  }
  return decimals;
}

function positiveChainId(value: string | undefined): number {
  const chainId = Number(value?.trim() || "4663");
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

function normaliseSymbol(value: unknown): string {
  const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) {
    throw new PlanPaymentConfigurationError(
      "Every payment token symbol must contain 2-12 uppercase letters or numbers.",
    );
  }
  return symbol;
}

function isEnvironment(value: unknown): value is PaymentEnvironment {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function legacyUsdtTokens(environment: PaymentEnvironment): ConfiguredPaymentToken[] {
  const address = configuredAddress(environment, "HOODLUMS_USDT_TOKEN_ADDRESS");
  const decimals = validDecimals(
    required(environment, "HOODLUMS_USDT_DECIMALS"),
    "HOODLUMS_USDT_DECIMALS",
  );
  return [{
    symbol: "USDT",
    contractAddress: address,
    decimals,
    enabled: true,
    note: "Legacy single-token configuration. Migrate to HOODLUMS_PAYMENT_TOKENS_JSON.",
  }];
}

export function getConfiguredPaymentTokens(
  environment: PaymentEnvironment = process.env,
): ConfiguredPaymentToken[] {
  const raw = environment.HOODLUMS_PAYMENT_TOKENS_JSON?.trim() || "";
  if (!raw) return legacyUsdtTokens(environment);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PlanPaymentConfigurationError(
      "HOODLUMS_PAYMENT_TOKENS_JSON must be valid JSON.",
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new PlanPaymentConfigurationError(
      "HOODLUMS_PAYMENT_TOKENS_JSON must be a non-empty JSON array.",
    );
  }

  const seen = new Set<string>();
  const tokens = parsed.map((entry, index): ConfiguredPaymentToken => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new PlanPaymentConfigurationError(
        `Payment token entry ${index + 1} must be an object.`,
      );
    }
    const record = entry as Record<string, unknown>;
    const symbol = normaliseSymbol(record.symbol);
    if (seen.has(symbol)) {
      throw new PlanPaymentConfigurationError(
        `Payment token symbol ${symbol} is configured more than once.`,
      );
    }
    seen.add(symbol);

    const enabled = record.enabled !== false;
    const note = typeof record.note === "string" && record.note.trim()
      ? record.note.trim().slice(0, 240)
      : null;
    const addressInput = record.contractAddress ?? record.address;
    const address = typeof addressInput === "string" && isAddress(addressInput)
      ? addressInput
      : null;
    const decimals = record.decimals === null || record.decimals === undefined
      ? null
      : validDecimals(record.decimals, `${symbol} decimals`);

    if (enabled && (!address || decimals === null)) {
      throw new PlanPaymentConfigurationError(
        `Enabled payment token ${symbol} requires a valid contractAddress and decimals.`,
      );
    }
    if (!enabled && !note) {
      throw new PlanPaymentConfigurationError(
        `Disabled payment token ${symbol} requires a note explaining why it is unavailable.`,
      );
    }

    return {
      symbol,
      contractAddress: address,
      decimals,
      enabled,
      note,
    };
  });

  if (!tokens.some((token) => token.enabled)) {
    throw new PlanPaymentConfigurationError(
      "At least one payment token must be enabled.",
    );
  }
  return tokens;
}

export function getEnabledPaymentTokenOptions(
  environment: PaymentEnvironment = process.env,
): PaymentTokenOption[] {
  return getConfiguredPaymentTokens(environment)
    .filter(
      (token): token is ConfiguredPaymentToken & {
        contractAddress: Address;
        decimals: number;
      } => token.enabled && token.contractAddress !== null && token.decimals !== null,
    )
    .map((token) => ({
      symbol: token.symbol,
      contractAddress: token.contractAddress,
      decimals: token.decimals,
      note: token.note,
    }));
}

function selectedPaymentToken(
  tokenInput: unknown,
  environment: PaymentEnvironment,
): PaymentTokenOption {
  const configured = getConfiguredPaymentTokens(environment);
  const requested = typeof tokenInput === "string" && tokenInput.trim()
    ? tokenInput.trim().toUpperCase()
    : null;
  const selected = requested
    ? configured.find((token) => token.symbol === requested)
    : configured.find((token) => token.enabled);

  if (!selected) {
    throw new PlanPaymentConfigurationError(
      requested
        ? `Payment token ${requested} is not configured.`
        : "No enabled payment token is configured.",
    );
  }
  if (!selected.enabled) {
    throw new PlanPaymentConfigurationError(
      `Payment token ${selected.symbol} is disabled${selected.note ? `: ${selected.note}` : "."}`,
    );
  }
  if (!selected.contractAddress || selected.decimals === null) {
    throw new PlanPaymentConfigurationError(
      `Payment token ${selected.symbol} configuration is incomplete.`,
    );
  }
  return {
    symbol: selected.symbol,
    contractAddress: selected.contractAddress,
    decimals: selected.decimals,
    note: selected.note,
  };
}

export function getPlanPaymentQuote(
  plan: PaidLaunchPath,
  billingInput: unknown = "monthly",
  paymentTokenOrEnvironment?: unknown,
  environmentInput: PaymentEnvironment = process.env,
): PlanPaymentQuote {
  const environment = isEnvironment(paymentTokenOrEnvironment)
    ? paymentTokenOrEnvironment
    : environmentInput;
  const paymentTokenInput = isEnvironment(paymentTokenOrEnvironment)
    ? undefined
    : paymentTokenOrEnvironment;
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
      "https://robinhoodchain.blockscout.com",
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
      paymentTokens: [],
      amountAtomic: toHex(amount),
      amountDisplay: formatEther(amount),
      tokenAddress: null,
      tokenDecimals: null,
      transactionTo: treasuryAddress,
      transactionValue: toHex(amount),
      transactionData: "0x",
    };
  }

  const paymentTokens = getEnabledPaymentTokenOptions(environment);
  const token = selectedPaymentToken(paymentTokenInput, environment);
  const wholeTokens = (catalog.usdCents / 100).toString();
  const amount = parseUnits(wholeTokens, token.decimals);
  const transferData = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [treasuryAddress, amount],
  });

  return {
    ...common,
    asset: token.symbol,
    paymentTokens,
    amountAtomic: toHex(amount),
    amountDisplay: formatUnits(amount, token.decimals),
    tokenAddress: token.contractAddress,
    tokenDecimals: token.decimals,
    transactionTo: token.contractAddress,
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
