import { afterEach, describe, expect, it, vi } from "vitest";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import {
  MAX_SNIPER_BALANCE_READS,
  SNIPER_WINDOW_BLOCKS,
  TokenHolderStatsReadError,
  getTokenHolderBreakdown,
  getTokenHolderStatsReadHealth,
  resetTokenHolderStatsForTests,
  selectSniperWallets,
  shareOfSupplyPercent,
  sumTopHolderBalances,
} from "@/lib/server/token-holder-stats";
import {
  resetTokenLaunchesStoreForTests,
  setTokenLaunchesStoreForTests,
  type TokenLaunch,
  type TokenLaunchesStore,
} from "@/lib/server/token-launches-store";
import { resetTokenTradesRpcForTests, type TokenTradesReadClient } from "@/lib/server/token-trades-rpc";
import type { TokenTrade } from "@/lib/token-trade-types";

const TOKEN = "0xaaaa00000000000000000000000000000000000a";
const CURVE = "0x1234567890123456789012345678901234567890";
const POOL = "0xffff00000000000000000000000000000000000f";
const CREATOR = "0xcccc00000000000000000000000000000000000c";
const SNIPER_A = "0xa100000000000000000000000000000000000001";
const SNIPER_C = "0xc300000000000000000000000000000000000003";
const LATE_B = "0xb200000000000000000000000000000000000002";
const WHALE_D = "0xd400000000000000000000000000000000000004";

const LATEST_BLOCK = 1000n;
const FUNDED_BLOCK = 150n;
const TOTAL_SUPPLY = 1_000_000n;

function launch(overrides: Partial<TokenLaunch> = {}): TokenLaunch {
  return {
    id: "launch-1",
    chainId: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
    tokenAddress: TOKEN,
    curveAddress: CURVE,
    creatorWalletAddress: CREATOR,
    tokenName: "Test",
    ticker: "TST",
    decimals: 18,
    wholeTokenSupply: "1000000",
    graduationTargetWei: "10000000000000000",
    graduated: false,
    graduatedAt: null,
    launchedAt: "2026-01-01T00:00:00.000Z",
    artworkThumbnail: null,
    ...overrides,
  };
}

function fakeLaunchesStore(overrides: Partial<TokenLaunchesStore> = {}): TokenLaunchesStore {
  return {
    async record() {
      throw new Error("not used");
    },
    async list() {
      return [];
    },
    async listForAdmin() {
      return [];
    },
    async findByTokenAddress() {
      return launch();
    },
    async findTokenLaunchCreatedAtByCurveAddress() {
      return null;
    },
    async findTokenLaunchGraduatedAtByCurveAddress() {
      return null;
    },
    async markGraduated() {},
    async countLast24h() {
      return 0;
    },
    async tableExists() {
      return true;
    },
    ...overrides,
  };
}

function buy(wallet: string, blockNumber: bigint, overrides: Partial<TokenTrade> = {}): TokenTrade {
  return {
    direction: "buy",
    wallet: wallet as `0x${string}`,
    tokenAmountRaw: "1",
    nativeAmountRaw: "1",
    blockNumber: blockNumber.toString(),
    blockTimestamp: 1_700_000_000 + Number(blockNumber),
    txHash: `0xTX${wallet.slice(2, 6)}${blockNumber}` as `0x${string}`,
    logIndex: 0,
    venue: "curve",
    ...overrides,
  };
}

const TRADES: TokenTrade[] = [
  buy(SNIPER_A, FUNDED_BLOCK + 5n),
  // First buy just outside the window — not a sniper.
  buy(LATE_B, FUNDED_BLOCK + SNIPER_WINDOW_BLOCKS + 1n),
  // First buy inside the window, later buy far outside — still a sniper (first buy decides).
  buy(SNIPER_C, FUNDED_BLOCK + 8n),
  buy(SNIPER_C, 300n),
  // A sell by a sniper never affects sniper membership.
  { ...buy(SNIPER_A, 320n), direction: "sell" },
];

