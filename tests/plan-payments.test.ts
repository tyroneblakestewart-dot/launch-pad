import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Address, Hash } from "viem";
import { getPlanPaymentQuote } from "@/lib/server/plan-payment-config";
import {
  PlanPaymentError,
  persistVerifiedPlanPayment,
  verifyPlanPaymentTransaction,
  type ChainReceipt,
  type ChainTransaction,
  type PlanPaymentDatabaseClient,
} from "@/lib/server/plan-payments";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const TREASURY = "0x2222222222222222222222222222222222222222" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hash;

beforeEach(() => {
  process.env.HOODLUMS_TREASURY_ADDRESS = TREASURY;
  process.env.HOODLUMS_PAYMENT_RPC_URL = "https://rpc.example.test";
  process.env.HOODLUMS_PAYMENT_CHAIN_ID = "46630";
  process.env.HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI = "1000000000000000";
  process.env.HOODLUMS_PRO_AMOUNT_WEI = "5000000000000000";
  process.env.HOODLUMS_PRO_BUNDLE_AMOUNT_WEI = "12000000000000000";
});

afterEach(() => {
  delete process.env.HOODLUMS_TREASURY_ADDRESS;
  delete process.env.HOODLUMS_PAYMENT_RPC_URL;
  delete process.env.HOODLUMS_PAYMENT_CHAIN_ID;
  delete process.env.HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI;
  delete process.env.HOODLUMS_PRO_AMOUNT_WEI;
  delete process.env.HOODLUMS_PRO_BUNDLE_AMOUNT_WEI;
});

function chain(overrides: Partial<ChainTransaction> = {}, receipt: Partial<ChainReceipt> = {}) {
  return {
    getTransaction: async () => ({
      from: WALLET,
      to: TREASURY,
      value: 5_000_000_000_000_000n,
      input: "0x" as const,
      ...overrides,
    }),
    getReceipt: async () => ({
      status: "success" as const,
      blockNumber: 123n,
      ...receipt,
    }),
    getConfirmations: async () => 1n,
  };
}

describe("plan payment configuration", () => {
  it("keeps the treasury and exact ETH amounts in server environment values", () => {
    const quote = getPlanPaymentQuote("pro");
    expect(quote).toMatchObject({
      treasuryAddress: TREASURY,
      usdCents: 5_000,
      amountEth: "0.005",
      chainId: 46630,
    });
    expect(quote.amountWei).toBe("0x11c37937e08000");
  });

  it("fails closed when the treasury is not configured", () => {
    delete process.env.HOODLUMS_TREASURY_ADDRESS;
    expect(() => getPlanPaymentQuote("bond-pro-site")).toThrow(
      "HOODLUMS_TREASURY_ADDRESS is not configured",
    );
  });
});

describe("server-side chain verification", () => {
  it("accepts a confirmed direct payment from the selected wallet to the treasury", async () => {
    await expect(
      verifyPlanPaymentTransaction(
        { plan: "pro", walletAddress: WALLET, transactionHash: HASH },
        chain(),
      ),
    ).resolves.toMatchObject({
      plan: "pro",
      walletAddress: WALLET,
      transactionHash: HASH,
      amountWei: 5_000_000_000_000_000n,
      usdCents: 5_000,
    });
  });

  it("rejects a payment to any wallet other than the configured treasury", async () => {
    await expect(
      verifyPlanPaymentTransaction(
        { plan: "pro", walletAddress: WALLET, transactionHash: HASH },
        chain({ to: "0x3333333333333333333333333333333333333333" }),
      ),
    ).rejects.toMatchObject<Partial<PlanPaymentError>>({ code: "wrong-recipient" });
  });

  it("rejects underpayment and contract-call transactions", async () => {
    await expect(
      verifyPlanPaymentTransaction(
        { plan: "pro", walletAddress: WALLET, transactionHash: HASH },
        chain({ value: 1n }),
      ),
    ).rejects.toMatchObject<Partial<PlanPaymentError>>({ code: "underpaid" });

    await expect(
      verifyPlanPaymentTransaction(
        { plan: "pro", walletAddress: WALLET, transactionHash: HASH },
        chain({ input: "0x1234" }),
      ),
    ).rejects.toMatchObject<Partial<PlanPaymentError>>({ code: "wrong-transaction-type" });
  });

  it("never unlocks a reverted or unconfirmed transaction", async () => {
    await expect(
      verifyPlanPaymentTransaction(
        { plan: "pro", walletAddress: WALLET, transactionHash: HASH },
        chain({}, { status: "reverted" }),
      ),
    ).rejects.toMatchObject<Partial<PlanPaymentError>>({ code: "reverted" });
  });
});

type QueryResult = { rows: unknown[] };

function recordingClient(respond: (sql: string) => QueryResult): {
  client: PlanPaymentDatabaseClient;
  statements: string[];
} {
  const statements: string[] = [];
  return {
    statements,
    client: {
      query: (async (sql: string) => {
        statements.push(sql);
        return respond(sql);
      }) as PlanPaymentDatabaseClient["query"],
      release() {},
    },
  };
}

describe("durable payment recording", () => {
  it("records an immutable event, upserts subscriptions and gives monthly plans 30 days", async () => {
    const { client, statements } = recordingClient((sql) => {
      if (sql.includes("SELECT expires_at")) return { rows: [] };
      if (sql.includes("INSERT INTO plan_payment_events")) {
        return { rows: [{ wallet_address: WALLET, plan_id: "pro", paid_until: null }] };
      }
      return { rows: [] };
    });
    const now = new Date("2026-08-06T09:00:00.000Z");

    const result = await persistVerifiedPlanPayment(
      {
        plan: "pro",
        walletAddress: WALLET,
        transactionHash: HASH,
        amountWei: 5_000_000_000_000_000n,
        amountEth: "0.005",
        usdCents: 5_000,
        blockNumber: 123n,
      },
      { connect: async () => client, now },
    );

    expect(result).toMatchObject({
      verified: true,
      destination: "subscription-confirmation",
      paidUntil: "2026-09-05T09:00:00.000Z",
      alreadyRecorded: false,
    });
    expect(statements.some((sql) => sql.includes("INSERT INTO plan_payment_events"))).toBe(true);
    expect(statements.some((sql) => sql.includes("INSERT INTO subscriptions"))).toBe(true);
    expect(statements.some((sql) => sql.includes("payment-received"))).toBe(true);
  });

  it("treats the same transaction for the same plan and wallet as idempotent", async () => {
    const { client, statements } = recordingClient((sql) => {
      if (sql.includes("SELECT expires_at")) return { rows: [] };
      if (sql.includes("INSERT INTO plan_payment_events")) return { rows: [] };
      if (sql.includes("FROM plan_payment_events")) {
        return {
          rows: [{
            wallet_address: WALLET,
            plan_id: "pro",
            paid_until: "2026-09-05T09:00:00.000Z",
          }],
        };
      }
      return { rows: [] };
    });

    const result = await persistVerifiedPlanPayment(
      {
        plan: "pro",
        walletAddress: WALLET,
        transactionHash: HASH,
        amountWei: 5_000_000_000_000_000n,
        amountEth: "0.005",
        usdCents: 5_000,
        blockNumber: 123n,
      },
      { connect: async () => client, now: new Date("2026-08-06T09:00:00.000Z") },
    );

    expect(result.alreadyRecorded).toBe(true);
    expect(statements.some((sql) => sql.includes("INSERT INTO subscriptions"))).toBe(false);
  });
});
