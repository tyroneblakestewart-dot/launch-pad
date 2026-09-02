import { afterEach, describe, expect, it, vi } from "vitest";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { resetCurveProgressCacheForTests } from "@/lib/server/curve-progress-cache";
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

// --- issue #466: post-graduation pool swap fixtures ---

const POOL = "0xffff00000000000000000000000000000000000f";
const TOKEN_ADDRESS = "0xaaaa00000000000000000000000000000000000a";
const WETH_ADDRESS = "0xeeee00000000000000000000000000000000000e";
const SWAP_SENDER = "0x5555000000000000000000000000000000000005";
const SWAP_RECIPIENT = "0x6666000000000000000000000000000000000006";
// sqrtPriceX96 for price = 1 (2^96 exactly) — a "known value" per
// lib/uniswap-v3-spot-price.ts's own tests, reused here so the raw spot
// price is trivially checkable by hand: 1 native per whole token.
const SQRT_PRICE_X96_ONE = 79228162514264337593543950336n;

function makeGraduatedLog(overrides: Record<string, unknown> = {}) {
  return {
    eventName: "Graduated",
    args: { pool: POOL, tokenId: 1n, tokenLiquidity: 1n, nativeLiquidity: 1n },
    blockNumber: 400n,
    transactionHash: "0xGRAD",
    logIndex: 5,
    ...overrides,
  };
}

function makeSwapLog(overrides: Record<string, unknown> = {}) {
  return {
    eventName: "Swap",
    args: {
      sender: SWAP_SENDER,
      recipient: SWAP_RECIPIENT,
      // Negative token0 delta: token0 left the pool to the trader (a buy
      // when the platform token is token0).
      amount0: -500_000_000_000_000_000n,
      amount1: 10_000_000_000_000_000n,
      sqrtPriceX96: SQRT_PRICE_X96_ONE,
      liquidity: 1n,
      tick: 0,
    },
    blockNumber: 500n,
    transactionHash: "0xSWAP1",
    logIndex: 0,
    ...overrides,
  };
}

/** Answers both the curve's `token()` and the pool's `token0()` reads used by resolveTokenIsToken0, and (optionally) getCurveProgress's own graduation-status reads. */
function readContractFor({
  tokenIsToken0,
  liquidityPool = null,
}: {
  tokenIsToken0: boolean;
  liquidityPool?: string | null;
}) {
  return vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === "token") return TOKEN_ADDRESS;
    if (functionName === "token0") return tokenIsToken0 ? TOKEN_ADDRESS : WETH_ADDRESS;
    if (functionName === "funded") return true;
    if (functionName === "graduated") return liquidityPool !== null;
    if (functionName === "realNativeReserve") return 0n;
    if (functionName === "graduationTarget") return 1n;
    if (functionName === "liquidityPool") return liquidityPool ?? "0x0000000000000000000000000000000000000000";
    throw new Error(`unexpected readContract call: ${functionName}`);
  });
}

function fakeClientWithPool({
  curveLogs = [],
  poolLogs = [],
  latest = LATEST_BLOCK,
  readContract,
}: {
  curveLogs?: unknown[];
  poolLogs?: unknown[];
  latest?: bigint;
  readContract?: ReturnType<typeof vi.fn>;
}) {
  const getLogs = vi.fn(async ({ address }: { address: string }) =>
    address.toLowerCase() === POOL.toLowerCase() ? poolLogs : curveLogs,
  );
  const getBlockNumber = vi.fn(async () => latest);
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
    number: blockNumber,
    timestamp: timestampForBlock(blockNumber),
  }));
  const defaultReadContract = vi.fn(async () => {
    throw new Error("readContract not mocked");
  });
  const client = {
    getLogs,
    getBlockNumber,
    getBlock,
    readContract: readContract ?? defaultReadContract,
  } as unknown as TokenTradesReadClient;
  return { client, getLogs, getBlock, getBlockNumber };
}

