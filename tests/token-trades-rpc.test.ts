import { afterEach, describe, expect, it, vi } from "vitest";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { WETH9_ADDRESS_ENV_VAR } from "@/lib/bonding-curve-deploy-config";
import {
  resetTokenLaunchesStoreForTests,
  setTokenLaunchesStoreForTests,
  type TokenLaunchesStore,
} from "@/lib/server/token-launches-store";
import {
  TokenTradesReadError,
  getTokenTrades,
  getTokenTradesReadHealth,
  resetTokenTradesRpcForTests,
  type TokenTradesReadClient,
} from "@/lib/server/token-trades-rpc";

const CURVE = "0x1234567890123456789012345678901234567890";
const POOL = "0x00000000000000000000000000000000000ff1";
const WETH9 = "0x00000000000000000000000000000000000ff9";
const PROJECT_TOKEN = "0x1111111111111111111111111111111111111a";
const Q96 = 2n ** 96n;
const LATEST_BLOCK = 1000n;
// timestamp(blockNumber) = BASE_TIMESTAMP + blockNumber — strictly increasing
// with block number, matching a real chain.
const BASE_TIMESTAMP = 1_700_000_000;
const CREATION_BLOCK = 100n;
// Must match CREATION_TIMESTAMP_SAFETY_MARGIN_SECONDS in token-trades-rpc.ts.
const SAFETY_MARGIN_SECONDS = 10 * 60;

function timestampForBlock(blockNumber: bigint): bigint {
  return BigInt(BASE_TIMESTAMP) + blockNumber;
}

// A created_at that resolves, after subtracting the safety margin, to
// exactly CREATION_BLOCK's timestamp — the binary search should land on
// CREATION_BLOCK precisely since timestamps increase by 1 per block.
const CREATED_AT = new Date(Number(timestampForBlock(CREATION_BLOCK)) * 1000 + SAFETY_MARGIN_SECONDS * 1000);

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
      return null;
    },
    async findTokenLaunchCreatedAtByCurveAddress() {
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

function makeLog(overrides: Record<string, unknown> = {}) {
  return {
    eventName: "TokensPurchased",
    args: {
      buyer: "0xbbbb000000000000000000000000000000000b",
      grossNativeIn: 10_100_000_000_000_000n,
      netNativeIn: 10_000_000_000_000_000n,
      tokensOut: 500_000_000_000_000_000n,
      feeCharged: 100_000_000_000_000n,
      virtualTokenReserve: 1n,
      virtualEthReserve: 1n,
    },
    blockNumber: 200n,
    transactionHash: "0xTX1",
    logIndex: 0,
    ...overrides,
  };
}

function fakeClient(logs: unknown[] = [makeLog()], latest: bigint = LATEST_BLOCK) {
  const getLogs = vi.fn(async () => logs);
  const getBlockNumber = vi.fn(async () => latest);
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
    number: blockNumber,
    timestamp: timestampForBlock(blockNumber),
  }));
  const client = { getLogs, getBlockNumber, getBlock } as unknown as TokenTradesReadClient;
  return { client, getLogs, getBlock, getBlockNumber };
}

function failingClient() {
  return {
    getLogs: vi.fn(async () => {
      throw new Error("RPC down");
    }),
    getBlockNumber: vi.fn(async () => LATEST_BLOCK),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      timestamp: timestampForBlock(blockNumber),
    })),
  } as unknown as TokenTradesReadClient;
}

function makeGraduatedLog(overrides: Record<string, unknown> = {}) {
  return {
    eventName: "Graduated",
    args: { pool: POOL, tokenId: 1n, tokenLiquidity: 1n, nativeLiquidity: 1n },
    blockNumber: 400n,
    transactionHash: "0xGRAD",
    logIndex: 0,
    ...overrides,
  };
}

function makeSwapLog(overrides: Record<string, unknown> = {}) {
  return {
    args: {
      sender: "0xcccc0000000000000000000000000000000ccc",
      recipient: "0xdddd0000000000000000000000000000000ddd",
      // Negative token0 delta (project token leaves the pool) => a buy, when
      // token0 is the project token and token1 is native (WETH).
      amount0: -500_000_000_000_000_000n,
      amount1: 10_000_000_000_000_000n,
      sqrtPriceX96: Q96,
      liquidity: 1n,
      tick: 0,
    },
    blockNumber: 500n,
    transactionHash: "0xSWAP1",
    logIndex: 0,
    ...overrides,
  };
}

