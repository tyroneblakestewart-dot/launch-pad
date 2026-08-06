import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  type Address,
  type Hash,
} from "viem";
import { buildPlanPaymentProofMessage } from "@/lib/plan-payment-proof";
import {
  ERC20_TRANSFER_ABI,
  getConfiguredPaymentTokens,
  getPlanPaymentQuote,
} from "@/lib/server/plan-payment-config";
import {
  persistVerifiedPlanPayment,
  verifyPlanPaymentTransaction,
  type PlanPaymentDatabaseClient,
} from "@/lib/server/plan-payments";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const TREASURY = "0x2222222222222222222222222222222222222222" as Address;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
const USDT = "0x3333333333333333333333333333333333333333" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hash;

function tokenJson(usdtEnabled = false): string {
  return JSON.stringify([
    {
      symbol: "USDG",
      contractAddress: USDG,
      decimals: 6,
      enabled: true,
      note: "Paxos-issued Global Dollar",
    },
    {
      symbol: "USDT",
      contractAddress: usdtEnabled ? USDT : null,
      decimals: usdtEnabled ? 6 : null,
      enabled: usdtEnabled,
      note: usdtEnabled
        ? "Verified test fixture"
        : "Disabled: no canonical liquid USDT verified on Robinhood Chain",
    },
  ]);
}

function environment(usdtEnabled = false): Record<string, string | undefined> {
  return {
    HOODLUMS_TREASURY_ADDRESS: TREASURY,
    HOODLUMS_PAYMENT_RPC_URL: "https://rpc.mainnet.chain.robinhood.com",
    HOODLUMS_PAYMENT_CHAIN_ID: "4663",
    HOODLUMS_PAYMENT_CHAIN_NAME: "Robinhood Chain",
    HOODLUMS_PAYMENT_EXPLORER_URL: "https://robinhoodchain.blockscout.com",
    HOODLUMS_PAYMENT_TOKENS_JSON: tokenJson(usdtEnabled),
    HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI: "1000000000000000",
  };
}

describe("multi-stablecoin configuration", () => {
  it("exposes only enabled tokens and defaults subscriptions to USDG", () => {
    const env = environment(false);
    const tokens = getConfiguredPaymentTokens(env);
    expect(tokens).toMatchObject([
      { symbol: "USDG", enabled: true, contractAddress: USDG, decimals: 6 },
      { symbol: "USDT", enabled: false, contractAddress: null, decimals: null },
    ]);

    const quote = getPlanPaymentQuote("pro", "monthly", undefined, env);
    expect(quote).toMatchObject({
      asset: "USDG",
      tokenAddress: USDG,
      tokenDecimals: 6,
      amountDisplay: "50",
      chainId: 4663,
      explorerBaseUrl: "https://robinhoodchain.blockscout.com",
      paymentTokens: [
        { symbol: "USDG", contractAddress: USDG, decimals: 6 },
      ],
    });
  });

  it("rejects a disabled token with its configuration note", () => {
    expect(() =>
      getPlanPaymentQuote("pro", "monthly", "USDT", environment(false)),
    ).toThrow("Payment token USDT is disabled");
  });

  it("quotes the same dollar amount through another enabled token", () => {
    const usdg = getPlanPaymentQuote("pro-bundle", "upfront", "USDG", environment(true));
    const usdt = getPlanPaymentQuote("pro-bundle", "upfront", "USDT", environment(true));

    expect(usdg).toMatchObject({ asset: "USDG", amountDisplay: "288", usdCents: 28_800 });
    expect(usdt).toMatchObject({ asset: "USDT", amountDisplay: "288", usdCents: 28_800 });
    expect(usdg.transactionTo).toBe(USDG);
    expect(usdt.transactionTo).toBe(USDT);
  });
});

