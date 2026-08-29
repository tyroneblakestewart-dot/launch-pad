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
 * issue #434: production probes against the live Robinhood testnet RPC
 * confirmed the node is pruned — historical `eth_getCode` reads fail with
 * "missing trie node ... not found" for anything but a very recent block, so
 * the original binary search for a curve's creation block (which called
 * `eth_getCode` at arbitrary historical blocks) 502'd on every request. Block
 * *headers* (`eth_getBlockByNumber`) are always served regardless of pruning,
 * so the start block is now derived from a real timestamp instead: the
 * recorded launch's `created_at` (minus a safety margin), binary-searched
 * against block headers. `getCode` is not part of this module's RPC client
 * at all any more.
 */
const TOKENS_PURCHASED_EVENT = parseAbiItem(
  "event TokensPurchased(address indexed buyer, uint256 grossNativeIn, uint256 netNativeIn, uint256 tokensOut, uint256 feeCharged, uint256 virtualTokenReserve, uint256 virtualEthReserve)",
);
const TOKENS_SOLD_EVENT = parseAbiItem(
  "event TokensSold(address indexed seller, uint256 tokensIn, uint256 grossNativeOut, uint256 netNativeOut, uint256 feeCharged, uint256 virtualTokenReserve, uint256 virtualEthReserve)",
);

const TRADES_CACHE_TTL_MS = 10_000;

// How far before the recorded launch timestamp to start scanning, so a few
// minutes of clock/RPC-timestamp skew around the actual deployment can never
// cause the real creation block to be skipped.
const CREATION_TIMESTAMP_SAFETY_MARGIN_SECONDS = 10 * 60;

// Used whenever there's no usable launch record (unrecorded/legacy curve, or
// a DB lookup failure) to derive a real timestamp from: the latest 200,000
// blocks. Chosen to comfortably cover this chain's block production since a
// realistic launch age without leaning on historical state reads at all.
// The resolved start block is never allowed to be block 0.
const FALLBACK_SCAN_BLOCK_WINDOW = 200_000n;

// A single eth_getLogs call across the whole resolved range works on this
// RPC (confirmed by a full fromBlock=1..latest probe) — only split when the
// provider actually rejects a call for being too large. This chain produces
// blocks extremely fast, so unconditionally chunking into small fixed
// windows would turn one read into hundreds of sequential RPC calls; instead
// a rejected call is halved recursively until each half succeeds.
function isLogRangeError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("range") ||
    message.includes("too many") ||
    message.includes("too large") ||
    message.includes("limit exceeded") ||
    message.includes("block limit")
  );
}

export type TokenTradesReadClient = Pick<PublicClient, "getLogs" | "getBlockNumber" | "getBlock">;

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
const startBlockCache = new Map<string, bigint>();
let lastReadAt: number | null = null;
let lastReadOk: boolean | null = null;

function fallbackStartBlock(latest: bigint): bigint {
  return latest > FALLBACK_SCAN_BLOCK_WINDOW ? latest - FALLBACK_SCAN_BLOCK_WINDOW : 1n;
}

/**
 * Binary-searches block headers for the first block whose timestamp is >=
 * `targetTimestamp`. Returns null (never a wrong answer) if the sampled
 * timestamps aren't monotonically non-decreasing with block number — a
 * real chain never does this, but a binary search that silently trusted a
 * broken invariant could converge on the wrong block, so any violation
 * aborts the search in favour of the bounded fallback.
 */
async function findFirstBlockAtOrAfterTimestamp(
  client: TokenTradesReadClient,
  latest: bigint,
  targetTimestamp: number,
): Promise<bigint | null> {
  let low = 1n;
  let high = latest;
  let lastBelowTimestamp: number | null = null;
  let lastAtOrAboveTimestamp: number | null = null;

  while (low < high) {
    const mid = low + (high - low) / 2n;
    const block = await client.getBlock({ blockNumber: mid });
    const timestamp = Number(block.timestamp);

    if (
      (lastBelowTimestamp !== null && timestamp < lastBelowTimestamp) ||
      (lastAtOrAboveTimestamp !== null && timestamp > lastAtOrAboveTimestamp)
    ) {
      return null;
    }

    if (timestamp >= targetTimestamp) {
      high = mid;
      lastAtOrAboveTimestamp = timestamp;
    } else {
      low = mid + 1n;
      lastBelowTimestamp = timestamp;
    }
  }

  return low;
}

