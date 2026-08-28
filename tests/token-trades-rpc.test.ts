import { afterEach, describe, expect, it, vi } from "vitest";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
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

afterEach(() => {
  resetTokenTradesRpcForTests();
  resetTokenLaunchesStoreForTests();
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

  it("reuses a cached read within the ~10s TTL instead of calling getLogs again", async () => {
    const { client, getLogs } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 5_000 });
    expect(getLogs).toHaveBeenCalledTimes(1);
  });

  it("re-reads once the TTL has elapsed", async () => {
    const { client, getLogs } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 11_000 });
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
