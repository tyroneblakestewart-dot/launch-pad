import { createPublicClient, http, parseAbi, parseAbiItem, type Address, type PublicClient } from "viem";
import { HOODLUMS_BONDING_CURVE_TRADE_ABI } from "@/lib/bonding-curve-config";
import { ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getCurveProgress } from "@/lib/server/curve-progress-cache";
import { getTokenLaunchesStore } from "@/lib/server/token-launches-store";
import { computeSpotPriceNativePerTokenRaw } from "@/lib/uniswap-v3-spot-price";
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
 *
 * issue #466: once a curve graduates, all trading moves to its permanently
 * locked Uniswap V3 pool — this module now also reads that pool's own `Swap`
 * events (from the graduation block onward) and normalizes them into the
 * exact same `TokenTrade` shape (`venue: "pool"`), so the chart/header
 * price/Stats/Recent trades never freeze at graduation. The curve's own
 * `Graduated` event is folded into the same single `TokensPurchased`/
 * `TokensSold` log query (zero extra RPC cost pre-graduation) and is the
 * primary source for the pool address and graduation block; a curve without
 * a usable launch record (whose log range may have started from the bounded
 * fallback window below rather than true creation, and so could miss an
 * older `Graduated` event) falls back to a direct graduation-status read
 * (lib/server/curve-progress-cache.ts, already cached/deduped) plus the
 * recorded `graduated_at` timestamp, via the same block-header binary search
 * used for the curve's own start block.
 */
const TOKENS_PURCHASED_EVENT = parseAbiItem(
  "event TokensPurchased(address indexed buyer, uint256 grossNativeIn, uint256 netNativeIn, uint256 tokensOut, uint256 feeCharged, uint256 virtualTokenReserve, uint256 virtualEthReserve)",
);
const TOKENS_SOLD_EVENT = parseAbiItem(
  "event TokensSold(address indexed seller, uint256 tokensIn, uint256 grossNativeOut, uint256 netNativeOut, uint256 feeCharged, uint256 virtualTokenReserve, uint256 virtualEthReserve)",
);
const GRADUATED_EVENT = parseAbiItem(
  "event Graduated(address indexed pool, uint256 indexed tokenId, uint256 tokenLiquidity, uint256 nativeLiquidity)",
);
const CURVE_EVENTS = [TOKENS_PURCHASED_EVENT, TOKENS_SOLD_EVENT, GRADUATED_EVENT];

const SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);
const SWAP_EVENTS = [SWAP_EVENT];

/** Only `token0()` is read — the pool is by construction exactly the platform-token/WETH pair, so whichever side isn't the platform token is WETH. */
const POOL_TOKEN0_ABI = parseAbi(["function token0() view returns (address)"]);

// issue #466: TTL tightened 10s -> 4s so a trade appears for other viewers
// within roughly one 5s client poll interval instead of up to ~20s.
const TRADES_CACHE_TTL_MS = 4_000;

// How far before the recorded launch timestamp to start scanning, so a few
// minutes of clock/RPC-timestamp skew around the actual deployment can never
// cause the real creation block to be skipped.
const CREATION_TIMESTAMP_SAFETY_MARGIN_SECONDS = 10 * 60;

// Same safety margin, applied to a recorded graduation timestamp when the
// curve's own Graduated event wasn't found within the fetched log range.
const GRADUATION_TIMESTAMP_SAFETY_MARGIN_SECONDS = 10 * 60;

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

