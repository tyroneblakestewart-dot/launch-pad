import { afterEach, describe, expect, it, vi } from "vitest";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import {
  getTokenTrades,
  getTokenTradesCacheHealth,
  normalizeTradeLog,
  resetTokenTradesCacheForTests,
  type TokenTradesReadClient,
} from "@/lib/server/token-trades-rpc";

const CURVE = "0x1234567890123456789012345678901234567890";
const TOKEN = "0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd";
const BUYER = "0x1111111111111111111111111111111111111A";
const SELLER = "0x2222222222222222222222222222222222222B";
const CREATION_BLOCK = 42n;
const LATEST_BLOCK = 100n;
const HAS_CODE = "0x600160005260206000f3";

function fakeClient(overrides: {
  logs?: unknown[];
  latest?: bigint;
  creationBlock?: bigint;
  decimals?: number;
  blockTimestamp?: bigint;
} = {}) {
  const latest = overrides.latest ?? LATEST_BLOCK;
  const creationBlock = overrides.creationBlock ?? CREATION_BLOCK;
  const decimals = overrides.decimals ?? 18;
  const blockTimestamp = overrides.blockTimestamp ?? 1_700_000_000n;
  const logs = overrides.logs ?? [];

  const getBlockNumber = vi.fn(async () => latest);
  const getCode = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) =>
    blockNumber >= creationBlock ? HAS_CODE : "0x",
  );
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === "token") return TOKEN;
    if (functionName === "decimals") return decimals;
    throw new Error(`unexpected functionName ${functionName}`);
  });
  const getLogs = vi.fn(async () => logs);
  const getBlock = vi.fn(async () => ({ timestamp: blockTimestamp }));

  return {
    client: { getBlockNumber, getCode, readContract, getLogs, getBlock } as unknown as TokenTradesReadClient,
    getBlockNumber,
    getCode,
    readContract,
    getLogs,
    getBlock,
  };
}

function purchasedLog(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    eventName: "TokensPurchased",
    args: { buyer: BUYER, grossNativeIn: 1_000_000_000_000_000_000n, netNativeIn: 990_000_000_000_000_000n, tokensOut: 500_000_000_000_000_000_000n },
    blockNumber: 50n,
    transactionHash: "0xaaa",
    logIndex: 0,
    ...overrides,
  };
}

function soldLog(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    eventName: "TokensSold",
    args: { seller: SELLER, tokensIn: 500_000_000_000_000_000_000n, grossNativeOut: 1_000_000_000_000_000_000n, netNativeOut: 990_000_000_000_000_000n },
    blockNumber: 51n,
    transactionHash: "0xbbb",
    logIndex: 0,
    ...overrides,
  };
}

afterEach(() => {
  resetTokenTradesCacheForTests();
});

describe("normalizeTradeLog", () => {
  it("normalizes a TokensPurchased log into a buy trade", () => {
    const trade = normalizeTradeLog(purchasedLog() as never, 1_700_000_000_000, 18);
    expect(trade).toMatchObject({
      direction: "buy",
      wallet: BUYER.toLowerCase(),
      tokenAmountRaw: "500000000000000000000",
      nativeAmountWei: "1000000000000000000",
      blockNumber: "50",
      txHash: "0xaaa",
    });
    expect(trade?.priceNativePerToken).toBeCloseTo(0.002, 10);
  });

  it("normalizes a TokensSold log into a sell trade", () => {
    const trade = normalizeTradeLog(soldLog() as never, 1_700_000_000_000, 18);
    expect(trade).toMatchObject({ direction: "sell", wallet: SELLER.toLowerCase(), tokenAmountRaw: "500000000000000000000" });
  });

  it("returns null for an unrecognised event", () => {
    const trade = normalizeTradeLog(
      { eventName: "Other", args: {}, blockNumber: 1n, transactionHash: "0x1", logIndex: 0 } as never,
      0,
      18,
    );
    expect(trade).toBeNull();
  });
});

describe("getTokenTrades", () => {
  it("returns null for a chain other than Robinhood Chain Testnet", async () => {
    const { client } = fakeClient();
    const result = await getTokenTrades(1, CURVE, { client, now: 0 });
    expect(result).toBeNull();
  });

  it("derives the curve's real creation block via binary search on eth_getCode and scans from there, never block 0", async () => {
    const { client, getLogs } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: CREATION_BLOCK, toBlock: LATEST_BLOCK }),
    );
  });

  it("reuses the resolved creation block on a later read instead of re-deriving it", async () => {
    const { client, getCode } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    const callsAfterFirst = getCode.mock.calls.length;
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 25_000 });
    expect(getCode).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it("normalizes and sorts trades ascending by block/log order", async () => {
    const { client } = fakeClient({ logs: [soldLog(), purchasedLog()] });
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades).toHaveLength(2);
    expect(trades?.map((t) => t.direction)).toEqual(["buy", "sell"]);
  });

  it("returns an empty array (not null) for a curve with genuinely zero trades", async () => {
    const { client } = fakeClient({ logs: [] });
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(trades).toEqual([]);
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
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 15_000 });
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

  it("falls back to the last cached trades when a later read fails", async () => {
    const { client } = fakeClient({ logs: [purchasedLog()] });
    const first = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });

    const failingClient = {
      getBlockNumber: vi.fn(async () => {
        throw new Error("RPC down");
      }),
      getCode: vi.fn(),
      readContract: vi.fn(),
      getLogs: vi.fn(),
      getBlock: vi.fn(),
    } as unknown as TokenTradesReadClient;
    const second = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client: failingClient, now: 15_000 });

    expect(second).toEqual(first);
  });

  it("returns null (not an empty array) on a failed read with nothing cached yet", async () => {
    const failingClient = {
      getBlockNumber: vi.fn(async () => {
        throw new Error("RPC down");
      }),
      getCode: vi.fn(),
      readContract: vi.fn(),
      getLogs: vi.fn(),
      getBlock: vi.fn(),
    } as unknown as TokenTradesReadClient;
    const result = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client: failingClient, now: 0 });
    expect(result).toBeNull();
  });
});

describe("getTokenTradesCacheHealth", () => {
  it("reports no read yet before any call", () => {
    expect(getTokenTradesCacheHealth(0)).toEqual({ lastReadAt: null, lastReadOk: null, ageMs: null });
  });

  it("reports a successful read's timestamp and age", async () => {
    const { client } = fakeClient();
    await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 1_000 });
    expect(getTokenTradesCacheHealth(6_000)).toEqual({ lastReadAt: 1_000, lastReadOk: true, ageMs: 5_000 });
  });
});