describe("token-bound proof and on-chain verification", () => {
  it("cannot reuse a wallet proof for another stablecoin", () => {
    const common = {
      plan: "pro" as const,
      billingPeriod: "monthly" as const,
      walletAddress: WALLET,
      transactionHash: HASH,
      origin: "https://hoodlums.dev",
    };
    const usdg = buildPlanPaymentProofMessage({ ...common, paymentToken: "USDG" });
    const usdt = buildPlanPaymentProofMessage({ ...common, paymentToken: "USDT" });
    expect(usdg).toContain("Token: USDG");
    expect(usdt).toContain("Token: USDT");
    expect(usdg).not.toBe(usdt);
  });

  it("accepts the selected token contract, decimals, calldata and Transfer event", async () => {
    const amount = 50_000_000n;
    const input = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [TREASURY, amount],
    });
    const log = {
      address: USDG,
      topics: encodeEventTopics({
        abi: ERC20_TRANSFER_ABI,
        eventName: "Transfer",
        args: { from: WALLET, to: TREASURY },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    };

    await expect(
      verifyPlanPaymentTransaction(
        {
          plan: "pro",
          billingPeriod: "monthly",
          paymentToken: "USDG",
          walletAddress: WALLET,
          transactionHash: HASH,
        },
        {
          environment: environment(true),
          getChainId: async () => 4663,
          getTransaction: async () => ({
            from: WALLET,
            to: USDG,
            value: 0n,
            input,
          }),
          getReceipt: async () => ({
            status: "success",
            blockNumber: 123n,
            logs: [log],
          }),
          getConfirmations: async () => 1n,
          getTokenDecimals: async () => 6,
        },
      ),
    ).resolves.toMatchObject({
      asset: "USDG",
      tokenAddress: USDG,
      amountAtomic: amount,
      amountDisplay: "50",
      chainId: 4663,
    });
  });

  it("rejects a transaction sent to a different configured token", async () => {
    const amount = 50_000_000n;
    await expect(
      verifyPlanPaymentTransaction(
        {
          plan: "pro",
          paymentToken: "USDG",
          walletAddress: WALLET,
          transactionHash: HASH,
        },
        {
          environment: environment(true),
          getChainId: async () => 4663,
          getTransaction: async () => ({
            from: WALLET,
            to: USDT,
            value: 0n,
            input: encodeFunctionData({
              abi: ERC20_TRANSFER_ABI,
              functionName: "transfer",
              args: [TREASURY, amount],
            }),
          }),
          getReceipt: async () => ({ status: "success", blockNumber: 123n, logs: [] }),
          getConfirmations: async () => 1n,
          getTokenDecimals: async () => 6,
        },
      ),
    ).rejects.toMatchObject({ code: "wrong-token" });
  });
});

describe("cross-token replay protection", () => {
  it("does not treat a transaction recorded for USDT as idempotent for USDG", async () => {
    const statements: string[] = [];
    const client: PlanPaymentDatabaseClient = {
      query: (async (sql: string) => {
        statements.push(sql);
        if (sql.includes("SELECT paid_until, expires_at")) return { rows: [] };
        if (sql.includes("INSERT INTO plan_payment_events")) return { rows: [] };
        if (sql.includes("FROM plan_payment_events")) {
          return {
            rows: [{
              wallet_address: WALLET,
              plan_id: "pro",
              billing_period: "monthly",
              asset_symbol: "USDT",
              asset_contract: USDT,
              paid_from: null,
              paid_until: null,
            }],
          };
        }
        return { rows: [], rowCount: 1 };
      }) as PlanPaymentDatabaseClient["query"],
      release() {},
    };

    await expect(
      persistVerifiedPlanPayment(
        {
          plan: "pro",
          billingPeriod: "monthly",
          walletAddress: WALLET,
          transactionHash: HASH,
          asset: "USDG",
          tokenAddress: USDG,
          amountAtomic: 50_000_000n,
          amountDisplay: "50",
          amountEth: null,
          usdCents: 5_000,
          subscriptionDays: 32,
          chainId: 4663,
          blockNumber: 123n,
        },
        { connect: async () => client, now: new Date("2026-08-06T12:00:00.000Z") },
      ),
    ).rejects.toMatchObject({ code: "replayed" });
    expect(statements.some((sql) => sql.includes("ROLLBACK"))).toBe(true);
  });
});
