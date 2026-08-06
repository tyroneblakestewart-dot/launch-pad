import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
  getPlanPaymentQuote,
  USDT_TRANSFER_ABI,
} from "@/lib/server/plan-payment-config";
import {
  persistVerifiedPlanPayment,
  verifyPlanPaymentTransaction,
  type ChainReceipt,
  type ChainTransaction,
  type PlanPaymentDatabaseClient,
} from "@/lib/server/plan-payments";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const TREASURY = "0x2222222222222222222222222222222222222222" as Address;
const USDT = "0x3333333333333333333333333333333333333333" as Address;
const OTHER = "0x4444444444444444444444444444444444444444" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hash;
const CHAIN_ID = 46630;
const USDT_DECIMALS = 6;
const PRO_MONTHLY_ATOMIC = 50_000_000n;

beforeEach(() => {
  process.env.HOODLUMS_TREASURY_ADDRESS = TREASURY;
  process.env.HOODLUMS_PAYMENT_RPC_URL = "https://rpc.example.test";
  process.env.HOODLUMS_PAYMENT_CHAIN_ID = String(CHAIN_ID);
  process.env.HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI = "1000000000000000";
  process.env.HOODLUMS_USDT_TOKEN_ADDRESS = USDT;
  process.env.HOODLUMS_USDT_DECIMALS = String(USDT_DECIMALS);
});

afterEach(() => {
  delete process.env.HOODLUMS_TREASURY_ADDRESS;
  delete process.env.HOODLUMS_PAYMENT_RPC_URL;
  delete process.env.HOODLUMS_PAYMENT_CHAIN_ID;
  delete process.env.HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI;
  delete process.env.HOODLUMS_USDT_TOKEN_ADDRESS;
  delete process.env.HOODLUMS_USDT_DECIMALS;
});

function transferInput(
  recipient: Address = TREASURY,
  amount: bigint = PRO_MONTHLY_ATOMIC,
): Hex {
  return encodeFunctionData({
    abi: USDT_TRANSFER_ABI,
    functionName: "transfer",
    args: [recipient, amount],
  });
}