/**
 * A fake client whose `getLogs`/`readContract` branch on the target address,
 * so a single client instance can serve both the curve's own log range and
 * (once graduated) its locked pool's separate Swap-log range and
 * token0()/token1() reads (issue #466).
 */
function fakeClientWithPool(options: {
  curveLogs?: unknown[];
  poolLogs?: unknown[];
  latest?: bigint;
  token0?: string;
  token1?: string;
} = {}) {
  const { curveLogs = [], poolLogs = [], latest = LATEST_BLOCK, token0 = PROJECT_TOKEN, token1 = WETH9 } = options;
  const getLogs = vi.fn(async ({ address }: { address: string }) => {
    return address.toLowerCase() === POOL.toLowerCase() ? poolLogs : curveLogs;
  });
  const getBlockNumber = vi.fn(async () => latest);
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
    number: blockNumber,
    timestamp: timestampForBlock(blockNumber),
  }));
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === "token0") return token0;
    if (functionName === "token1") return token1;
    throw new Error(`unexpected functionName: ${functionName}`);
  });
  const client = { getLogs, getBlockNumber, getBlock, readContract } as unknown as TokenTradesReadClient;
  return { client, getLogs, getBlock, getBlockNumber, readContract };
}

afterEach(() => {
  resetTokenTradesRpcForTests();
  resetTokenLaunchesStoreForTests();
  vi.unstubAllEnvs();
});