type FakeClientOptions = {
  curveToken?: string;
  liquidityPool?: string;
  balances?: Record<string, bigint>;
  fundedLogs?: unknown[];
  totalSupply?: bigint;
  failReads?: boolean;
};

function fakeClient(options: FakeClientOptions = {}) {
  const {
    curveToken = TOKEN,
    liquidityPool = "0x0000000000000000000000000000000000000000",
    balances = { [CREATOR]: 42_000n, [SNIPER_A]: 100_000n, [SNIPER_C]: 50_000n, [LATE_B]: 10_000n },
    fundedLogs = [{ eventName: "CurveFunded", args: { creator: CREATOR, tokenAmount: TOTAL_SUPPLY }, blockNumber: FUNDED_BLOCK }],
    totalSupply = TOTAL_SUPPLY,
    failReads = false,
  } = options;

  const readContract = vi.fn(async ({ functionName, args }: { address: string; functionName: string; args?: unknown[] }) => {
    if (failReads) throw new Error("RPC down");
    switch (functionName) {
      case "token":
        return curveToken;
      case "creator":
        return CREATOR;
      case "liquidityPool":
        return liquidityPool;
      case "totalSupply":
        return totalSupply;
      case "balanceOf": {
        const wallet = String(args?.[0]).toLowerCase();
        return balances[wallet] ?? 0n;
      }
      default:
        throw new Error(`unexpected read ${functionName}`);
    }
  });
  const getLogs = vi.fn(async () => fundedLogs);
  const getBlockNumber = vi.fn(async () => LATEST_BLOCK);
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
    number: blockNumber,
    timestamp: 1_700_000_000n + blockNumber,
  }));
  const client = { readContract, getLogs, getBlockNumber, getBlock } as unknown as TokenTradesReadClient;
  return { client, readContract, getLogs, getBlockNumber, getBlock };
}

const HOLDER_ITEMS = [
  { address: { hash: CURVE }, value: "700000" },
  { address: { hash: SNIPER_A }, value: "100000" },
  { address: { hash: SNIPER_C }, value: "50000" },
  { address: { hash: CREATOR }, value: "42000" },
  { address: { hash: WHALE_D }, value: "20000" },
  { address: { hash: LATE_B }, value: "10000" },
];