afterEach(() => {
  resetTokenTradesRpcForTests();
  resetTokenLaunchesStoreForTests();
  resetCurveProgressCacheForTests();
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
        venue: "curve",
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
        venue: "curve",
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

describe("getTokenTrades — post-graduation pool swaps (issue #466)", () => {
  it("a non-graduated curve issues no pool read at all", async () => {
    const { client, getLogs } = fakeClientWithPool({ curveLogs: [makeLog()] });
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades).toHaveLength(1);
    expect(trades[0].venue).toBe("curve");
    // Only the curve's own address was ever queried — never the pool.
    expect(getLogs).toHaveBeenCalledTimes(1);
    expect((getLogs.mock.calls[0][0] as { address: string }).address).toBe(CURVE);
  });

  it("reads pool swaps once the curve's own Graduated event is found, merging chronologically with curve trades (token is token0)", async () => {
    const readContract = readContractFor({ tokenIsToken0: true });
    const { client, getLogs } = fakeClientWithPool({
      curveLogs: [makeLog({ blockNumber: 200n }), makeGraduatedLog()],
      poolLogs: [makeSwapLog({ blockNumber: 500n })],
      readContract,
    });

    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });

    expect(trades.map((t) => t.blockNumber)).toEqual(["500", "200"]);
    expect(trades[1].venue).toBe("curve");

    const poolTrade = trades[0];
    expect(poolTrade.venue).toBe("pool");
    // amount0 negative -> token0 (the platform token, since tokenIsToken0)
    // left the pool to the trader -> buy, credited to the swap's recipient.
    expect(poolTrade.direction).toBe("buy");
    expect(poolTrade.wallet).toBe(SWAP_RECIPIENT);
    expect(poolTrade.tokenAmountRaw).toBe("500000000000000000");
    expect(poolTrade.nativeAmountRaw).toBe("10000000000000000");
    expect(poolTrade.grossNativeAmountRaw).toBe("10000000000000000");
    expect(poolTrade.feeChargedRaw).toBe("0");
    // sqrtPriceX96 for price=1 and token0=platform token -> 1 native per token.
    expect(poolTrade.spotPriceNativePerTokenRaw).toBe("1000000000000000000");

    // The pool's own address was queried too, from the Graduated event's block.
    const poolCall = getLogs.mock.calls.find((call) => (call[0] as { address: string }).address === POOL);
    expect(poolCall).toBeDefined();
    expect((poolCall?.[0] as { fromBlock: bigint }).fromBlock).toBe(400n);
  });

  it("maps direction correctly when the platform token is token1 (WETH is token0)", async () => {
    const readContract = readContractFor({ tokenIsToken0: false });
    const { client } = fakeClientWithPool({
      curveLogs: [makeGraduatedLog()],
      poolLogs: [
        makeSwapLog({
          // token is token1 here: a positive amount1 delta means the token
          // left the pool to the trader -> buy.
          args: {
            sender: SWAP_SENDER,
            recipient: SWAP_RECIPIENT,
            amount0: 10_000_000_000_000_000n,
            amount1: -500_000_000_000_000_000n,
            sqrtPriceX96: SQRT_PRICE_X96_ONE,
            liquidity: 1n,
            tick: 0,
          },
        }),
      ],
      readContract,
    });

    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades).toHaveLength(1);
    expect(trades[0].direction).toBe("buy");
    expect(trades[0].wallet).toBe(SWAP_RECIPIENT);
    expect(trades[0].tokenAmountRaw).toBe("500000000000000000");
    expect(trades[0].nativeAmountRaw).toBe("10000000000000000");
    // Price=1 is symmetric regardless of ordering.
    expect(trades[0].spotPriceNativePerTokenRaw).toBe("1000000000000000000");
  });

  it("maps a sell (positive token delta) to the swap's sender", async () => {
    const readContract = readContractFor({ tokenIsToken0: true });
    const { client } = fakeClientWithPool({
      curveLogs: [makeGraduatedLog()],
      poolLogs: [
        makeSwapLog({
          args: {
            sender: SWAP_SENDER,
            recipient: SWAP_RECIPIENT,
            amount0: 500_000_000_000_000_000n,
            amount1: -10_000_000_000_000_000n,
            sqrtPriceX96: SQRT_PRICE_X96_ONE,
            liquidity: 1n,
            tick: 0,
          },
        }),
      ],
      readContract,
    });

    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades).toHaveLength(1);
    expect(trades[0].direction).toBe("sell");
    expect(trades[0].wallet).toBe(SWAP_SENDER);
  });

  it("falls back to no trade list explosion when the pool has no swaps yet (graduated, zero pool trades)", async () => {
    const readContract = readContractFor({ tokenIsToken0: true });
    const { client } = fakeClientWithPool({
      curveLogs: [makeLog({ blockNumber: 200n }), makeGraduatedLog()],
      poolLogs: [],
      readContract,
    });

    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades.map((t) => t.venue)).toEqual(["curve"]);
  });

  it("resolves the pool address/graduation block via a direct status read + recorded graduated_at when the Graduated event isn't in the fetched range", async () => {
    const graduatedAt = new Date((BASE_TIMESTAMP + 300) * 1000 + SAFETY_MARGIN_SECONDS * 1000);
    setTokenLaunchesStoreForTests(
      fakeLaunchesStore({
        findTokenLaunchGraduatedAtByCurveAddress: async () => graduatedAt,
      }),
    );
    const readContract = readContractFor({ tokenIsToken0: true, liquidityPool: POOL });
    const { client, getLogs } = fakeClientWithPool({
      // No Graduated log in the (bounded-fallback-window) curve range.
      curveLogs: [],
      poolLogs: [makeSwapLog({ blockNumber: 500n })],
      readContract,
    });

    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades).toHaveLength(1);
    expect(trades[0].venue).toBe("pool");

    const poolCall = getLogs.mock.calls.find((call) => (call[0] as { address: string }).address === POOL);
    expect(poolCall).toBeDefined();
    // Binary-searched to land on the block whose timestamp matches
    // graduatedAt minus the safety margin, exactly like the curve's own
    // creation-timestamp resolution.
    expect((poolCall?.[0] as { fromBlock: bigint }).fromBlock).toBe(300n);
  });

  it("caches the resolved pool address/start block indefinitely across separate reads", async () => {
    const readContract = readContractFor({ tokenIsToken0: true });
    const { client, getLogs } = fakeClientWithPool({
      curveLogs: [makeGraduatedLog()],
      poolLogs: [],
      readContract,
    });

    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    getLogs.mockClear();
    readContract.mockClear();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 20_000 });

    // The pool's Swap log read still happens every read (fresh trade data),
    // but token-order resolution (readContract) is never repeated.
    expect(readContract).not.toHaveBeenCalled();
    const poolCall = getLogs.mock.calls.find((call) => (call[0] as { address: string }).address === POOL);
    expect(poolCall).toBeDefined();
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