function transferLog(input: {
  token?: Address;
  from?: Address;
  to?: Address;
  amount?: bigint;
} = {}) {
  const from = input.from ?? WALLET;
  const to = input.to ?? TREASURY;
  const amount = input.amount ?? PRO_MONTHLY_ATOMIC;
  return {
    address: input.token ?? USDT,
    topics: encodeEventTopics({
      abi: USDT_TRANSFER_ABI,
      eventName: "Transfer",
      args: { from, to },
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
  };
}

function usdtChain(
  overrides: Partial<ChainTransaction> = {},
  receipt: Partial<ChainReceipt> = {},
  chainId = CHAIN_ID,
  decimals = USDT_DECIMALS,
) {
  return {
    getChainId: async () => chainId,
    getTransaction: async () => ({
      from: WALLET,
      to: USDT,
      value: 0n,
      input: transferInput(),
      ...overrides,
    }),
    getReceipt: async () => ({
      status: "success" as const,
      blockNumber: 123n,
      logs: [transferLog()],
      ...receipt,
    }),
    getConfirmations: async () => 1n,
    getTokenDecimals: async () => decimals,
  };
}

function ethChain(
  overrides: Partial<ChainTransaction> = {},
  receipt: Partial<ChainReceipt> = {},
) {
  return {
    getChainId: async () => CHAIN_ID,
    getTransaction: async () => ({
      from: WALLET,
      to: TREASURY,
      value: 1_000_000_000_000_000n,
      input: "0x" as Hex,
      ...overrides,
    }),
    getReceipt: async () => ({
      status: "success" as const,
      blockNumber: 123n,
      logs: [],
      ...receipt,
    }),
    getConfirmations: async () => 1n,
    getTokenDecimals: async () => USDT_DECIMALS,
  };
}

describe("plan payment configuration", () => {
  it("builds an exact USDT transfer for a monthly Pro subscription", () => {
    const quote = getPlanPaymentQuote("pro", "monthly");
    expect(quote).toMatchObject({
      treasuryAddress: TREASURY,
      tokenAddress: USDT,
      tokenDecimals: USDT_DECIMALS,
      asset: "USDT",
      billingPeriod: "monthly",
      subscriptionDays: 32,
      usdCents: 5_000,
      amountDisplay: "50",
      transactionTo: USDT,
      transactionValue: "0x0",
      chainId: CHAIN_ID,
    });
    expect(BigInt(quote.amountAtomic)).toBe(PRO_MONTHLY_ATOMIC);
    expect(quote.transactionData).toBe(transferInput());
  });

  it("quotes the approved 3-month upfront prices and 96-day windows", () => {
    expect(getPlanPaymentQuote("pro", "upfront")).toMatchObject({
      asset: "USDT",
      amountDisplay: "120",
      usdCents: 12_000,
      subscriptionDays: 96,
    });
    expect(getPlanPaymentQuote("pro-bundle", "upfront")).toMatchObject({
      asset: "USDT",
      amountDisplay: "288",
      usdCents: 28_800,
      subscriptionDays: 96,
    });
  });

  it("keeps Bond + Pro Site as a server-priced one-off ETH payment", () => {
    expect(getPlanPaymentQuote("bond-pro-site")).toMatchObject({
      asset: "ETH",
      billingPeriod: "one_off",
      subscriptionDays: null,
      amountDisplay: "0.001",
      transactionTo: TREASURY,
      transactionData: "0x",
    });
  });

  it("fails closed when USDT address or decimals are not configured", () => {
    delete process.env.HOODLUMS_USDT_TOKEN_ADDRESS;
    expect(() => getPlanPaymentQuote("pro")).toThrow(
      "HOODLUMS_USDT_TOKEN_ADDRESS is not configured",
    );
    process.env.HOODLUMS_USDT_TOKEN_ADDRESS = USDT;
    delete process.env.HOODLUMS_USDT_DECIMALS;
    expect(() => getPlanPaymentQuote("pro")).toThrow(
      "HOODLUMS_USDT_DECIMALS is not configured",
    );
  });
});

describe("server-side USDT verification", () => {
  it("accepts a confirmed exact transfer and matching Transfer event", async () => {
    await expect(
      verifyPlanPaymentTransaction(
        {
          plan: "pro",
          billingPeriod: "monthly",
          walletAddress: WALLET,
          transactionHash: HASH,
        },
        usdtChain(),
      ),
    ).resolves.toMatchObject({
      plan: "pro",
      billingPeriod: "monthly",
      walletAddress: WALLET,
      transactionHash: HASH,
      asset: "USDT",
      tokenAddress: USDT,
      amountAtomic: PRO_MONTHLY_ATOMIC,
      amountDisplay: "50",
      amountEth: null,
      usdCents: 5_000,
      subscriptionDays: 32,
      chainId: CHAIN_ID,
    });
  });

  it("rejects a wrong chain, token contract or token decimals", async () => {
    await expect(
      verifyPlanPaymentTransaction(
        { plan: "pro", walletAddress: WALLET, transactionHash: HASH },
        usdtChain({}, {}, 1),
      ),
    ).rejects.toMatchObject({ code: "wrong-chain" });

    await expect(
      verifyPlanPaymentTransaction(
        { plan: "pro", walletAddress: WALLET, transactionHash: HASH },
        usdtChain({ to: OTHER }),
      ),
    ).rejects.toMatchObject({ code: "wrong-token" });

    await expect(
      verifyPlanPaymentTransaction(
        { plan: "pro", walletAddress: WALLET, transactionHash: HASH },
        usdtChain({}, {}, CHAIN_ID, 18),
      ),
    ).rejects.toMatchObject({ code: "wrong-token-decimals" });
  });

  it("rejects wrong recipient, amount, sender and native value", async () => {
    await expect(
      verifyPlanPaymentTransaction(
        { plan: "pro", walletAddress: WALLET, transactionHash: HASH },
        usdtChain({ input: transferInput(OTHER) }),
      ),
    ).rejects.toMatchObject({ code: "wrong-recipient" });

    await expect(
      verifyPlanPaymentTransaction(
        { plan: "pro", walletAddress: WALLET, transactionHash: HASH },
        usdtChain({ input: transferInput(TREASURY, 1n) }),
      ),
    ).rejects.toMatchObject({ code: "underpaid" });

    await expect(
      verifyPlanPaymentTransaction(
        { plan: "pro", walletAddress: WALLET, transactionHash: HASH },
        usdtChain({ from: OTHER }),
      ),
    ).rejects.toMatchObject({ code: "wrong-sender" });

    await expect(
      verifyPlanPaymentTransaction(
        { plan: "pro", walletAddress: WALLET, transactionHash: HASH },
        usdtChain({ value: 1n }),
      ),
    ).rejects.toMatchObject({ code: "wrong-transaction-type" });
  });

  it("requires the matching token Transfer event in the confirmed receipt", async () => {
    await expect(
      verifyPlanPaymentTransaction(
        { plan: "pro", walletAddress: WALLET, transactionHash: HASH },
        usdtChain({}, { logs: [transferLog({ to: OTHER })] }),
      ),
    ).rejects.toMatchObject({ code: "missing-transfer-log" });
  });

  it("still verifies the one-off ETH plan independently", async () => {
    await expect(
      verifyPlanPaymentTransaction(
        { plan: "bond-pro-site", walletAddress: WALLET, transactionHash: HASH },
        ethChain(),
      ),
    ).resolves.toMatchObject({
      asset: "ETH",
      amountDisplay: "0.001",
      usdCents: 1_000,
      subscriptionDays: null,
    });
  });
});

type QueryResult = { rows: unknown[]; rowCount?: number };

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

function verifiedSubscription(
  billingPeriod: "monthly" | "upfront" = "monthly",
) {
  return {
    plan: "pro" as const,
    billingPeriod,
    walletAddress: WALLET,
    transactionHash: HASH,
    asset: "USDT" as const,
    tokenAddress: USDT,
    amountAtomic: billingPeriod === "upfront" ? 120_000_000n : PRO_MONTHLY_ATOMIC,
    amountDisplay: billingPeriod === "upfront" ? "120" : "50",
    amountEth: null,
    usdCents: billingPeriod === "upfront" ? 12_000 : 5_000,
    subscriptionDays: billingPeriod === "upfront" ? 96 : 32,
    chainId: CHAIN_ID,
    blockNumber: 123n,
  };
}

describe("durable subscription recording", () => {
  it("starts an expired/new monthly subscription from payment time for 32 days", async () => {
    const { client, statements } = recordingClient((sql) => {
      if (sql.includes("SELECT paid_until, expires_at")) return { rows: [] };
      if (sql.includes("INSERT INTO plan_payment_events")) {
        return {
          rows: [{
            wallet_address: WALLET,
            plan_id: "pro",
            billing_period: "monthly",
            paid_from: null,
            paid_until: null,
          }],
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const now = new Date("2026-08-06T09:00:00.000Z");

    const result = await persistVerifiedPlanPayment(
      verifiedSubscription(),
      { connect: async () => client, now },
    );

    expect(result).toMatchObject({
      verified: true,
      asset: "USDT",
      billingPeriod: "monthly",
      paidFrom: "2026-08-06T09:00:00.000Z",
      paidUntil: "2026-09-07T09:00:00.000Z",
      subscriptionStatus: "active",
      destination: "subscription-confirmation",
      alreadyRecorded: false,
    });
    expect(statements.some((sql) => sql.includes("billing_period"))).toBe(true);
    expect(statements.some((sql) => sql.includes("INSERT INTO subscriptions"))).toBe(true);
    expect(statements.some((sql) => sql.includes("payment-received"))).toBe(true);
  });

  it("extends an early renewal from the current paid_until", async () => {
    const { client } = recordingClient((sql) => {
      if (sql.includes("SELECT paid_until, expires_at")) {
        return { rows: [{ paid_until: "2026-08-20T09:00:00.000Z", expires_at: null }] };
      }
      if (sql.includes("INSERT INTO plan_payment_events")) {
        return {
          rows: [{
            wallet_address: WALLET,
            plan_id: "pro",
            billing_period: "monthly",
            paid_from: null,
            paid_until: null,
          }],
        };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await persistVerifiedPlanPayment(
      verifiedSubscription(),
      {
        connect: async () => client,
        now: new Date("2026-08-06T09:00:00.000Z"),
      },
    );

    expect(result.paidFrom).toBe("2026-08-20T09:00:00.000Z");
    expect(result.paidUntil).toBe("2026-09-21T09:00:00.000Z");
  });

  it("grants 96 days for the upfront option", async () => {
    const { client } = recordingClient((sql) => {
      if (sql.includes("SELECT paid_until, expires_at")) return { rows: [] };
      if (sql.includes("INSERT INTO plan_payment_events")) {
        return {
          rows: [{
            wallet_address: WALLET,
            plan_id: "pro",
            billing_period: "upfront",
            paid_from: null,
            paid_until: null,
          }],
        };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await persistVerifiedPlanPayment(
      verifiedSubscription("upfront"),
      {
        connect: async () => client,
        now: new Date("2026-08-06T09:00:00.000Z"),
      },
    );

    expect(result.paidUntil).toBe("2026-11-10T09:00:00.000Z");
  });

  it("treats the same hash, wallet, plan and billing period as idempotent", async () => {
    const { client, statements } = recordingClient((sql) => {
      if (sql.includes("SELECT paid_until, expires_at")) return { rows: [] };
      if (sql.includes("INSERT INTO plan_payment_events")) return { rows: [] };
      if (sql.includes("FROM plan_payment_events")) {
        return {
          rows: [{
            wallet_address: WALLET,
            plan_id: "pro",
            billing_period: "monthly",
            paid_from: "2026-08-06T09:00:00.000Z",
            paid_until: "2026-09-07T09:00:00.000Z",
          }],
        };
      }
      return { rows: [] };
    });

    const result = await persistVerifiedPlanPayment(
      verifiedSubscription(),
      {
        connect: async () => client,
        now: new Date("2026-08-06T09:00:00.000Z"),
      },
    );

    expect(result.alreadyRecorded).toBe(true);
    expect(result.paidUntil).toBe("2026-09-07T09:00:00.000Z");
    expect(statements.some((sql) => sql.includes("INSERT INTO subscriptions"))).toBe(false);
  });
});