describe("getTokenTrades", () => {
  it("throws for a chain other than Robinhood Chain Testnet", async () => {
    const { client } = fakeClient();
    await expect(getTokenTrades(1, CURVE, { client, now: 0 })).rejects.toThrow(TokenTradesReadError);
  });

  it("normalizes a TokensPurchased log into a buy trade using the post-fee net amount", async () => {
    const { client } = fakeClient();
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades).toEqual([
      {
        direction: "buy",
        wallet: "0xbbbb000000000000000000000000000000000b",
        tokenAmountRaw: "500000000000000000",
        nativeAmountRaw: "10000000000000000",
        blockNumber: "200",
        blockTimestamp: Number(timestampForBlock(200n)),
        txHash: "0xTX1",
        logIndex: 0,
        grossNativeAmountRaw: "10100000000000000",
        feeChargedRaw: "100000000000000",
        virtualTokenReserveRaw: "1",
        virtualEthReserveRaw: "1",
      },
    ]);
  });

  it("normalizes a TokensSold log into a sell trade using the post-fee net amount", async () => {
    const { client } = fakeClient([
      makeLog({
        eventName: "TokensSold",
        args: {
          seller: "0xcccc000000000000000000000000000000000c",
          tokensIn: 200_000_000_000_000_000n,
          grossNativeOut: 4_100_000_000_000_000n,
          netNativeOut: 4_000_000_000_000_000n,
          feeCharged: 100_000_000_000_000n,
          virtualTokenReserve: 1n,
          virtualEthReserve: 1n,
        },
        blockNumber: 300n,
        transactionHash: "0xTX2",
        logIndex: 1,
      }),
    ]);
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades).toEqual([
      {
        direction: "sell",
        wallet: "0xcccc000000000000000000000000000000000c",
        tokenAmountRaw: "200000000000000000",
        nativeAmountRaw: "4000000000000000",
        blockNumber: "300",
        blockTimestamp: Number(timestampForBlock(300n)),
        txHash: "0xTX2",
        logIndex: 1,
        grossNativeAmountRaw: "4100000000000000",
        feeChargedRaw: "100000000000000",
        virtualTokenReserveRaw: "1",
        virtualEthReserveRaw: "1",
      },
    ]);
  });

  it("sorts trades newest first", async () => {
    const { client } = fakeClient([
      makeLog({ blockNumber: 200n, transactionHash: "0xEARLY", logIndex: 0 }),
      makeLog({ blockNumber: 500n, transactionHash: "0xLATE", logIndex: 0 }),
    ]);
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades.map((t) => t.blockNumber)).toEqual(["500", "200"]);
  });

  it("derives fromBlock from the recorded launch's created_at (minus the safety margin) via a block-header binary search, never eth_getCode", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore({ findTokenLaunchCreatedAtByCurveAddress: async () => CREATED_AT }));
    const { client, getLogs, getBlock } = fakeClient([]);
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    const call = getLogs.mock.calls[0][0] as { fromBlock: bigint };
    expect(call.fromBlock).toBe(CREATION_BLOCK);
    expect(call.fromBlock).not.toBe(0n);
    // Binary search over [1, 1000] is O(log2(1000)) ~ 10 calls, not a linear scan.
    expect(getBlock.mock.calls.length).toBeLessThan(15);
  });

  it("falls back to the bounded 200,000-block window when there is no usable launch record", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const latest = 5_000_000n;
    const { client, getLogs } = fakeClient([], latest);
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    const call = getLogs.mock.calls[0][0] as { fromBlock: bigint };
    expect(call.fromBlock).toBe(latest - 200_000n);
  });

  it("falls back to the bounded window (and a DB lookup failure never blocks the read)", async () => {
    setTokenLaunchesStoreForTests(
      fakeLaunchesStore({
        findTokenLaunchCreatedAtByCurveAddress: async () => {
          throw new Error("Postgres unreachable");
        },
      }),
    );
    const latest = 5_000_000n;
    const { client, getLogs } = fakeClient([], latest);
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    const call = getLogs.mock.calls[0][0] as { fromBlock: bigint };
    expect(call.fromBlock).toBe(latest - 200_000n);
  });

  it("never resolves fromBlock to block 0, even when the chain is shorter than the fallback window", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore());
    const latest = 50_000n;
    const { client, getLogs } = fakeClient([], latest);
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    const call = getLogs.mock.calls[0][0] as { fromBlock: bigint };
    expect(call.fromBlock).toBe(1n);
  });

  it("falls back to the bounded window when the launch timestamp is ahead of the chain's latest block", async () => {
    const farFutureCreatedAt = new Date((BASE_TIMESTAMP + Number(LATEST_BLOCK) + 100_000) * 1000);
    setTokenLaunchesStoreForTests(
      fakeLaunchesStore({ findTokenLaunchCreatedAtByCurveAddress: async () => farFutureCreatedAt }),
    );
    const { client, getLogs } = fakeClient([]);
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    const call = getLogs.mock.calls[0][0] as { fromBlock: bigint };
    expect(call.fromBlock).toBe(1n);
  });

  it("falls back to the bounded window when sampled block timestamps aren't monotonic with block number", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore({ findTokenLaunchCreatedAtByCurveAddress: async () => CREATED_AT }));
    // A strictly decreasing timestamp-vs-blockNumber function can never occur
    // on a real chain; the binary search must detect the inconsistency and
    // abandon the search rather than trust a wrong answer.
    const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      timestamp: BigInt(2_000_000_000) - blockNumber,
    }));
    const getLogs = vi.fn(async () => []);
    const getBlockNumber = vi.fn(async () => LATEST_BLOCK);
    const client = { getLogs, getBlockNumber, getBlock } as unknown as TokenTradesReadClient;

    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    const call = getLogs.mock.calls[0][0] as { fromBlock: bigint };
    expect(call.fromBlock).toBe(1n);
  });

  it("caches the resolved start block indefinitely across separate reads", async () => {
    setTokenLaunchesStoreForTests(fakeLaunchesStore({ findTokenLaunchCreatedAtByCurveAddress: async () => CREATED_AT }));
    const { client, getBlock } = fakeClient([]);
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    getBlock.mockClear();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 20_000 });
    expect(getBlock).not.toHaveBeenCalled();
  });

  it("reuses a cached read within the ~4s TTL instead of calling getLogs again", async () => {
    const { client, getLogs } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 3_000 });
    expect(getLogs).toHaveBeenCalledTimes(1);
  });

  it("re-reads once the TTL has elapsed", async () => {
    const { client, getLogs } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 5_000 });
    expect(getLogs).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent misses for the same curve into a single read", async () => {
    const { client, getLogs } = fakeClient();
    const [a, b] = await Promise.all([
      getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 }),
      getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 }),
    ]);
    expect(a).toEqual(b);
    expect(getLogs).toHaveBeenCalledTimes(1);
  });

  it("throws TokenTradesReadError on a genuine RPC failure instead of resolving to an empty array", async () => {
    await expect(
      getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client: failingClient(), now: 0 }),
    ).rejects.toThrow(TokenTradesReadError);
  });

  it("attempts the whole resolved range in a single eth_getLogs call when the provider allows it", async () => {
    const { client, getLogs } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(getLogs).toHaveBeenCalledTimes(1);
  });

  it("splits and merges the range only after eth_getLogs rejects the full call with a range error", async () => {
    const allLogs = [
      makeLog({ blockNumber: 200n, transactionHash: "0xEARLY", logIndex: 0 }),
      makeLog({
        eventName: "TokensSold",
        args: {
          seller: "0xcccc000000000000000000000000000000000c",
          tokensIn: 1n,
          grossNativeOut: 2n,
          netNativeOut: 1n,
          feeCharged: 1n,
          virtualTokenReserve: 1n,
          virtualEthReserve: 1n,
        },
        blockNumber: 700n,
        transactionHash: "0xLATE",
        logIndex: 0,
      }),
    ];
    const getLogs = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      if (toBlock - fromBlock > 100n) {
        throw new Error("query returned more than 10000 results, exceeds block range limit");
      }
      return allLogs.filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock);
    });
    const getBlockNumber = vi.fn(async () => LATEST_BLOCK);
    const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      timestamp: timestampForBlock(blockNumber),
    }));
    const client = { getLogs, getBlockNumber, getBlock } as unknown as TokenTradesReadClient;

    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades.map((t) => t.blockNumber)).toEqual(["700", "200"]);
    expect(getLogs.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not split the range for a non-range error", async () => {
    const client = failingClient();
    await expect(getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 })).rejects.toThrow(
      TokenTradesReadError,
    );
    expect((client as unknown as { getLogs: ReturnType<typeof vi.fn> }).getLogs).toHaveBeenCalledTimes(1);
  });
});

