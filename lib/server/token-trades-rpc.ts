import { createPublicClient, http, parseAbiItem, type Address, type PublicClient } from "viem";
import { ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import type { TokenTrade } from "@/lib/token-trade-types";

/**
 * Reads a bonding curve's real buy/sell history straight from
 * contracts/HoodlumsTestBondingCurve.sol's own events (issue #430) via the
 * same server-side RPC configuration lib/server/curve-progress-cache.ts and
 * lib/server/token-launch-reconciliation.ts already use — no new env vars.
 * The event signatures below are copied verbatim from the contract's
 * `TokensPurchased`/`TokensSold` declarations; `netNativeIn`/`netNativeOut`
 * (post-fee) are used as each trade's native amount because that's the
 * amount that actually priced the trade against the curve's reserves,
 * matching quoteBuy()/quoteSell()'s own math.
 */
const TOKENS_PURCHASED_EVENT = parseAbiItem(
  "event TokensPurchased(address indexed buyer, uint256 grossNativeIn, uint256 netNativeIn, uint256 tokensOut, uint256 feeCharged, uint256 virtualTokenReserve, uint256 virtualEthReserve)",
);
const TOKENS_SOLD_EVENT = parseAbiItem(
  "event TokensSold(address indexed seller, uint256 tokensIn, uint256 grossNativeOut, uint256 netNativeOut, uint256 feeCharged, uint256 virtualTokenReserve, uint256 virtualEthReserve)",
);

const TRADES_CACHE_TTL_MS = 10_000;

export type TokenTradesReadClient = Pick<PublicClient, "getLogs" | "getBlockNumber" | "getBlock" | "getCode">;

export type TokenTradesDeps = {
  client?: TokenTradesReadClient;
  now?: number;
};

export class TokenTradesReadError extends Error {}

function defaultClient(): TokenTradesReadClient {
  return createPublicClient({
    chain: {
      id: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
      name: "Robinhood Chain Testnet",
      nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
      rpcUrls: { default: { http: [ROBINHOOD_TESTNET.rpcUrls[0]] } },
    },
    transport: http(ROBINHOOD_TESTNET.rpcUrls[0]),
  });
}

function cacheKey(chainId: number, curveAddress: string): string {
  return `${chainId}:${curveAddress.toLowerCase()}`;
}

type TradesCacheEntry = { trades: TokenTrade[]; cachedAt: number };

const tradesCache = new Map<string, TradesCacheEntry>();
const tradesInflight = new Map<string, Promise<TokenTrade[]>>();
// Cached indefinitely per curve: a contract's deployment block never
// changes, so once resolved it never needs re-deriving.
const creationBlockCache = new Map<string, bigint>();
let lastReadAt: number | null = null;
let lastReadOk: boolean | null = null;

/**
 * Derives a curve's real deployment block via binary search on
 * `eth_getCode` (bytecode is absent before deployment, present at/after) —
 * no launch record stores a block number today, and this works for a
 * legacy manually-deployed curve too, not just ones recorded in
 * token_launches. Never scans event logs from block 0.
 */
async function resolveCreationBlock(client: TokenTradesReadClient, curveAddress: Address): Promise<bigint> {
  const key = curveAddress.toLowerCase();
  const cached = creationBlockCache.get(key);
  if (cached !== undefined) return cached;

  const latest = await client.getBlockNumber();
  const codeAtLatest = await client.getCode({ address: curveAddress, blockNumber: latest });
  if (!codeAtLatest || codeAtLatest === "0x") {
    // No code even at the latest block — nothing to scan; treat "now" as
    // the creation block so a subsequent real deployment gets picked up
    // once this cache entry naturally falls out of use (it is never
    // invalidated automatically, but an address with no code isn't a real
    // curve to poll repeatedly in practice).
    creationBlockCache.set(key, latest);
    return latest;
  }

  let low = 0n;
  let high = latest;
  while (low < high) {
    const mid = low + (high - low) / 2n;
    const code = await client.getCode({ address: curveAddress, blockNumber: mid });
    if (code && code !== "0x") {
      high = mid;
    } else {
      low = mid + 1n;
    }
  }

  creationBlockCache.set(key, low);
  return low;
}

function normalizeTradeLog(
  log: {
    eventName: "TokensPurchased" | "TokensSold";
    args: {
      buyer?: Address;
      seller?: Address;
      netNativeIn?: bigint;
      netNativeOut?: bigint;
      tokensOut?: bigint;
      tokensIn?: bigint;
    };
    blockNumber: bigint | null;
    transactionHash: `0x${string}` | null;
    logIndex: number | null;
  },
  timestampByBlock: Map<bigint, number>,
): TokenTrade | null {
  if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) return null;
  const blockTimestamp = timestampByBlock.get(log.blockNumber);
  if (blockTimestamp === undefined) return null;

  if (log.eventName === "TokensPurchased") {
    if (!log.args.buyer || log.args.netNativeIn === undefined || log.args.tokensOut === undefined) return null;
    return {
      direction: "buy",
      wallet: log.args.buyer,
      tokenAmountRaw: log.args.tokensOut.toString(),
      nativeAmountRaw: log.args.netNativeIn.toString(),
      blockNumber: log.blockNumber.toString(),
      blockTimestamp,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
    };
  }

  if (!log.args.seller || log.args.netNativeOut === undefined || log.args.tokensIn === undefined) return null;
  return {
    direction: "sell",
    wallet: log.args.seller,
    tokenAmountRaw: log.args.tokensIn.toString(),
    nativeAmountRaw: log.args.netNativeOut.toString(),
    blockNumber: log.blockNumber.toString(),
    blockTimestamp,
    txHash: log.transactionHash,
    logIndex: log.logIndex,
  };
}

