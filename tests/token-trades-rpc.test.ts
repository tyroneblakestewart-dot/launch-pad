import { afterEach, describe, expect, it, vi } from "vitest";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import {
  TokenTradesReadError,
  getTokenTrades,
  getTokenTradesReadHealth,
  resetTokenTradesRpcForTests,
  type TokenTradesReadClient,
} from "@/lib/server/token-trades-rpc";

const CURVE = "0x1234567890123456789012345678901234567890";
const LATEST_BLOCK = 1000n;
// Block timestamps are BASE_TS + blockNumber (seconds) — a simple linear
// clock so binary search over headers has a deterministic answer.
const BASE_TS = 1_700_000_000;
const CREATION_BLOCK = 100n;
const MARGIN_MS = 10 * 60 * 1000;
// createdAt chosen so (createdAt - margin) resolves, in seconds, to exactly
// BASE_TS + CREATION_BLOCK — the first block whose timestamp meets it.
const CREATED_AT = new Date((BASE_TS + Number(CREATION_BLOCK)) * 1000 + MARGIN_MS);

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

function fakeClient(logs: unknown[] = [makeLog()]) {
  const getLogs = vi.fn(async () => logs);
  const getBlockNumber = vi.fn(async () => LATEST_BLOCK);
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
    number: blockNumber,
    timestamp: BigInt(BASE_TS) + blockNumber,
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
    getBlock: vi.fn(async () => ({ number: 1n, timestamp: 1n })),
  } as unknown as TokenTradesReadClient;
}

const findLaunchCreatedAt = async () => CREATED_AT;
const findNoLaunchRecord = async () => null;

afterEach(() => {
  resetTokenTradesRpcForTests();
});

