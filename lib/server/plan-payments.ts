import type { PoolClient } from "pg";
import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  formatEther,
  formatUnits,
  http,
  isAddress,
  isHash,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
  paymentCatalogPrice,
  planPaymentDefinition,
  resolvePaymentBillingPeriod,
  type PaidLaunchPath,
  type PaymentAsset,
  type PaymentBillingPeriod,
  type PlanPaymentVerification,
} from "@/lib/plan-payments";
import {
  calculateSubscriptionWindow,
  isSubscriptionPlan,
  subscriptionStatusAt,
} from "@/lib/subscription-lifecycle";
import {
  ERC20_TRANSFER_ABI,
  getPlanPaymentQuote,
} from "@/lib/server/plan-payment-config";
import { getPostgresPool } from "@/lib/server/postgres";
import { createSubscriptionTelegramLink } from "@/lib/server/subscription-telegram";

const MIN_CONFIRMATIONS = 1;

export class PlanPaymentError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid-request"
      | "pending"
      | "reverted"
      | "wrong-chain"
      | "wrong-sender"
      | "wrong-recipient"
      | "wrong-token"
      | "wrong-token-decimals"
      | "underpaid"
      | "wrong-transaction-type"
      | "missing-transfer-log"
      | "replayed"
      | "database-unavailable",
  ) {
    super(message);
    this.name = "PlanPaymentError";
  }
}

export type VerifyPlanPaymentInput = {
  plan: PaidLaunchPath;
  billingPeriod?: PaymentBillingPeriod;
  paymentToken?: string;
  walletAddress: string;
  transactionHash: string;
};

export type VerifiedChainPayment = {
  plan: PaidLaunchPath;
  billingPeriod: PaymentBillingPeriod;
  walletAddress: Address;
  transactionHash: Hash;
  asset: PaymentAsset;
  tokenAddress: Address | null;
  amountAtomic: bigint;
  amountDisplay: string;
  amountEth: string | null;
  usdCents: number;
  subscriptionDays: number | null;
  chainId: number;
  blockNumber: bigint;
};

export type ChainTransaction = {
  from: Address;
  to: Address | null;
  value: bigint;
  input: Hex;
};

export type ChainLog = {
  address: Address;
  data: Hex;
  topics: readonly Hex[];
};

export type ChainReceipt = {
  status: "success" | "reverted";
  blockNumber: bigint;
  logs: readonly ChainLog[];
};

export type VerifyChainDeps = {
  getChainId: () => Promise<number>;
  getTransaction: (hash: Hash) => Promise<ChainTransaction>;
  getReceipt: (hash: Hash) => Promise<ChainReceipt>;
  getConfirmations: (hash: Hash) => Promise<bigint>;
  getTokenDecimals: (tokenAddress: Address) => Promise<number>;
};

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameOptionalAddress(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) return !left && !right;
  return sameAddress(left, right);
}

