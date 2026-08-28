import { createPublicClient, http, parseAbi, type GetLogsReturnType, type PublicClient } from "viem";
import {
  HOODLUMS_BONDING_CURVE_TRADE_ABI,
  HOODLUMS_BONDING_CURVE_TRADE_EVENTS_ABI,
} from "@/lib/bonding-curve-config";
import { ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import type { TokenTradeItem } from "@/lib/token-trade-view";

/**
 * Server-side, TTL-cached on-chain read of one bonding curve's full buy/sell
 * history (issue #430: "the Recent trades tab shows 'No trades recorded
 * yet' forever ... because nothing reads the curve's trade history").
 * Mirrors lib/server/curve-progress-cache.ts's shape exactly: a short TTL
 * cache so many viewers polling every ~12s never becomes a burst of RPC
 * calls, concurrent cache misses for the same curve share one in-flight
 * read, and a failed read falls back to the last known cached value.
 *
 * The issue's own text points at "the curve's creation block (available
 * from the launch record / lookup lib from #425 — verify)" as the scan
 * start. No such field exists anywhere in this codebase — token_launches
 * (db/migrations/029_token_launches.sql), lib/server/token-launches-store.ts
 * and lib/server/token-launch-curve-lookup.ts were all checked and none of
 * them record a block number, and there is no issue #425 in this repo's
 * history. Rather than guess a lookback window (which risks either missing
 * genuine early trades or scanning needlessly far), `resolveCreationBlock`
 * below derives the curve's real deployment block itself via a binary
 * search on `eth_getCode` (bytecode is absent before deployment, present at
 * and after it), independent of any stored record and correct for a
 * legacy/manually-deployed curve too. It's ~log2(latest block) RPC calls —
 * cached indefinitely per curve afterward, since a contract's creation
 * block never changes — so the cost is paid once per curve, not once per
 * viewer or per poll.
 */
const TRADES_CACHE_TTL_MS = 10_000;
/** Safety cap on how many trades a single read ever returns/caches. */
const MAX_TRADES_RETURNED = 500;
/** Fallback chunk size if a single getLogs call across the whole range fails (provider block-range caps vary). */
const LOG_CHUNK_BLOCKS = 5_000n;
const MAX_LOG_CHUNKS = 100;

const ERC20_DECIMALS_ABI = parseAbi(["function decimals() view returns (uint8)"]);

export type TokenTradesReadClient = Pick<
  PublicClient,
  "getLogs" | "getBlock" | "getBlockNumber" | "getCode" | "readContract"
>;

/** A strict-decoded TokensPurchased/TokensSold log — `strict: true` is passed on every `getLogs` call below so `eventName`/`args` are always fully decoded, never partial. */
type TradeLog = GetLogsReturnType<undefined, typeof HOODLUMS_BONDING_CURVE_TRADE_EVENTS_ABI, true>[number];

export type TokenTradesDeps = {
  client?: TokenTradesReadClient;
  now?: number;
};

type CacheEntry = { trades: TokenTradeItem[]; cachedAt: number };

const tradesCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<TokenTradeItem[] | null>>();
const creationBlockCache = new Map<string, bigint>();
const decimalsCache = new Map<string, number>();
let lastReadAt: number | null = null;
let lastReadOk: boolean | null = null;

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

/**
 * Binary search for the first block at which `curveAddress` has bytecode —
 * i.e. its deployment block. Never scans from block 0: the search range is
 * [0, latest], but the result converges on the true creation block in
 * ~log2(latest) reads. Cached indefinitely per curve (a contract's creation
 * block is immutable).
 */
async function resolveCreationBlock(
  client: TokenTradesReadClient,
  curveAddress: `0x${string}`,
  key: string,
): Promise<bigint> {
  const cached = creationBlockCache.get(key);
  if (cached !== undefined) return cached;

  const latest = await client.getBlockNumber();
  let lo = 0n;
  let hi = latest;
  while (lo < hi) {
    const mid = lo + (hi - lo) / 2n;
    const code = await client.getCode({ address: curveAddress, blockNumber: mid });
    if (code && code !== "0x") {
      hi = mid;
    } else {
      lo = mid + 1n;
    }
  }

  creationBlockCache.set(key, lo);
  return lo;
}

/** Reads the curve's token() then that token's decimals(), cached indefinitely per curve — both are immutable. */
async function resolveTokenDecimals(
  client: TokenTradesReadClient,
  curveAddress: `0x${string}`,
  key: string,
): Promise<number> {
  const cached = decimalsCache.get(key);
  if (cached !== undefined) return cached;

  const tokenAddress = (await client.readContract({
    address: curveAddress,
    abi: HOODLUMS_BONDING_CURVE_TRADE_ABI,
    functionName: "token",
  })) as `0x${string}`;
  const decimals = Number(
    await client.readContract({ address: tokenAddress, abi: ERC20_DECIMALS_ABI, functionName: "decimals" }),
  );

  decimalsCache.set(key, decimals);
  return decimals;
}

/**
 * Fetches every TokensPurchased/TokensSold log in [fromBlock, toBlock] in
 * one call, falling back to fixed-size chunked scanning if the provider
 * rejects a wide range (a common RPC-side block-range cap) — bounded by
 * MAX_LOG_CHUNKS so a pathological range can't hang a request forever.
 */
async function fetchTradeLogs(
  client: TokenTradesReadClient,
  curveAddress: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<TradeLog[]> {
  try {
    return await client.getLogs({
      address: curveAddress,
      events: HOODLUMS_BONDING_CURVE_TRADE_EVENTS_ABI,
      fromBlock,
      toBlock,
      strict: true,
    });
  } catch {
    const logs: TradeLog[] = [];
    let start = fromBlock;
    let chunks = 0;
    while (start <= toBlock && chunks < MAX_LOG_CHUNKS) {
      const end = start + LOG_CHUNK_BLOCKS > toBlock ? toBlock : start + LOG_CHUNK_BLOCKS;
      const chunkLogs = await client.getLogs({
        address: curveAddress,
        events: HOODLUMS_BONDING_CURVE_TRADE_EVENTS_ABI,
        fromBlock: start,
        toBlock: end,
        strict: true,
      });
      logs.push(...chunkLogs);
      start = end + 1n;
      chunks += 1;
    }
    return logs;
  }
}

/** Pure mapping from one decoded event log to a normalized trade — exported for direct unit testing. */
export function normalizeTradeLog(
  log: TradeLog,
  blockTimestampMs: number,
  decimals: number,
): TokenTradeItem | null {
  if (!log.blockNumber || !log.transactionHash) return null;

  if (log.eventName === "TokensPurchased") {
    const args = log.args as { buyer: string; grossNativeIn: bigint; tokensOut: bigint };
    return buildTrade("buy", args.buyer, args.tokensOut, args.grossNativeIn, log, blockTimestampMs, decimals);
  }
  if (log.eventName === "TokensSold") {
    const args = log.args as { seller: string; tokensIn: bigint; grossNativeOut: bigint };
    return buildTrade("sell", args.seller, args.tokensIn, args.grossNativeOut, log, blockTimestampMs, decimals);
  }
  return null;
}

function buildTrade(
  direction: "buy" | "sell",
  wallet: string,
  tokenAmountRaw: bigint,
  nativeAmountWei: bigint,
  log: TradeLog,
  blockTimestampMs: number,
  decimals: number,
): TokenTradeItem {
  const priceNativePerToken =
    tokenAmountRaw === 0n ? 0 : Number(nativeAmountWei) / 1e18 / (Number(tokenAmountRaw) / 10 ** decimals);

  return {
    direction,
    wallet: wallet.toLowerCase(),
    tokenAmountRaw: tokenAmountRaw.toString(),
    nativeAmountWei: nativeAmountWei.toString(),
    priceNativePerToken,
    blockNumber: (log.blockNumber as bigint).toString(),
    blockTimestampMs,
    txHash: log.transactionHash as string,
    logIndex: log.logIndex ?? 0,
  };
}

/**
 * Reads (or reuses a cached read of) a curve's full trade history, ascending
 * by block/log order. Only Robinhood Chain Testnet is supported today,
 * mirroring lib/server/curve-progress-cache.ts's own chain restriction —
 * returns `null` for any other chain id. On a read failure, falls back to
 * the last known cached trades (if any); with nothing cached yet, returns
 * `null` so the route can tell "genuinely zero trades" apart from "the read
 * failed" instead of silently showing an empty state for a broken RPC.
 */
export async function getTokenTrades(
  chainId: number,
  curveAddress: string,
  deps: TokenTradesDeps = {},
): Promise<TokenTradeItem[] | null> {
  if (chainId !== ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL) return null;

  const now = deps.now ?? Date.now();
  const key = cacheKey(chainId, curveAddress);

  const cached = tradesCache.get(key);
  if (cached && now - cached.cachedAt < TRADES_CACHE_TTL_MS) {
    return cached.trades;
  }

  const existingInflight = inflight.get(key);
  if (existingInflight) return existingInflight;

  const client = deps.client ?? defaultClient();
  const address = curveAddress as `0x${string}`;

  const readPromise = (async (): Promise<TokenTradeItem[] | null> => {
    try {
      const [fromBlock, decimals, latestBlockRaw] = await Promise.all([
        resolveCreationBlock(client, address, key),
        resolveTokenDecimals(client, address, key),
        client.getBlockNumber(),
      ]);
      const toBlock = latestBlockRaw < fromBlock ? fromBlock : latestBlockRaw;

      const logs = await fetchTradeLogs(client, address, fromBlock, toBlock);

      const uniqueBlockNumbers = [...new Set(logs.map((log) => log.blockNumber).filter((b): b is bigint => b !== null))];
      const blocks = await Promise.all(
        uniqueBlockNumbers.map((blockNumber) => client.getBlock({ blockNumber })),
      );
      const timestampByBlock = new Map<bigint, number>(
        uniqueBlockNumbers.map((blockNumber, index) => [blockNumber, Number(blocks[index].timestamp) * 1000]),
      );

      const trades = logs
        .map((log) => normalizeTradeLog(log, timestampByBlock.get(log.blockNumber as bigint) ?? now, decimals))
        .filter((trade): trade is TokenTradeItem => trade !== null)
        .sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) return BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : 1;
          return a.logIndex - b.logIndex;
        })
        .slice(-MAX_TRADES_RETURNED);

      tradesCache.set(key, { trades, cachedAt: now });
      lastReadAt = now;
      lastReadOk = true;
      return trades;
    } catch {
      lastReadAt = now;
      lastReadOk = false;
      return cached?.trades ?? null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, readPromise);
  return readPromise;
}

export type TokenTradesCacheHealth = {
  lastReadAt: number | null;
  lastReadOk: boolean | null;
  ageMs: number | null;
};

/** Read for the admin `trades-read` System Health stage (rule 10). */
export function getTokenTradesCacheHealth(now = Date.now()): TokenTradesCacheHealth {
  return {
    lastReadAt,
    lastReadOk,
    ageMs: lastReadAt === null ? null : now - lastReadAt,
  };
}

export function resetTokenTradesCacheForTests(): void {
  tradesCache.clear();
  inflight.clear();
  creationBlockCache.clear();
  decimalsCache.clear();
  lastReadAt = null;
  lastReadOk = null;
}