export type TokenTradesReadClient = Pick<PublicClient, "getLogs" | "getBlockNumber" | "getBlock" | "readContract">;

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
// Cached indefinitely per curve once resolved: a curve graduates at most
// once, so its pool address and graduation block never change afterward.
// Never cached while still null (not graduated yet) — that must be
// re-checked on every read.
type PoolInfo = { poolAddress: Address; startBlock: bigint };
const poolInfoCache = new Map<string, PoolInfo>();
// Cached indefinitely per pool: which side of the pool the platform token
// sits on never changes.
const poolTokenOrderCache = new Map<string, boolean>();
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
 * Derives a block from a real timestamp (minus a safety margin already
 * applied by the caller), using only block headers — never historical
 * `eth_getCode` or `eth_getLogs`, which the pruned Robinhood RPC does not
 * support. `targetTimestamp` of `null` (no usable timestamp on hand) goes
 * straight to the bounded fallback window. Shared by both the curve's own
 * start-block resolution and the post-graduation pool's start-block
 * resolution (issue #466).
 */
async function resolveBlockFromTimestamp(
  client: TokenTradesReadClient,
  latest: bigint,
  targetTimestamp: number | null,
): Promise<bigint> {
  const fallback = fallbackStartBlock(latest);
  if (targetTimestamp === null) return fallback;

  const latestBlock = await client.getBlock({ blockNumber: latest });
  if (Number(latestBlock.timestamp) < targetTimestamp) {
    // The target timestamp is somehow ahead of the chain's latest block — a
    // search here could never succeed, so fall back instead.
    return fallback;
  }

  const resolved = await findFirstBlockAtOrAfterTimestamp(client, latest, targetTimestamp);
  return resolved ?? fallback;
}

/**
 * Derives the block to start scanning curve trade events from. `latest` is
 * resolved once per read by the caller and threaded through here.
 */
export async function resolveStartBlock(
  client: TokenTradesReadClient,
  chainId: number,
  curveAddress: Address,
  latest: bigint,
): Promise<bigint> {
  const key = curveAddress.toLowerCase();
  const cached = startBlockCache.get(key);
  if (cached !== undefined) return cached;

  let createdAt: Date | null;
  try {
    createdAt = await getTokenLaunchesStore().findTokenLaunchCreatedAtByCurveAddress(chainId, curveAddress);
  } catch {
    // A DB lookup failure must never block a trade read — the bounded
    // fallback window is always available.
    createdAt = null;
  }

  const targetTimestamp = createdAt
    ? Math.floor(createdAt.getTime() / 1000) - CREATION_TIMESTAMP_SAFETY_MARGIN_SECONDS
    : null;
  const startBlock = await resolveBlockFromTimestamp(client, latest, targetTimestamp);
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
    virtualTokenReserve?: bigint;
    virtualEthReserve?: bigint;
  };
  blockNumber: bigint | null;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
};

type RawGraduatedLog = {
  eventName: "Graduated";
  args: { pool?: Address };
  blockNumber: bigint | null;
};

type RawCurveLog = RawTradeLog | RawGraduatedLog;

type RawSwapLog = {
  eventName: "Swap";
  args: {
    sender?: Address;
    recipient?: Address;
    amount0?: bigint;
    amount1?: bigint;
    sqrtPriceX96?: bigint;
  };
  blockNumber: bigint | null;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
};

/**
 * Reads logs for the whole [fromBlock, toBlock] range in a single
 * `eth_getLogs` call first — confirmed to work on this RPC even across a
 * full-chain range. Only a genuine range/size rejection triggers a
 * recursive halving fallback, so a working single call never pays for
 * extra round trips. Shared by the curve's own trade/graduation log read and
 * the post-graduation pool's swap log read (issue #466).
 */