function verifiedTokenTransfer(input: {
  symbol: string;
  transaction: ChainTransaction;
  receipt: ChainReceipt;
  tokenAddress: Address;
  treasuryAddress: Address;
  walletAddress: Address;
  expectedAmount: bigint;
}): void {
  if (!input.transaction.to || !sameAddress(input.transaction.to, input.tokenAddress)) {
    throw new PlanPaymentError(
      `The subscription transaction was not sent to the configured ${input.symbol} contract.`,
      "wrong-token",
    );
  }
  if (input.transaction.value !== 0n) {
    throw new PlanPaymentError(
      `${input.symbol} subscription payments must not send native currency.`,
      "wrong-transaction-type",
    );
  }

  let decoded: ReturnType<typeof decodeFunctionData>;
  try {
    decoded = decodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      data: input.transaction.input,
    });
  } catch {
    throw new PlanPaymentError(
      `The transaction is not a direct ${input.symbol} transfer.`,
      "wrong-transaction-type",
    );
  }
  if (decoded.functionName !== "transfer") {
    throw new PlanPaymentError(
      `The transaction is not a direct ${input.symbol} transfer.`,
      "wrong-transaction-type",
    );
  }
  const [recipient, amount] = decoded.args as readonly [Address, bigint];
  if (!sameAddress(recipient, input.treasuryAddress)) {
    throw new PlanPaymentError(
      `The ${input.symbol} payment was not sent to the configured treasury wallet.`,
      "wrong-recipient",
    );
  }
  if (amount !== input.expectedAmount) {
    throw new PlanPaymentError(
      `The ${input.symbol} transfer amount does not match the selected subscription price.`,
      "underpaid",
    );
  }

  const hasMatchingTransfer = input.receipt.logs.some((log) => {
    if (!sameAddress(log.address, input.tokenAddress)) return false;
    try {
      const event = decodeEventLog({
        abi: ERC20_TRANSFER_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (event.eventName !== "Transfer") return false;
      const args = event.args as { from: Address; to: Address; value: bigint };
      return (
        sameAddress(args.from, input.walletAddress) &&
        sameAddress(args.to, input.treasuryAddress) &&
        args.value === input.expectedAmount
      );
    } catch {
      return false;
    }
  });
  if (!hasMatchingTransfer) {
    throw new PlanPaymentError(
      `The confirmed receipt does not contain the required ${input.symbol} Transfer event.`,
      "missing-transfer-log",
    );
  }
}

export async function verifyPlanPaymentTransaction(
  input: VerifyPlanPaymentInput,
  deps?: VerifyChainDeps,
): Promise<VerifiedChainPayment> {
  if (!isAddress(input.walletAddress) || !isHash(input.transactionHash)) {
    throw new PlanPaymentError(
      "A valid wallet address and transaction hash are required.",
      "invalid-request",
    );
  }

  const billingPeriod = resolvePaymentBillingPeriod(input.plan, input.billingPeriod);
  const quote = getPlanPaymentQuote(
    input.plan,
    billingPeriod,
    input.paymentToken,
  );
  const client = deps
    ? null
    : createPublicClient({
        chain: {
          id: quote.chainId,
          name: quote.chainName,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [quote.rpcUrl] } },
        },
        transport: http(quote.rpcUrl),
      });

  const chain =
    deps ??
    ({
      getChainId: () => client!.getChainId(),
      getTransaction: (hash: Hash) => client!.getTransaction({ hash }),
      getReceipt: (hash: Hash) => client!.getTransactionReceipt({ hash }),
      getConfirmations: (hash: Hash) => client!.getTransactionConfirmations({ hash }),
      getTokenDecimals: (tokenAddress: Address) =>
        client!.readContract({
          address: tokenAddress,
          abi: ERC20_TRANSFER_ABI,
          functionName: "decimals",
        }),
    } satisfies VerifyChainDeps);

  let chainId: number;
  let transaction: ChainTransaction;
  let receipt: ChainReceipt;
  let confirmations: bigint;
  try {
    [chainId, transaction, receipt, confirmations] = await Promise.all([
      chain.getChainId(),
      chain.getTransaction(input.transactionHash),
      chain.getReceipt(input.transactionHash),
      chain.getConfirmations(input.transactionHash),
    ]);
  } catch {
    throw new PlanPaymentError(
      "The payment is not confirmed on Robinhood Chain yet.",
      "pending",
    );
  }

  if (chainId !== quote.chainId) {
    throw new PlanPaymentError(
      `The payment RPC reported chain ${chainId}, not the configured Robinhood Chain ${quote.chainId}.`,
      "wrong-chain",
    );
  }
  if (receipt.status !== "success") {
    throw new PlanPaymentError("The payment transaction reverted.", "reverted");
  }
  if (confirmations < BigInt(MIN_CONFIRMATIONS)) {
    throw new PlanPaymentError(
      "The payment is waiting for an on-chain confirmation.",
      "pending",
    );
  }
  if (!sameAddress(transaction.from, input.walletAddress)) {
    throw new PlanPaymentError(
      "The payment was sent by a different wallet.",
      "wrong-sender",
    );
  }

  const expectedAtomic = BigInt(quote.amountAtomic);
  const tokenPayment = quote.tokenAddress !== null && quote.tokenDecimals !== null;
  if (tokenPayment) {
    const actualDecimals = await chain.getTokenDecimals(quote.tokenAddress!);
    if (actualDecimals !== quote.tokenDecimals) {
      throw new PlanPaymentError(
        `The configured ${quote.asset} decimals do not match the on-chain token contract.`,
        "wrong-token-decimals",
      );
    }
    verifiedTokenTransfer({
      symbol: quote.asset,
      transaction,
      receipt,
      tokenAddress: quote.tokenAddress!,
      treasuryAddress: quote.treasuryAddress,
      walletAddress: input.walletAddress,
      expectedAmount: expectedAtomic,
    });
  } else {
    if (!transaction.to || !sameAddress(transaction.to, quote.treasuryAddress)) {
      throw new PlanPaymentError(
        "The payment was not sent to the configured treasury wallet.",
        "wrong-recipient",
      );
    }
    if (transaction.input !== "0x") {
      throw new PlanPaymentError(
        "The one-off payment must be a direct ETH transfer to the treasury.",
        "wrong-transaction-type",
      );
    }
    if (transaction.value < expectedAtomic) {
      throw new PlanPaymentError(
        `The payment is below the required ${quote.amountDisplay} ETH.`,
        "underpaid",
      );
    }
  }

  const catalog = paymentCatalogPrice(input.plan, billingPeriod);
  const amountAtomic = tokenPayment ? expectedAtomic : transaction.value;
  const amountDisplay = tokenPayment
    ? formatUnits(amountAtomic, quote.tokenDecimals!)
    : formatEther(amountAtomic);

  return {
    plan: input.plan,
    billingPeriod,
    walletAddress: input.walletAddress,
    transactionHash: input.transactionHash,
    asset: quote.asset,
    tokenAddress: quote.tokenAddress,
    amountAtomic,
    amountDisplay,
    amountEth: quote.asset === "ETH" ? amountDisplay : null,
    usdCents: catalog.usdCents,
    subscriptionDays: catalog.subscriptionDays,
    chainId,
    blockNumber: receipt.blockNumber,
  };
}

