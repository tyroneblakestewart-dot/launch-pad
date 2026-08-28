import { createPublicClient, http, parseAbiItem, type Address, type PublicClient } from "viem";
import { ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getTokenLaunchesStore } from "@/lib/server/token-launches-store";
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
 *
 * issue #433: the original implementation derived a curve's creation block
 * via binary search on historical `eth_getCode`. Robinhood Chain Testnet's
 * RPC (https://rpc.testnet.chain.robinhood.com) is a PRUNED node — it only
 * serves `eth_getCode` at/near `latest` and errors on any historical state
 * call, so every read 502'd in production. Block HEADERS remain available
 * at any height on a pruned node, so the start block is now derived from
 * `token_launches.created_at` (via
 * lib/server/token-launches-store.ts's `findTokenLaunchCreatedAtByCurveAddress`)
 * binary-searched against `eth_getBlockByNumber` timestamps instead — zero
 * historical-state calls. A curve with no usable launch record (a legacy
 * manually-deployed curve, or a DB read failure) falls back to a bounded
 * scan of the latest `LEGACY_FALLBACK_BLOCK_RANGE` blocks rather than block
 * 0. `eth_getLogs` is chunked into sequential inclusive
 * `LOG_CHUNK_BLOCK_SPAN`-block ranges, conservative against published
 * Robinhood RPC provider limits on a single call's block span.
 */
const TOKENS_PURCHASED_EVENT = parseAbiItem(
  "event TokensPurchased(address indexed buyer, uint256 grossNativeIn, uint256 netNativeIn, uint256 tokensOut, uint256 feeCharged, uint256 virtualTokenReserve, uint256 virtualEthReserve)",
);
const TOKENS_SOLD_EVENT = parseAbiItem(
  "event TokensSold(address indexed seller, uint256 tokensIn, uint256 grossNativeOut, uint256 netNativeOut, uint256 feeCharged, uint256 virtualTokenReserve, uint256 virtualEthReserve)",
);

const TRADES_CACHE_TTL_MS = 10_000;

/** Subtracted from a launch's recorded `created_at` before searching for the start block, so minor clock skew between the DB write and the chain never skips the launch's own earliest trades. */
const CREATION_SAFETY_MARGIN_MS = 10 * 60 * 1000;
/** Bounded scan window used when no usable launch record exists for a curve — never block 0. */
const LEGACY_FALLBACK_BLOCK_RANGE = 200_000n;
/** Conservative vs published Robinhood RPC provider limits on a single eth_getLogs call's block span. */
const LOG_CHUNK_BLOCK_SPAN = 10_000n;

export type TokenTradesReadClient = Pick<PublicClient, "getLogs" | "getBlockNumber" | "getBlock">;

export type TokenTradesDeps = {
  client?: TokenTradesReadClient;
  now?: number;
  /** Overridable for tests; defaults to a real lookup via lib/server/token-launches-store.ts. */
  findLaunchCreatedAt?: (chainId: number, curveAddress: string) => Promise<Date | null>;
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

async function defaultFindLaunchCreatedAt(chainId: number, curveAddress: string): Promise<Date | null> {
  return getTokenLaunchesStore().findTokenLaunchCreatedAtByCurveAddress(chainId, curveAddress);
}

function cacheKey(chainId: number, curveAddress: string): string {
  return `${chainId}:${curveAddress.toLowerCase()}`;
}

type TradesCacheEntry = { trades: TokenTrade[]; cachedAt: number };

const tradesCache = new Map<string, TradesCacheEntry>();
const tradesInflight = new Map<string, Promise<TokenTrade[]>>();
// Cached indefinitely per curve: a contract's deployment block never
// changes, so once resolved it never needs re-deriving.
const fromBlockCache = new Map<string, bigint>();
let lastReadAt: number | null = null;
let lastReadOk: boolean | null = null;

function legacyFallbackBlock(latest: bigint): bigint {
  return latest > LEGACY_FALLBACK_BLOCK_RANGE ? latest - LEGACY_FALLBACK_BLOCK_RANGE : 0n;
}

/**
 * Derives the block to start scanning trade events from, using only block
 * HEADERS (`eth_getBlockByNumber`) — never historical state calls a pruned
 * node can't serve. Binary-searches for the first block whose timestamp is
 * >= the curve's recorded launch time (minus a safety margin). Falls back
 * to a bounded recent-block window, never block 0, whenever there's no
 * usable launch record or the sampled headers can't be trusted.
 */
async function resolveFromBlock(
  client: TokenTradesReadClient,
  chainId: number,
  curveAddress: Address,
  latest: bigint,
  findLaunchCreatedAt: (chainId: number, curveAddress: string) => Promise<Date | null>,
): Promise<bigint> {
  const key = cacheKey(chainId, curveAddress);
  const cached = fromBlockCache.get(key);
  if (cached !== undefined) return cached;

  let createdAt: Date | null;
  try {
    createdAt = await findLaunchCreatedAt(chainId, curveAddress);
  } catch {
    createdAt = null;
  }

  if (createdAt === null) {
    const fallback = legacyFallbackBlock(latest);
    fromBlockCache.set(key, fallback);
    return fallback;
  }

  const targetTimestamp = Math.max(0, Math.floor((createdAt.getTime() - CREATION_SAFETY_MARGIN_MS) / 1000));

  const latestBlock = await client.getBlock({ blockNumber: latest });
  const latestTimestamp = Number(latestBlock.timestamp);

  // The launch is newer than the latest observed block's own timestamp
  // (clock skew, or the RPC node lagging) — nothing before "latest" could
  // possibly match, so start there rather than guessing further back.
  if (targetTimestamp >= latestTimestamp) {
    fromBlockCache.set(key, latest);
    return latest;
  }

  const samples: { block: bigint; timestamp: number }[] = [{ block: latest, timestamp: latestTimestamp }];
  function violatesMonotonicity(block: bigint, timestamp: number): boolean {
    return samples.some(
      (sample) =>
        (sample.block < block && sample.timestamp > timestamp) ||
        (sample.block > block && sample.timestamp < timestamp),
    );
  }

  let low = 0n;
  let high = latest;
  while (low < high) {
    const mid = low + (high - low) / 2n;
    const block = await client.getBlock({ blockNumber: mid });
    const timestamp = Number(block.timestamp);

    if (violatesMonotonicity(mid, timestamp)) {
      // The RPC returned headers that aren't consistent with block number
      // order — the binary search invariant no longer holds. Fall back to
      // the same bounded window used for "no usable launch record" rather
      // than trusting a potentially wrong result.
      const fallback = legacyFallbackBlock(latest);
      fromBlockCache.set(key, fallback);
      return fallback;
    }
    samples.push({ block: mid, timestamp });

    if (timestamp >= targetTimestamp) {
      high = mid;
    } else {
      low = mid + 1n;
    }
  }

  fromBlockCache.set(key, low);
  return low;
}

/** Sequential (never concurrent) chunked eth_getLogs reads, merged before normalisation — conservative against provider block-span limits and RPC load. */
async function fetchLogsChunked(
  client: TokenTradesReadClient,
  curveAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
) {
  const allLogs: Awaited<ReturnType<TokenTradesReadClient["getLogs"]>> = [];
  let chunkStart = fromBlock;
  while (chunkStart <= toBlock) {
    const chunkEndCandidate = chunkStart + LOG_CHUNK_BLOCK_SPAN - 1n;
    const chunkEnd = chunkEndCandidate > toBlock ? toBlock : chunkEndCandidate;
    const chunkLogs = await client.getLogs({
      address: curveAddress,
      events: [TOKENS_PURCHASED_EVENT, TOKENS_SOLD_EVENT],
      fromBlock: chunkStart,
      toBlock: chunkEnd,
    });
    allLogs.push(...chunkLogs);
    chunkStart = chunkEnd + 1n;
  }
  return allLogs;
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
  const findLaunchCreatedAt = deps.findLaunchCreatedAt ?? defaultFindLaunchCreatedAt;

  const readPromise = (async (): Promise<TokenTrade[]> => {
    try {
      const latest = await client.getBlockNumber();
      const fromBlock = await resolveFromBlock(client, chainId, curveAddress, latest, findLaunchCreatedAt);
      const logs = await fetchLogsChunked(client, curveAddress, fromBlock, latest);

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
  fromBlockCache.clear();
  lastReadAt = null;
  lastReadOk = null;
}