export async function fetchLogsInRange(
  client: TokenTradesReadClient,
  address: Address,
  events: readonly unknown[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<unknown[]> {
  try {
    return await client.getLogs({ address, events, fromBlock, toBlock } as Parameters<TokenTradesReadClient["getLogs"]>[0]);
  } catch (error) {
    if (!isLogRangeError(error) || fromBlock >= toBlock) throw error;

    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    const [lower, upper] = await Promise.all([
      fetchLogsInRange(client, address, events, fromBlock, mid),
      fetchLogsInRange(client, address, events, mid + 1n, toBlock),
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
      virtualTokenReserveRaw: log.args.virtualTokenReserve?.toString(),
      virtualEthReserveRaw: log.args.virtualEthReserve?.toString(),
      venue: "curve",
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
    virtualTokenReserveRaw: log.args.virtualTokenReserve?.toString(),
    virtualEthReserveRaw: log.args.virtualEthReserve?.toString(),
    venue: "curve",
  };
}

/**
 * Normalizes a Uniswap V3 pool `Swap` event into the shared `TokenTrade`
 * shape (issue #466 item 2). Direction is buy when the platform token's own
 * delta is negative (tokens left the pool to the trader), sell when
 * positive. `sender`/`recipient` are the pool's own event fields — for a
 * router-mediated swap (the common case) `sender` is typically the router,
 * not the end user, and for an output-in-native swap the router may set
 * `recipient` to itself too before forwarding native currency onward, so
 * the resolved wallet can be a router address rather than the real trader.
 * There is no protocol fee on a pool trade, so `feeChargedRaw` is always
 * "0" and `grossNativeAmountRaw` mirrors `nativeAmountRaw` (no separate
 * gross/net split), keeping lib/token-trade-stats.ts's sell-volume
 * aggregation (which reads `grossNativeAmountRaw`) correct for pool trades
 * too.
 */
function normalizePoolSwapLog(
  log: RawSwapLog,
  tokenIsToken0: boolean,
  timestampByBlock: Map<bigint, number>,
): TokenTrade | null {
  if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) return null;
  const blockTimestamp = timestampByBlock.get(log.blockNumber);
  if (blockTimestamp === undefined) return null;

  const { sender, recipient, amount0, amount1, sqrtPriceX96 } = log.args;
  if (!sender || !recipient || amount0 === undefined || amount1 === undefined || sqrtPriceX96 === undefined) return null;

  const tokenDelta = tokenIsToken0 ? amount0 : amount1;
  const nativeDelta = tokenIsToken0 ? amount1 : amount0;
  if (tokenDelta === 0n) return null;

  const direction = tokenDelta < 0n ? "buy" : "sell";
  const tokenAmount = tokenDelta < 0n ? -tokenDelta : tokenDelta;
  const nativeAmount = nativeDelta < 0n ? -nativeDelta : nativeDelta;
  const nativeAmountRaw = nativeAmount.toString();

  return {
    direction,
    wallet: direction === "buy" ? recipient : sender,
    tokenAmountRaw: tokenAmount.toString(),
    nativeAmountRaw,
    grossNativeAmountRaw: nativeAmountRaw,
    feeChargedRaw: "0",
    blockNumber: log.blockNumber.toString(),
    blockTimestamp,
    txHash: log.transactionHash,
    logIndex: log.logIndex,
    venue: "pool",
    spotPriceNativePerTokenRaw: computeSpotPriceNativePerTokenRaw(sqrtPriceX96, tokenIsToken0),
  };
}

/**
 * Resolves the graduated pool's address and the block to start scanning its
 * `Swap` events from (issue #466). Primary source: the curve's own
 * `Graduated` event, folded into the same log query as the curve's trade
 * events (`graduatedLog`) — zero extra RPC cost. Fallback (only reachable
 * when the curve's log range didn't reach back far enough to have captured
 * a real, older graduation — i.e. no usable launch record for `resolveStartBlock`
 * above): a direct graduation-status read (already cached/deduped by
 * lib/server/curve-progress-cache.ts) for the pool address, plus the
 * recorded `graduated_at` timestamp for the block. Returns null (never
 * cached) while the curve isn't graduated yet — that must be re-checked on
 * every read.
 */
async function resolvePoolInfo(
  client: TokenTradesReadClient,
  chainId: number,
  curveAddress: Address,
  latest: bigint,
  now: number,
  graduatedLog: RawGraduatedLog | null,
): Promise<PoolInfo | null> {
  const key = curveAddress.toLowerCase();
  const cached = poolInfoCache.get(key);
  if (cached) return cached;

  if (graduatedLog?.args.pool && graduatedLog.blockNumber !== null) {
    const info: PoolInfo = { poolAddress: graduatedLog.args.pool, startBlock: graduatedLog.blockNumber };
    poolInfoCache.set(key, info);
    return info;
  }

  let status: Awaited<ReturnType<typeof getCurveProgress>> = null;
  try {
    status = await getCurveProgress(chainId, curveAddress, { client, now });
  } catch {
    status = null;
  }
  if (!status?.liquidityPool) return null;

  let graduatedAt: Date | null;
  try {
    graduatedAt = await getTokenLaunchesStore().findTokenLaunchGraduatedAtByCurveAddress(chainId, curveAddress);
  } catch {
    graduatedAt = null;
  }
  const targetTimestamp = graduatedAt
    ? Math.floor(graduatedAt.getTime() / 1000) - GRADUATION_TIMESTAMP_SAFETY_MARGIN_SECONDS
    : null;
  const startBlock = await resolveBlockFromTimestamp(client, latest, targetTimestamp);

  const info: PoolInfo = { poolAddress: status.liquidityPool, startBlock };
  poolInfoCache.set(key, info);
  return info;
}

/**
 * Resolves whether the platform token sits on the pool's `token0` or
 * `token1` side (issue #466 item 1), cached indefinitely per pool. Only
 * `token0()` is read on the pool (see `POOL_TOKEN0_ABI`'s own comment) plus
 * the curve's own `token()` for comparison.
 */
async function resolveTokenIsToken0(client: TokenTradesReadClient, curveAddress: Address, poolAddress: Address): Promise<boolean> {
  const key = poolAddress.toLowerCase();
  const cached = poolTokenOrderCache.get(key);
  if (cached !== undefined) return cached;

  const [tokenAddress, token0] = await Promise.all([
    client.readContract({ address: curveAddress, abi: HOODLUMS_BONDING_CURVE_TRADE_ABI, functionName: "token" }) as Promise<Address>,
    client.readContract({ address: poolAddress, abi: POOL_TOKEN0_ABI, functionName: "token0" }) as Promise<Address>,
  ]);
  const tokenIsToken0 = tokenAddress.toLowerCase() === token0.toLowerCase();
  poolTokenOrderCache.set(key, tokenIsToken0);
  return tokenIsToken0;
}

/**
 * Reads (or reuses a ~4s cached read of) a curve's full trade history —
 * curve buys/sells plus, once graduated, the locked pool's own swaps —
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
      const curveLogs = (await fetchLogsInRange(client, curveAddress, CURVE_EVENTS, fromBlock, latest)) as RawCurveLog[];

      const graduatedLog =
        (curveLogs.find((log): log is RawGraduatedLog => log.eventName === "Graduated") as RawGraduatedLog | undefined) ??
        null;
      const tradeLogs = curveLogs.filter(
        (log): log is RawTradeLog => log.eventName === "TokensPurchased" || log.eventName === "TokensSold",
      );

      let poolLogs: RawSwapLog[] = [];
      let tokenIsToken0 = true;
      const poolInfo = await resolvePoolInfo(client, chainId, curveAddress, latest, now, graduatedLog);
      if (poolInfo) {
        tokenIsToken0 = await resolveTokenIsToken0(client, curveAddress, poolInfo.poolAddress);
        poolLogs = (await fetchLogsInRange(
          client,
          poolInfo.poolAddress,
          SWAP_EVENTS,
          poolInfo.startBlock,
          latest,
        )) as RawSwapLog[];
      }

      const blockNumbers = [
        ...new Set(
          [...tradeLogs, ...poolLogs].map((log) => log.blockNumber).filter((value): value is bigint => value !== null),
        ),
      ];
      const blocks = await Promise.all(blockNumbers.map((blockNumber) => client.getBlock({ blockNumber })));
      const timestampByBlock = new Map(blocks.map((block) => [block.number, Number(block.timestamp)]));

      const curveTrades = tradeLogs
        .map((log) => normalizeTradeLog(log, timestampByBlock))
        .filter((trade): trade is TokenTrade => trade !== null);
      const poolTrades = poolLogs
        .map((log) => normalizePoolSwapLog(log, tokenIsToken0, timestampByBlock))
        .filter((trade): trade is TokenTrade => trade !== null);

      const trades = [...curveTrades, ...poolTrades].sort(
        (a, b) => b.blockTimestamp - a.blockTimestamp || b.logIndex - a.logIndex,
      );

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
  poolInfoCache.clear();
  poolTokenOrderCache.clear();
  lastReadAt = null;
  lastReadOk = null;
}