describe("getTokenTrades — post-graduation pool swap ingestion (issue #466)", () => {
  it("issues no pool read at all for a curve that hasn't graduated", async () => {
    // fakeClient's underlying client object doesn't even implement
    // readContract — if the pool path were mistakenly triggered, this would
    // throw instead of silently passing.
    const { client, getLogs } = fakeClient([makeLog()]);
    vi.stubEnv(WETH9_ADDRESS_ENV_VAR, WETH9);
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades).toHaveLength(1);
    expect(getLogs).toHaveBeenCalledTimes(1);
  });

  it("falls back to curve-only trades when the pool has no swaps yet", async () => {
    vi.stubEnv(WETH9_ADDRESS_ENV_VAR, WETH9);
    const { client, getLogs } = fakeClientWithPool({ curveLogs: [makeLog(), makeGraduatedLog()], poolLogs: [] });
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades.map((t) => t.blockNumber)).toEqual(["200"]);
    expect(getLogs).toHaveBeenCalledTimes(2);
  });

  it("merges curve trades and pool trades into one chronologically consistent list, newest first", async () => {
    vi.stubEnv(WETH9_ADDRESS_ENV_VAR, WETH9);
    const { client } = fakeClientWithPool({
      curveLogs: [makeLog({ blockNumber: 200n }), makeGraduatedLog({ blockNumber: 400n })],
      poolLogs: [makeSwapLog({ blockNumber: 500n })],
      token0: PROJECT_TOKEN,
      token1: WETH9,
    });
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    // Newest first, matching every other read — the pool trade (block 500)
    // is strictly newer than the curve trade (block 200), which is itself
    // strictly older than graduation (block 400): curve history always
    // precedes pool history in real chronological time.
    expect(trades.map((t) => ({ blockNumber: t.blockNumber, venue: t.venue }))).toEqual([
      { blockNumber: "500", venue: "pool" },
      { blockNumber: "200", venue: undefined },
    ]);
  });

  it("only reads the pool from the graduation block onward, not from the curve's own start block", async () => {
    vi.stubEnv(WETH9_ADDRESS_ENV_VAR, WETH9);
    const { client, getLogs } = fakeClientWithPool({
      curveLogs: [makeGraduatedLog({ blockNumber: 400n })],
      poolLogs: [],
    });
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    const poolCall = getLogs.mock.calls.find((call) => (call[0] as { address: string }).address === POOL);
    expect(poolCall).toBeDefined();
    expect((poolCall![0] as { fromBlock: bigint }).fromBlock).toBe(400n);
  });

  it("maps a negative token0 delta to a buy when token0 is the project token and token1 is native", async () => {
    vi.stubEnv(WETH9_ADDRESS_ENV_VAR, WETH9);
    const { client } = fakeClientWithPool({
      curveLogs: [makeGraduatedLog()],
      poolLogs: [makeSwapLog({ args: { sender: "0xcccc0000000000000000000000000000000ccc", recipient: "0xdddd0000000000000000000000000000000ddd", amount0: -500_000_000_000_000_000n, amount1: 10_000_000_000_000_000n, sqrtPriceX96: Q96, liquidity: 1n, tick: 0 } })],
      token0: PROJECT_TOKEN,
      token1: WETH9,
    });
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades).toEqual([
      {
        direction: "buy",
        wallet: "0xdddd0000000000000000000000000000000ddd",
        tokenAmountRaw: "500000000000000000",
        nativeAmountRaw: "10000000000000000",
        grossNativeAmountRaw: "10000000000000000",
        feeChargedRaw: "0",
        blockNumber: "500",
        blockTimestamp: Number(timestampForBlock(500n)),
        txHash: "0xSWAP1",
        logIndex: 0,
        venue: "pool",
        spotPriceNativePerTokenRaw: (10n ** 18n).toString(),
      },
    ]);
  });

  it("maps a positive token0 delta to a sell, and inverts the price, when token0 is native and token1 is the project token", async () => {
    vi.stubEnv(WETH9_ADDRESS_ENV_VAR, WETH9);
    const { client } = fakeClientWithPool({
      curveLogs: [makeGraduatedLog()],
      poolLogs: [
        makeSwapLog({
          args: {
            sender: "0xcccc0000000000000000000000000000000ccc",
            recipient: "0xdddd0000000000000000000000000000000ddd",
            // token1 (project token) flows INTO the pool from the seller (positive),
            // token0 (native) flows OUT of the pool to the seller (negative) => a sell.
            amount0: -10_000_000_000_000_000n,
            amount1: 500_000_000_000_000_000n,
            sqrtPriceX96: 2n * Q96,
            liquidity: 1n,
            tick: 0,
          },
        }),
      ],
      token0: WETH9,
      token1: PROJECT_TOKEN,
    });
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades).toEqual([
      {
        direction: "sell",
        wallet: "0xcccc0000000000000000000000000000000ccc",
        tokenAmountRaw: "500000000000000000",
        nativeAmountRaw: "10000000000000000",
        grossNativeAmountRaw: "10000000000000000",
        feeChargedRaw: "0",
        blockNumber: "500",
        blockTimestamp: Number(timestampForBlock(500n)),
        txHash: "0xSWAP1",
        logIndex: 0,
        venue: "pool",
        spotPriceNativePerTokenRaw: "250000000000000000",
      },
    ]);
  });

  it("skips pool trades (without failing the whole read) when the WETH9 address env var isn't configured", async () => {
    vi.stubEnv(WETH9_ADDRESS_ENV_VAR, "");
    const { client, readContract } = fakeClientWithPool({
      curveLogs: [makeLog(), makeGraduatedLog()],
      poolLogs: [makeSwapLog()],
    });
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades.map((t) => t.blockNumber)).toEqual(["200"]);
    expect(readContract).not.toHaveBeenCalled();
  });

  it("skips pool trades when neither pool token matches the configured WETH9 address", async () => {
    vi.stubEnv(WETH9_ADDRESS_ENV_VAR, WETH9);
    const { client } = fakeClientWithPool({
      curveLogs: [makeLog(), makeGraduatedLog()],
      poolLogs: [makeSwapLog()],
      token0: "0x2222222222222222222222222222222222222b",
      token1: "0x3333333333333333333333333333333333333c",
    });
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades.map((t) => t.blockNumber)).toEqual(["200"]);
  });

  it("caches the resolved pool token order indefinitely, reading token0/token1 only once across reads", async () => {
    vi.stubEnv(WETH9_ADDRESS_ENV_VAR, WETH9);
    const { client, readContract } = fakeClientWithPool({
      curveLogs: [makeGraduatedLog()],
      poolLogs: [makeSwapLog()],
    });
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    readContract.mockClear();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 20_000 });
    expect(readContract).not.toHaveBeenCalled();
  });
});

describe("getTokenTradesReadHealth", () => {
  it("reports no read yet before any call", () => {
    expect(getTokenTradesReadHealth(0)).toEqual({ lastReadAt: null, lastReadOk: null, ageMs: null });
  });

  it("reports a successful read's timestamp and age", async () => {
    const { client } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 1_000 });
    expect(getTokenTradesReadHealth(6_000)).toEqual({ lastReadAt: 1_000, lastReadOk: true, ageMs: 5_000 });
  });

  it("reports a failed read", async () => {
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client: failingClient(), now: 2_000 }).catch(
      () => {},
    );
    expect(getTokenTradesReadHealth(2_000).lastReadOk).toBe(false);
  });
});
