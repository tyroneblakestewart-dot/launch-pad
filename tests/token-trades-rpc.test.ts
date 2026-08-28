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
const CREATION_BLOCK = 100n;
const LATEST_BLOCK = 1000n;

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
  const getCode = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) =>
    blockNumber >= CREATION_BLOCK ? "0x600160" : "0x",
  );
  const getLogs = vi.fn(async () => logs);
  const getBlockNumber = vi.fn(async () => LATEST_BLOCK);
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
    number: blockNumber,
    timestamp: 1_700_000_000n + blockNumber,
  }));
  const client = { getLogs, getBlockNumber, getBlock, getCode } as unknown as TokenTradesReadClient;
  return { client, getLogs, getCode, getBlock };
}

function failingClient() {
  return {
    getLogs: vi.fn(async () => {
      throw new Error("RPC down");
    }),
    getBlockNumber: vi.fn(async () => LATEST_BLOCK),
    getBlock: vi.fn(async () => ({ number: 1n, timestamp: 1n })),
    getCode: vi.fn(async () => "0x600160"),
  } as unknown as TokenTradesReadClient;
}

afterEach(() => {
  resetTokenTradesRpcForTests();
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
        blockTimestamp: 1_700_000_200,
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
        blockTimestamp: 1_700_000_300,
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

  it("derives the curve's real creation block via binary search and scans from there, never from block 0", async () => {
    const { client, getLogs, getCode } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    const call = getLogs.mock.calls[0][0] as { fromBlock: bigint };
    expect(call.fromBlock).toBe(CREATION_BLOCK);
    expect(call.fromBlock).not.toBe(0n);
    // Binary search over [0, 1000] is O(log2(1000)) ~ 10 calls, not a linear scan from 0.
    expect(getCode.mock.calls.length).toBeLessThan(15);
  });

  it("caches the resolved creation block indefinitely across separate reads", async () => {
    const { client, getCode } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    getCode.mockClear();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 20_000 });
    expect(getCode).not.toHaveBeenCalled();
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