/**
 * Derives the block to start scanning trade events from, using only block
 * headers/timestamps — never historical `eth_getCode` or `eth_getLogs`
 * calls, which the pruned Robinhood RPC does not support. `latest` is
 * resolved once per read by the caller and threaded through here.
 */
async function resolveStartBlock(
  client: TokenTradesReadClient,
  chainId: number,
  curveAddress: Address,
  latest: bigint,
): Promise<bigint> {
  const key = curveAddress.toLowerCase();
  const cached = startBlockCache.get(key);
  if (cached !== undefined) return cached;

  const fallback = fallbackStartBlock(latest);

  let createdAt: Date | null;
  try {
    createdAt = await getTokenLaunchesStore().findTokenLaunchCreatedAtByCurveAddress(chainId, curveAddress);
  } catch {
    // A DB lookup failure must never block a trade read — the bounded
    // fallback window is always available.
    createdAt = null;
  }

  if (!createdAt) {
    startBlockCache.set(key, fallback);
    return fallback;
  }

  const targetTimestamp = Math.floor(createdAt.getTime() / 1000) - CREATION_TIMESTAMP_SAFETY_MARGIN_SECONDS;

  const latestBlock = await client.getBlock({ blockNumber: latest });
  if (Number(latestBlock.timestamp) < targetTimestamp) {
    // The recorded launch timestamp is somehow ahead of the chain's latest
    // block — a search here could never succeed, so fall back instead.
    startBlockCache.set(key, fallback);
    return fallback;
  }

  const resolved = await findFirstBlockAtOrAfterTimestamp(client, latest, targetTimestamp);
  const startBlock = resolved ?? fallback;
  startBlockCache.set(key, startBlock);
  return startBlock;
}

type RawTradeLog = {
  eventName: "TokensPurchased" | "TokensSold";
  args: {
    buyer?: Address;
    seller?: Address;
    netNativeIn?: bigint;
    netNativeOut?: bigint;
    grossNativeIn?: bigint;
    grossNativeOut?: bigint;
    feeCharged?: bigint;
    tokensOut?: bigint;
    tokensIn?: bigint;
  };
  blockNumber: bigint | null;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
};

/**
 * Reads trade logs for the whole [fromBlock, toBlock] range in a single
 * `eth_getLogs` call first — confirmed to work on this RPC even across a
 * full-chain range. Only a genuine range/size rejection triggers a
 * recursive halving fallback, so a working single call never pays for
 * extra round trips.
 */
async function fetchLogsInRange(
  client: TokenTradesReadClient,
  curveAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawTradeLog[]> {
  try {
    const logs = await client.getLogs({
      address: curveAddress,
      events: [TOKENS_PURCHASED_EVENT, TOKENS_SOLD_EVENT],
      fromBlock,
      toBlock,
    });
    return logs as unknown as RawTradeLog[];
  } catch (error) {
    if (!isLogRangeError(error) || fromBlock >= toBlock) throw error;

    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    const [lower, upper] = await Promise.all([
      fetchLogsInRange(client, curveAddress, fromBlock, mid),
      fetchLogsInRange(client, curveAddress, mid + 1n, toBlock),
    ]);
    return [...lower, ...upper];
  }
}

function normalizeTradeLog(log: RawTradeLog, timestampByBlock: Map<bigint, number>): TokenTrade | null {
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
      grossNativeAmountRaw: log.args.grossNativeIn?.toString(),
      feeChargedRaw: log.args.feeCharged?.toString(),
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
    grossNativeAmountRaw: log.args.grossNativeOut?.toString(),
    feeChargedRaw: log.args.feeCharged?.toString(),
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
      const latest = await client.getBlockNumber();
      const fromBlock = await resolveStartBlock(client, chainId, curveAddress, latest);
      const logs = await fetchLogsInRange(client, curveAddress, fromBlock, latest);

      const blockNumbers = [...new Set(logs.map((log) => log.blockNumber).filter((value): value is bigint => value !== null))];
      const blocks = await Promise.all(blockNumbers.map((blockNumber) => client.getBlock({ blockNumber })));
      const timestampByBlock = new Map(blocks.map((block) => [block.number, Number(block.timestamp)]));

      const trades = logs
        .map((log) => normalizeTradeLog(log, timestampByBlock))
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
  startBlockCache.clear();
  lastReadAt = null;
  lastReadOk = null;
}