afterEach(() => {
  resetTokenHolderStatsForTests();
  resetTokenTradesRpcForTests();
  resetTokenLaunchesStoreForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("shareOfSupplyPercent", () => {
  it("scales a bigint share to 0–100 with two decimals kept", () => {
    expect(shareOfSupplyPercent(42_000n, 1_000_000n)).toBe(4.2);
    expect(shareOfSupplyPercent(184_321n, 1_000_000n)).toBe(18.43);
    expect(shareOfSupplyPercent(0n, 1_000_000n)).toBe(0);
    expect(shareOfSupplyPercent(1_000_000n, 1_000_000n)).toBe(100);
  });

  it("never divides by a zero or negative supply", () => {
    expect(shareOfSupplyPercent(5n, 0n)).toBeNull();
    expect(shareOfSupplyPercent(-1n, 100n)).toBeNull();
  });

  it("stays exact on 18-decimal raw amounts where a float would not", () => {
    const supply = 1_000_000_000n * 10n ** 18n;
    const part = 184_000_000n * 10n ** 18n + 123n;
    expect(shareOfSupplyPercent(part, supply)).toBe(18.4);
  });
});

describe("sumTopHolderBalances", () => {
  it("excludes the curve/pool addresses (case-insensitively) and sums the ten largest remaining balances", () => {
    const items = [
      { address: { hash: CURVE.toUpperCase().replace("0X", "0x") }, value: "700000" },
      ...Array.from({ length: 12 }, (_, index) => ({
        address: { hash: `0x${(index + 1).toString(16).padStart(40, "0")}` },
        value: String((index + 1) * 1000),
      })),
    ];
    const sum = sumTopHolderBalances(items, new Set([CURVE.toLowerCase()]));
    // Balances 3000..12000 (the ten largest of 1000..12000): 10 * (3000 + 12000) / 2.
    expect(sum).toBe(75_000n);
  });

  it("returns null when nobody but the excluded addresses holds anything (a brand-new token)", () => {
    expect(sumTopHolderBalances([{ address: { hash: CURVE }, value: "700000" }], new Set([CURVE.toLowerCase()]))).toBeNull();
    expect(sumTopHolderBalances([], new Set())).toBeNull();
  });

  it("ignores malformed items and zero balances rather than throwing", () => {
    const items = [
      { address: {}, value: "5" },
      { address: { hash: WHALE_D }, value: "not-a-number" },
      { address: { hash: SNIPER_A }, value: "0" },
      { address: { hash: LATE_B }, value: "10" },
    ];
    expect(sumTopHolderBalances(items, new Set())).toBe(10n);
  });
});

describe("selectSniperWallets", () => {
  it("keeps wallets whose FIRST curve buy is within the 10-block window, earliest first", () => {
    expect(selectSniperWallets(TRADES, FUNDED_BLOCK)).toEqual([SNIPER_A, SNIPER_C]);
  });

  it("counts a buy exactly at the window edge, not one block past it", () => {
    const edge = buy("0xe500000000000000000000000000000000000005", FUNDED_BLOCK + SNIPER_WINDOW_BLOCKS);
    const past = buy("0xf600000000000000000000000000000000000006", FUNDED_BLOCK + SNIPER_WINDOW_BLOCKS + 1n);
    expect(selectSniperWallets([past, edge], FUNDED_BLOCK)).toEqual([edge.wallet]);
  });

  it("ignores post-graduation pool swaps and sells entirely", () => {
    const poolBuy = buy(WHALE_D, FUNDED_BLOCK + 1n, { venue: "pool" });
    const sell: TokenTrade = { ...buy(LATE_B, FUNDED_BLOCK + 1n), direction: "sell" };
    expect(selectSniperWallets([poolBuy, sell], FUNDED_BLOCK)).toEqual([]);
  });

  it("dedupes a wallet by case", () => {
    const upper = buy(SNIPER_A.toUpperCase().replace("0X", "0x"), FUNDED_BLOCK + 2n);
    expect(selectSniperWallets([buy(SNIPER_A, FUNDED_BLOCK + 3n), upper], FUNDED_BLOCK)).toHaveLength(1);
  });
});

describe("getTokenHolderBreakdown", () => {
  it("computes Top 10 % (curve excluded), Dev % and Snipers % from real balances over the live total supply", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const { client, readContract } = fakeClient();
    const readTrades = vi.fn(async () => TRADES);
    const fetchHolders = vi.fn(async () => HOLDER_ITEMS);

    const stats = await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, {
      client,
      now: 1_000,
      readTrades,
      fetchHolders,
    });

    // Every holder except the curve: 100000 + 50000 + 42000 + 20000 + 10000 = 222000 → 22.2%.
    expect(stats.top10Percent).toBe(22.2);
    expect(stats.devPercent).toBe(4.2);
    // Snipers A (100000) + C (50000) → 15%.
    expect(stats.snipersPercent).toBe(15);
    expect(stats.sniperWalletCount).toBe(2);
    expect(stats.curveAddress).toBe(CURVE);
    expect(stats.liquidityPoolAddress).toBeNull();

    expect(readTrades).toHaveBeenCalledWith(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE);
    expect(fetchHolders).toHaveBeenCalledWith(TOKEN);
    // Balances read on-chain for the creator and each sniper — never the late buyer.
    const balanceReads = readContract.mock.calls
      .map(([call]) => call as { functionName: string; args?: unknown[] })
      .filter((call) => call.functionName === "balanceOf")
      .map((call) => String(call.args?.[0]).toLowerCase());
    expect(balanceReads.sort()).toEqual([CREATOR, SNIPER_A, SNIPER_C].sort());
  });

  it("excludes the graduated liquidity pool from Top 10 alongside the curve and reports it", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const { client } = fakeClient({ liquidityPool: POOL });
    const stats = await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, {
      client,
      readTrades: async () => TRADES,
      fetchHolders: async () => [{ address: { hash: POOL }, value: "500000" }, ...HOLDER_ITEMS],
    });
    expect(stats.top10Percent).toBe(22.2);
    expect(stats.liquidityPoolAddress).toBe(POOL);
  });

  it("nulls Top 10 % only when the explorer's holder list is unavailable — Dev/Snipers still come from the chain", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const { client } = fakeClient();
    const stats = await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, {
      client,
      readTrades: async () => TRADES,
      fetchHolders: async () => null,
    });
    expect(stats.top10Percent).toBeNull();
    expect(stats.devPercent).toBe(4.2);
    expect(stats.snipersPercent).toBe(15);
  });

  it("treats a thrown explorer fetch the same as an unavailable one", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const { client } = fakeClient();
    const stats = await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, {
      client,
      readTrades: async () => TRADES,
      fetchHolders: async () => {
        throw new Error("blockscout down");
      },
    });
    expect(stats.top10Percent).toBeNull();
    expect(stats.devPercent).toBe(4.2);
  });

  it("reports Top 10 as null (not 0) for a brand-new token whose only holder is the curve, and Dev/Snipers as a real 0.0", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const { client } = fakeClient({ balances: {} });
    const stats = await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, {
      client,
      readTrades: async () => [],
      fetchHolders: async () => [{ address: { hash: CURVE }, value: TOTAL_SUPPLY.toString() }],
    });
    expect(stats.top10Percent).toBeNull();
    expect(stats.devPercent).toBe(0);
    expect(stats.snipersPercent).toBe(0);
    expect(stats.sniperWalletCount).toBe(0);
  });

  it("nulls Snipers % when the CurveFunded event cannot be found, keeping Dev %", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const { client } = fakeClient({ fundedLogs: [] });
    const stats = await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, {
      client,
      readTrades: async () => TRADES,
      fetchHolders: async () => HOLDER_ITEMS,
    });
    expect(stats.snipersPercent).toBeNull();
    expect(stats.sniperWalletCount).toBe(0);
    expect(stats.devPercent).toBe(4.2);
  });

  it("refuses to trust a resolved curve whose token() is a different token — Dev/Snipers null, curve not excluded", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const { client } = fakeClient({ curveToken: "0x9999000000000000000000000000000000000009" });
    const readTrades = vi.fn(async () => TRADES);
    const stats = await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, {
      client,
      readTrades,
      fetchHolders: async () => HOLDER_ITEMS,
    });
    expect(stats.curveAddress).toBeNull();
    expect(stats.devPercent).toBeNull();
    expect(stats.snipersPercent).toBeNull();
    // With no verified curve there is nothing to exclude: 700000 + 222000 → 92.2%.
    expect(stats.top10Percent).toBe(92.2);
    expect(readTrades).not.toHaveBeenCalled();
  });

  it("handles a token with no curve at all (no launch record, no legacy env curve)", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore({ findByTokenAddress: async () => null }));
    vi.stubEnv("NEXT_PUBLIC_HOODLUMS_BONDING_CURVE_ADDRESSES", "");
    const { client, readContract } = fakeClient();
    const stats = await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, {
      client,
      readTrades: async () => TRADES,
      fetchHolders: async () => HOLDER_ITEMS,
    });
    expect(stats.curveAddress).toBeNull();
    expect(stats.devPercent).toBeNull();
    expect(stats.snipersPercent).toBeNull();
    expect(stats.top10Percent).toBe(92.2);
    const functionNames = readContract.mock.calls.map(([call]) => (call as { functionName: string }).functionName);
    expect(functionNames).toEqual(["totalSupply"]);
  });

  it("caps sniper balance reads at MAX_SNIPER_BALANCE_READS, keeping the earliest first buys", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const { client, readContract } = fakeClient({ balances: {} });
    const manyBuyers: TokenTrade[] = Array.from({ length: MAX_SNIPER_BALANCE_READS + 20 }, (_, index) =>
      buy(`0x${(index + 1).toString(16).padStart(40, "0")}`, FUNDED_BLOCK + BigInt(index % 10)),
    );
    const stats = await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, {
      client,
      readTrades: async () => manyBuyers,
      fetchHolders: async () => null,
    });
    expect(stats.sniperWalletCount).toBe(MAX_SNIPER_BALANCE_READS);
    const balanceReads = readContract.mock.calls.filter(
      ([call]) => (call as { functionName: string }).functionName === "balanceOf",
    );
    // creator + capped snipers
    expect(balanceReads).toHaveLength(MAX_SNIPER_BALANCE_READS + 1);
  });

  it("caches a read for ~60s and shares one in-flight read between concurrent callers", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const { client, readContract } = fakeClient();
    const fetchHolders = vi.fn(async () => HOLDER_ITEMS);
    const deps = { client, readTrades: async () => TRADES, fetchHolders };

    const [first, second] = await Promise.all([
      getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, { ...deps, now: 1_000 }),
      getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, { ...deps, now: 1_000 }),
    ]);
    expect(second).toBe(first);
    expect(fetchHolders).toHaveBeenCalledTimes(1);

    const readsAfterFirst = readContract.mock.calls.length;
    const cached = await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, { ...deps, now: 50_000 });
    expect(cached).toBe(first);
    expect(readContract.mock.calls.length).toBe(readsAfterFirst);

    await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, { ...deps, now: 61_001 });
    expect(fetchHolders).toHaveBeenCalledTimes(2);
  });

  it("caches the CurveFunded block per curve so later refreshes skip the log query", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const { client, getLogs } = fakeClient();
    const deps = { client, readTrades: async () => TRADES, fetchHolders: async () => HOLDER_ITEMS };
    await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, { ...deps, now: 1_000 });
    await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, { ...deps, now: 200_000 });
    expect(getLogs).toHaveBeenCalledTimes(1);
  });

  it("throws TokenHolderStatsReadError on a genuine chain-read failure and records it in the read health", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const { client } = fakeClient({ failReads: true });
    await expect(
      getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, {
        client,
        now: 5_000,
        readTrades: async () => TRADES,
        fetchHolders: async () => HOLDER_ITEMS,
      }),
    ).rejects.toBeInstanceOf(TokenHolderStatsReadError);
    expect(getTokenHolderStatsReadHealth(7_000)).toEqual({ lastReadAt: 5_000, lastReadOk: false, ageMs: 2_000 });
  });

  it("records a successful read in the read health", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const { client } = fakeClient();
    expect(getTokenHolderStatsReadHealth()).toEqual({ lastReadAt: null, lastReadOk: null, ageMs: null });
    await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, {
      client,
      now: 5_000,
      readTrades: async () => TRADES,
      fetchHolders: async () => HOLDER_ITEMS,
    });
    expect(getTokenHolderStatsReadHealth(6_000)).toEqual({ lastReadAt: 5_000, lastReadOk: true, ageMs: 1_000 });
  });

  it("rejects an unsupported chain or a malformed token address without touching the network", async () => {
    const { client, readContract } = fakeClient();
    await expect(getTokenHolderBreakdown(1, TOKEN, { client })).rejects.toBeInstanceOf(TokenHolderStatsReadError);
    await expect(getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, "not-an-address", { client })).rejects.toBeInstanceOf(
      TokenHolderStatsReadError,
    );
    expect(readContract).not.toHaveBeenCalled();
  });

  it("reads Blockscout's holders page by default and treats a non-OK response as unavailable", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe(`https://explorer.testnet.chain.robinhood.com/api/v2/tokens/${TOKEN}/holders`);
      return new Response(JSON.stringify({ items: HOLDER_ITEMS }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { client } = fakeClient();
    const stats = await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, { client, readTrades: async () => TRADES });
    expect(stats.top10Percent).toBe(22.2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resetTokenHolderStatsForTests();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const degraded = await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN, {
      client,
      readTrades: async () => TRADES,
    });
    expect(degraded.top10Percent).toBeNull();
    expect(degraded.devPercent).toBe(4.2);
  });
});
