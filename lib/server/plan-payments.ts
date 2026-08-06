import type { PoolClient } from "pg";
import {
  createPublicClient,
  formatEther,
  http,
  isAddress,
  isHash,
  type Address,
  type Hash,
} from "viem";
import {
  planPaymentDefinition,
  type PaidLaunchPath,
  type PlanPaymentVerification,
} from "@/lib/plan-payments";
import { getPlanPaymentQuote } from "@/lib/server/plan-payment-config";
import { getPostgresPool } from "@/lib/server/postgres";

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
      | "underpaid"
      | "wrong-transaction-type"
      | "replayed"
      | "database-unavailable",
  ) {
    super(message);
    this.name = "PlanPaymentError";
  }
}

export type VerifyPlanPaymentInput = {
  plan: PaidLaunchPath;
  walletAddress: string;
  transactionHash: string;
};

export type VerifiedChainPayment = {
  plan: PaidLaunchPath;
  walletAddress: Address;
  transactionHash: Hash;
  amountWei: bigint;
  amountEth: string;
  usdCents: number;
  chainId: number;
  blockNumber: bigint;
};

export type ChainTransaction = {
  from: Address;
  to: Address | null;
  value: bigint;
  input: `0x${string}`;
};

export type ChainReceipt = {
  status: "success" | "reverted";
  blockNumber: bigint;
};

export type VerifyChainDeps = {
  getChainId: () => Promise<number>;
  getTransaction: (hash: Hash) => Promise<ChainTransaction>;
  getReceipt: (hash: Hash) => Promise<ChainReceipt>;
  getConfirmations: (hash: Hash) => Promise<bigint>;
};

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
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

  const quote = getPlanPaymentQuote(input.plan);
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
      getConfirmations: (hash: Hash) =>
        client!.getTransactionConfirmations({ hash }),
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
  if (!transaction.to || !sameAddress(transaction.to, quote.treasuryAddress)) {
    throw new PlanPaymentError(
      "The payment was not sent to the configured treasury wallet.",
      "wrong-recipient",
    );
  }
  if (transaction.input !== "0x") {
    throw new PlanPaymentError(
      "Plan payments must be direct ETH transfers to the treasury.",
      "wrong-transaction-type",
    );
  }

  const expectedWei = BigInt(quote.amountWei);
  if (transaction.value < expectedWei) {
    throw new PlanPaymentError(
      `The payment is below the required ${quote.amountEth} ETH.`,
      "underpaid",
    );
  }

  return {
    plan: input.plan,
    walletAddress: input.walletAddress,
    transactionHash: input.transactionHash,
    amountWei: transaction.value,
    amountEth: formatEther(transaction.value),
    usdCents: quote.usdCents,
    chainId,
    blockNumber: receipt.blockNumber,
  };
}

type ExistingPaymentRow = {
  wallet_address: string;
  plan_id: string;
  paid_until: Date | string | null;
};

type ExistingSubscriptionRow = {
  expires_at: Date | string | null;
};

export type PlanPaymentDatabaseClient = Pick<PoolClient, "query" | "release">;
export type PlanPaymentConnect = () => Promise<PlanPaymentDatabaseClient>;

function addDays(start: Date, days: number): Date {
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

async function safeRollback(client: PlanPaymentDatabaseClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Keep the original error.
  }
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

    let paidUntil: Date | null = null;
    if (definition.subscriptionDays) {
      const existingSubscription = await client.query<ExistingSubscriptionRow>(
        `SELECT expires_at
           FROM subscriptions
          WHERE wallet_address = $1
          FOR UPDATE`,
        [payment.walletAddress.toLowerCase()],
      );
      const existingExpiry = existingSubscription.rows[0]?.expires_at
        ? new Date(existingSubscription.rows[0].expires_at)
        : null;
      const base = existingExpiry && existingExpiry.getTime() > now.getTime()
        ? existingExpiry
        : now;
      paidUntil = addDays(base, definition.subscriptionDays);
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
         confirmed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (payment_tx_hash) DO NOTHING
       RETURNING wallet_address, plan_id, paid_until`,
      [
        payment.transactionHash.toLowerCase(),
        payment.walletAddress.toLowerCase(),
        payment.plan,
        definition.subscriptionTier,
        definition.kind,
        payment.amountWei.toString(),
        payment.amountEth,
        payment.usdCents,
        payment.chainId,
        payment.blockNumber.toString(),
        paidUntil,
        now,
      ],
    );

    if (inserted.rows.length === 0) {
      const existing = await client.query<ExistingPaymentRow>(
        `SELECT wallet_address, plan_id, paid_until
           FROM plan_payment_events
          WHERE payment_tx_hash = $1
          LIMIT 1`,
        [payment.transactionHash.toLowerCase()],
      );
      const row = existing.rows[0];
      if (
        !row ||
        !sameAddress(row.wallet_address, payment.walletAddress) ||
        row.plan_id !== payment.plan
      ) {
        throw new PlanPaymentError(
          "This transaction hash has already been used for another purchase.",
          "replayed",
        );
      }
      await client.query("COMMIT");
      return {
        verified: true,
        plan: payment.plan,
        walletAddress: payment.walletAddress,
        transactionHash: payment.transactionHash,
        amountEth: payment.amountEth,
        usdCents: payment.usdCents,
        paidUntil: row.paid_until ? new Date(row.paid_until).toISOString() : null,
        destination: definition.destination,
        alreadyRecorded: true,
      };
    }

    await client.query(
      `INSERT INTO subscriptions (
         wallet_address,
         tier,
         status,
         started_at,
         expires_at,
         payment_tx_hash,
         amount_eth,
         created_at
       ) VALUES ($1, $2, 'active', $3, $4, $5, $6, $3)
       ON CONFLICT (wallet_address) DO UPDATE
         SET tier = EXCLUDED.tier,
             status = 'active',
             expires_at = EXCLUDED.expires_at,
             payment_tx_hash = EXCLUDED.payment_tx_hash,
             amount_eth = EXCLUDED.amount_eth,
             created_at = EXCLUDED.created_at`,
      [
        payment.walletAddress.toLowerCase(),
        definition.subscriptionTier,
        now,
        paidUntil,
        payment.transactionHash.toLowerCase(),
        payment.amountEth,
      ],
    );

    await client.query(
      `INSERT INTO admin_activity_log (event_kind, service_key, message, created_at)
       VALUES ('payment-received', NULL, $1, $2)`,
      [
        `${definition.label} payment verified: $${(payment.usdCents / 100).toFixed(2)} · ${payment.amountEth} ETH · ${payment.walletAddress}`,
        now,
      ],
    );

    await client.query("COMMIT");
    return {
      verified: true,
      plan: payment.plan,
      walletAddress: payment.walletAddress,
      transactionHash: payment.transactionHash,
      amountEth: payment.amountEth,
      usdCents: payment.usdCents,
      paidUntil: paidUntil?.toISOString() ?? null,
      destination: definition.destination,
      alreadyRecorded: false,
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
  } = {},
): Promise<PlanPaymentVerification> {
  const verified = await verifyPlanPaymentTransaction(input, options.verifyDeps);
  return persistVerifiedPlanPayment(verified, options);
}