/**
 * Reads (or reuses a ~10s cached read of) a curve's full trade history,
 * newest first. Concurrent cache misses for the same curve share one
 * in-flight read. Throws `TokenTradesReadError` on a genuine RPC failure —
 * callers must never treat that the same as a real zero-trade response.
 */
export async function getTokenTrades(
  chainId: number,
  curveAddress: Address,
  deps: TokenTradesDeps = {},
): Promise<TokenTrade[]> {
  if (chainId !== ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL) {
    throw new TokenTradesReadError("Trade history is only available on Robinhood Chain Testnet.");
  }

  const now = deps.now ?? Date.now();
  const key = cacheKey(chainId, curveAddress);

  const cached = tradesCache.get(key);
  if (cached && now - cached.cachedAt < TRADES_CACHE_TTL_MS) {
    return cached.trades;
  }

  const existingInflight = tradesInflight.get(key);
  if (existingInflight) return existingInflight;

  const client = deps.client ?? defaultClient();

  const readPromise = (async (): Promise<TokenTrade[]> => {
    try {
      const fromBlock = await resolveCreationBlock(client, curveAddress);
      const logs = await client.getLogs({
        address: curveAddress,
        events: [TOKENS_PURCHASED_EVENT, TOKENS_SOLD_EVENT],
        fromBlock,
        toBlock: "latest",
      });

      const blockNumbers = [...new Set(logs.map((log) => log.blockNumber).filter((value): value is bigint => value !== null))];
      const blocks = await Promise.all(blockNumbers.map((blockNumber) => client.getBlock({ blockNumber })));
      const timestampByBlock = new Map(blocks.map((block) => [block.number, Number(block.timestamp)]));

      const trades = logs
        .map((log) => normalizeTradeLog(log as unknown as Parameters<typeof normalizeTradeLog>[0], timestampByBlock))
        .filter((trade): trade is TokenTrade => trade !== null)
        .sort((a, b) => b.blockTimestamp - a.blockTimestamp || b.logIndex - a.logIndex);

      tradesCache.set(key, { trades, cachedAt: now });
      lastReadAt = now;
      lastReadOk = true;
      return trades;
    } catch (error) {
      lastReadAt = now;
      lastReadOk = false;
      throw error instanceof TokenTradesReadError
        ? error
        : new TokenTradesReadError(error instanceof Error ? error.message : "Trade history read failed.");
    } finally {
      tradesInflight.delete(key);
    }
  })();

  tradesInflight.set(key, readPromise);
  return readPromise;
}

export type TokenTradesReadHealth = {
  lastReadAt: number | null;
  lastReadOk: boolean | null;
  ageMs: number | null;
};

/** Read for the admin `trades-read` System Health stage (rule 10). */
export function getTokenTradesReadHealth(now = Date.now()): TokenTradesReadHealth {
  return {
    lastReadAt,
    lastReadOk,
    ageMs: lastReadAt === null ? null : now - lastReadAt,
  };
}

export function resetTokenTradesRpcForTests(): void {
  tradesCache.clear();
  tradesInflight.clear();
  creationBlockCache.clear();
  lastReadAt = null;
  lastReadOk = null;
}