type ExistingPaymentRow = {
  wallet_address: string;
  plan_id: string;
  billing_period: PaymentBillingPeriod;
  asset_symbol?: string | null;
  asset_contract?: string | null;
  paid_from: Date | string | null;
  paid_until: Date | string | null;
};

type ExistingSubscriptionRow = {
  paid_until: Date | string | null;
  expires_at: Date | string | null;
};

export type PlanPaymentDatabaseClient = Pick<PoolClient, "query" | "release">;
export type PlanPaymentConnect = () => Promise<PlanPaymentDatabaseClient>;

async function safeRollback(client: PlanPaymentDatabaseClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Keep the original error.
  }
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function persistVerifiedPlanPayment(
  payment: VerifiedChainPayment,
  options: {
    databaseUrl?: string;
    connect?: PlanPaymentConnect;
    now?: Date;
  } = {},
): Promise<PlanPaymentVerification> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  const connect =
    options.connect ??
    (databaseUrl ? () => getPostgresPool(databaseUrl).connect() : null);
  if (!connect) {
    throw new PlanPaymentError(
      "Payment confirmation cannot be recorded because DATABASE_URL is not configured.",
      "database-unavailable",
    );
  }

  const definition = planPaymentDefinition(payment.plan);
  const now = options.now ?? new Date();
  const client = await connect();

  try {
    await client.query("BEGIN");

    let paidFrom: Date | null = null;
    let paidUntil: Date | null = null;
    if (isSubscriptionPlan(payment.plan)) {
      const existingSubscription = await client.query<ExistingSubscriptionRow>(
        `SELECT paid_until, expires_at
           FROM subscriptions
          WHERE wallet_address = $1
          FOR UPDATE`,
        [payment.walletAddress.toLowerCase()],
      );
      const currentRaw = existingSubscription.rows[0]?.paid_until ??
        existingSubscription.rows[0]?.expires_at ??
        null;
      const currentPaidUntil = currentRaw ? new Date(currentRaw) : null;
      const window = calculateSubscriptionWindow({
        now,
        currentPaidUntil,
        billingPeriod: payment.billingPeriod === "upfront" ? "upfront" : "monthly",
      });
      paidFrom = window.paidFrom;
      paidUntil = window.paidUntil;
    }

    const inserted = await client.query<ExistingPaymentRow>(
      `INSERT INTO plan_payment_events (
         payment_tx_hash,
         wallet_address,
         plan_id,
         tier,
         payment_kind,
         amount_wei,
         amount_eth,
         amount_usd_cents,
         chain_id,
         block_number,
         paid_until,
         confirmed_at,
         billing_period,
         asset_symbol,
         asset_contract,
         amount_atomic,
         amount_display,
         paid_from,
         subscription_days
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (payment_tx_hash) DO NOTHING
       RETURNING wallet_address, plan_id, billing_period, asset_symbol, asset_contract, paid_from, paid_until`,
      [
        payment.transactionHash.toLowerCase(),
        payment.walletAddress.toLowerCase(),
        payment.plan,
        definition.subscriptionTier,
        definition.kind,
        payment.asset === "ETH" ? payment.amountAtomic.toString() : null,
        payment.amountEth,
        payment.usdCents,
        payment.chainId,
        payment.blockNumber.toString(),
        paidUntil,
        now,
        payment.billingPeriod,
        payment.asset,
        payment.tokenAddress?.toLowerCase() ?? null,
        payment.amountAtomic.toString(),
        payment.amountDisplay,
        paidFrom,
        payment.subscriptionDays,
      ],
    );

    if (inserted.rows.length === 0) {
      const existing = await client.query<ExistingPaymentRow>(
        `SELECT wallet_address, plan_id, billing_period,
                asset_symbol, asset_contract, paid_from, paid_until
           FROM plan_payment_events
          WHERE payment_tx_hash = $1
          LIMIT 1`,
        [payment.transactionHash.toLowerCase()],
      );
      const row = existing.rows[0];
      const recordedAssetMatches =
        !row?.asset_symbol || row.asset_symbol === payment.asset;
      const recordedContractMatches =
        row?.asset_contract === undefined ||
        sameOptionalAddress(row.asset_contract, payment.tokenAddress);
      if (
        !row ||
        !sameAddress(row.wallet_address, payment.walletAddress) ||
        row.plan_id !== payment.plan ||
        row.billing_period !== payment.billingPeriod ||
        !recordedAssetMatches ||
        !recordedContractMatches
      ) {
        throw new PlanPaymentError(
          "This transaction hash has already been used for another purchase or payment token.",
          "replayed",
        );
      }
      await client.query("COMMIT");
      const existingPaidUntil = iso(row.paid_until);
      return {
        verified: true,
        plan: payment.plan,
        billingPeriod: payment.billingPeriod,
        walletAddress: payment.walletAddress,
        transactionHash: payment.transactionHash,
        asset: payment.asset,
        amountDisplay: payment.amountDisplay,
        amountEth: payment.amountEth,
        usdCents: payment.usdCents,
        paidFrom: iso(row.paid_from),
        paidUntil: existingPaidUntil,
        subscriptionStatus: existingPaidUntil
          ? subscriptionStatusAt(existingPaidUntil, now)
          : null,
        destination: definition.destination,
        alreadyRecorded: true,
        telegramLinkUrl: null,
      };
    }

    await client.query(
      `INSERT INTO subscriptions (
         wallet_address,
         tier,
         status,
         started_at,
         expires_at,
         paid_from,
         paid_until,
         payment_tx_hash,
         amount_eth,
         last_payment_asset,
         last_payment_amount,
         last_payment_usd_cents,
         created_at
       ) VALUES ($1, $2, 'active', $3, $4, $5, $4, $6, $7, $8, $9, $10, $3)
       ON CONFLICT (wallet_address) DO UPDATE
         SET tier = EXCLUDED.tier,
             status = 'active',
             expires_at = EXCLUDED.expires_at,
             paid_from = EXCLUDED.paid_from,
             paid_until = EXCLUDED.paid_until,
             payment_tx_hash = EXCLUDED.payment_tx_hash,
             amount_eth = EXCLUDED.amount_eth,
             last_payment_asset = EXCLUDED.last_payment_asset,
             last_payment_amount = EXCLUDED.last_payment_amount,
             last_payment_usd_cents = EXCLUDED.last_payment_usd_cents,
             created_at = EXCLUDED.created_at`,
      [
        payment.walletAddress.toLowerCase(),
        definition.subscriptionTier,
        now,
        paidUntil,
        paidFrom,
        payment.transactionHash.toLowerCase(),
        payment.amountEth ?? "",
        payment.asset,
        payment.amountDisplay,
        payment.usdCents,
      ],
    );

    await client.query(
      `INSERT INTO admin_activity_log (event_kind, service_key, message, created_at)
       VALUES ('payment-received', NULL, $1, $2)`,
      [
        `${definition.label} ${payment.billingPeriod} payment verified: $${(payment.usdCents / 100).toFixed(2)} · ${payment.amountDisplay} ${payment.asset} · ${payment.walletAddress}`,
        now,
      ],
    );

    await client.query("COMMIT");
    return {
      verified: true,
      plan: payment.plan,
      billingPeriod: payment.billingPeriod,
      walletAddress: payment.walletAddress,
      transactionHash: payment.transactionHash,
      asset: payment.asset,
      amountDisplay: payment.amountDisplay,
      amountEth: payment.amountEth,
      usdCents: payment.usdCents,
      paidFrom: paidFrom?.toISOString() ?? null,
      paidUntil: paidUntil?.toISOString() ?? null,
      subscriptionStatus: paidUntil ? "active" : null,
      destination: definition.destination,
      alreadyRecorded: false,
      telegramLinkUrl: null,
    };
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyAndRecordPlanPayment(
  input: VerifyPlanPaymentInput,
  options: {
    verifyDeps?: VerifyChainDeps;
    databaseUrl?: string;
    connect?: PlanPaymentConnect;
    now?: Date;
    telegramLink?: typeof createSubscriptionTelegramLink;
  } = {},
): Promise<PlanPaymentVerification> {
  const verified = await verifyPlanPaymentTransaction(input, options.verifyDeps);
  const recorded = await persistVerifiedPlanPayment(verified, options);
  if (!isSubscriptionPlan(recorded.plan)) return recorded;

  const telegramLink = options.telegramLink ?? createSubscriptionTelegramLink;
  const telegramLinkUrl = await telegramLink({
    walletAddress: recorded.walletAddress,
    databaseUrl: options.databaseUrl,
    now: options.now,
  });
  return { ...recorded, telegramLinkUrl };
}