describe("getTokenTrades", () => {
  it("throws for a chain other than Robinhood Chain Testnet", async () => {
    const { client } = fakeClient();
    await expect(
      getTokenTrades(1, CURVE, { client, now: 0, findLaunchCreatedAt }),
    ).rejects.toThrow(TokenTradesReadError);
  });

  it("normalizes a TokensPurchased log into a buy trade using the post-fee net amount", async () => {
    const { client } = fakeClient();
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, {
      client,
      now: 0,
      findLaunchCreatedAt,
    });
    expect(trades).toEqual([
      {
        direction: "buy",
        wallet: "0xbbbb000000000000000000000000000000000b",
        tokenAmountRaw: "500000000000000000",
        nativeAmountRaw: "10000000000000000",
        blockNumber: "200",
        blockTimestamp: BASE_TS + 200,
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
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, {
      client,
      now: 0,
      findLaunchCreatedAt,
    });
    expect(trades).toEqual([
      {
        direction: "sell",
        wallet: "0xcccc000000000000000000000000000000000c",
        tokenAmountRaw: "200000000000000000",
        nativeAmountRaw: "4000000000000000",
        blockNumber: "300",
        blockTimestamp: BASE_TS + 300,
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
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, {
      client,
      now: 0,
      findLaunchCreatedAt,
    });
    expect(trades.map((t) => t.blockNumber)).toEqual(["500", "200"]);
  });

  it("never calls getCode — only block headers are read (pruned RPC safety)", async () => {
    const { client } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0, findLaunchCreatedAt });
    expect("getCode" in client).toBe(false);
  });

  it("derives the start block via binary search on block headers from (created_at - margin), never from block 0", async () => {
    const { client, getLogs } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0, findLaunchCreatedAt });
    const call = getLogs.mock.calls[0][0] as { fromBlock: bigint };
    expect(call.fromBlock).toBe(CREATION_BLOCK);
    expect(call.fromBlock).not.toBe(0n);
  });

  it("falls back to a bounded recent-block window (never block 0) when no launch record exists", async () => {
    const { client, getLogs } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, {
      client,
      now: 0,
      findLaunchCreatedAt: findNoLaunchRecord,
    });
    const call = getLogs.mock.calls[0][0] as { fromBlock: bigint };
    // LATEST_BLOCK (1000) is well under the 200,000-block fallback window,
    // so the bounded fallback clamps to block 0 here (never negative).
    expect(call.fromBlock).toBe(0n);
  });

  it("falls back to a bounded recent-block window when the launch lookup itself throws", async () => {
    const { client, getLogs } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, {
      client,
      now: 0,
      findLaunchCreatedAt: async () => {
        throw new Error("DB unavailable");
      },
    });
    const call = getLogs.mock.calls[0][0] as { fromBlock: bigint };
    expect(call.fromBlock).toBe(0n);
  });

  it("starts from the latest block when the launch timestamp is ahead of the latest block's own timestamp", async () => {
    const { client, getLogs } = fakeClient();
    const farFutureCreatedAt = new Date((BASE_TS + Number(LATEST_BLOCK) + 10_000) * 1000);
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, {
      client,
      now: 0,
      findLaunchCreatedAt: async () => farFutureCreatedAt,
    });
    const call = getLogs.mock.calls[0][0] as { fromBlock: bigint };
    expect(call.fromBlock).toBe(LATEST_BLOCK);
  });

  it("falls back to a bounded recent-block window when sampled header timestamps are non-monotonic", async () => {
    const badGetBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => {
      // Deliberately inconsistent with block order: block 999 reports an
      // earlier timestamp than block 1 would, violating the binary search
      // invariant that timestamps rise with block number.
      if (blockNumber === LATEST_BLOCK) return { number: blockNumber, timestamp: BigInt(BASE_TS) + blockNumber };
      return { number: blockNumber, timestamp: BigInt(BASE_TS) + LATEST_BLOCK + 1n };
    });
    const client = {
      getLogs: vi.fn(async () => [makeLog()]),
      getBlockNumber: vi.fn(async () => LATEST_BLOCK),
      getBlock: badGetBlock,
    } as unknown as TokenTradesReadClient;

    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0, findLaunchCreatedAt });
    const call = (client.getLogs as ReturnType<typeof vi.fn>).mock.calls[0][0] as { fromBlock: bigint };
    // LATEST_BLOCK (1000) is well under the 200,000-block fallback window,
    // so the bounded fallback clamps to block 0 here (never negative).
    expect(call.fromBlock).toBe(0n);
  });

  it("chunks eth_getLogs into sequential inclusive 10,000-block ranges and merges the results", async () => {
    const spanningLogs = [
      makeLog({ blockNumber: 5n, transactionHash: "0xA", logIndex: 0 }),
      makeLog({ blockNumber: 25_005n, transactionHash: "0xB", logIndex: 0 }),
    ];
    const getLogs = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
      spanningLogs.filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock),
    );
    const getBlockNumber = vi.fn(async () => 30_000n);
    const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      timestamp: BigInt(BASE_TS) + blockNumber,
    }));
    const client = { getLogs, getBlockNumber, getBlock } as unknown as TokenTradesReadClient;

    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, {
      client,
      now: 0,
      findLaunchCreatedAt: async () => new Date((BASE_TS + 0) * 1000 + MARGIN_MS),
    });

    // fromBlock resolves to 0 for this launch time, toBlock is 30_000 —
    // that's 4 chunks of 10,000 inclusive blocks: [0,9999] [10000,19999]
    // [20000,29999] [30000,30000].
    expect(getLogs).toHaveBeenCalledTimes(4);
    const ranges = getLogs.mock.calls.map((call) => call[0] as { fromBlock: bigint; toBlock: bigint });
    expect(ranges[0]).toEqual({ fromBlock: 0n, toBlock: 9_999n, address: CURVE, events: expect.anything() });
    expect(ranges[1].fromBlock).toBe(10_000n);
    expect(ranges[1].toBlock).toBe(19_999n);
    expect(ranges[2].fromBlock).toBe(20_000n);
    expect(ranges[2].toBlock).toBe(29_999n);
    expect(ranges[3]).toEqual({ fromBlock: 30_000n, toBlock: 30_000n, address: CURVE, events: expect.anything() });
    expect(trades.map((t) => t.txHash).sort()).toEqual(["0xA", "0xB"]);
  });

  it("caches the resolved start block indefinitely across separate reads", async () => {
    const { client } = fakeClient();
    const createdAtSpy = vi.fn(async () => CREATED_AT);
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0, findLaunchCreatedAt: createdAtSpy });
    createdAtSpy.mockClear();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, {
      client,
      now: 20_000,
      findLaunchCreatedAt: createdAtSpy,
    });
    expect(createdAtSpy).not.toHaveBeenCalled();
  });

  it("reuses a cached read within the ~10s TTL instead of calling getLogs again", async () => {
    const { client, getLogs } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0, findLaunchCreatedAt });
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 5_000, findLaunchCreatedAt });
    expect(getLogs).toHaveBeenCalledTimes(1);
  });

  it("re-reads once the TTL has elapsed", async () => {
    const { client, getLogs } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0, findLaunchCreatedAt });
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 11_000, findLaunchCreatedAt });
    expect(getLogs).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent misses for the same curve into a single read", async () => {
    const { client, getLogs } = fakeClient();
    const [a, b] = await Promise.all([
      getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0, findLaunchCreatedAt }),
      getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0, findLaunchCreatedAt }),
    ]);
    expect(a).toEqual(b);
    expect(getLogs).toHaveBeenCalledTimes(1);
  });

  it("throws TokenTradesReadError on a genuine RPC failure instead of resolving to an empty array", async () => {
    await expect(
      getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, {
        client: failingClient(),
        now: 0,
        findLaunchCreatedAt,
      }),
    ).rejects.toThrow(TokenTradesReadError);
  });
});

describe("getTokenTradesReadHealth", () => {
  it("reports no read yet before any call", () => {
    expect(getTokenTradesReadHealth(0)).toEqual({ lastReadAt: null, lastReadOk: null, ageMs: null });
  });

  it("reports a successful read's timestamp and age", async () => {
    const { client } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 1_000, findLaunchCreatedAt });
    expect(getTokenTradesReadHealth(6_000)).toEqual({ lastReadAt: 1_000, lastReadOk: true, ageMs: 5_000 });
  });

  it("reports a failed read", async () => {
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, {
      client: failingClient(),
      now: 2_000,
      findLaunchCreatedAt,
    }).catch(() => {});
    expect(getTokenTradesReadHealth(2_000).lastReadOk).toBe(false);
  });
});
