import { createPublicClient, http, isAddress, parseAbi, parseAbiItem, type Address, type PublicClient } from "viem";
import { ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { WETH9_ADDRESS_ENV_VAR } from "@/lib/bonding-curve-deploy-config";
import { getTokenLaunchesStore } from "@/lib/server/token-launches-store";
import { computePoolSpotPriceNativePerTokenRaw } from "@/lib/uniswap-v3-spot-price";
import type { TokenTrade, TokenTradeDirection } from "@/lib/token-trade-types";

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
 * locked Uniswap V3 pool — the curve itself never emits another
 * TokensPurchased/TokensSold. The curve's own `Graduated` event (already
 * scanned in the same call as the trade events, at zero extra RPC cost)
 * carries the pool address and its own block number, so pool swaps are read
 * from exactly that block onward and merged into the same trade list, tagged
 * `venue: "pool"`. Because `fromBlock` above always resolves to at or before
 * the curve's creation, and creation always precedes graduation, a graduated
 * curve's `Graduated` event can never fall outside the already-scanned
 * [fromBlock, latest] range — there is no separate graduatedAt-timestamp
 * fallback path to derive the graduation block a second way, since that path
 * could never be reached.
 */
const TOKENS_PURCHASED_EVENT = parseAbiItem(
  "event TokensPurchased(address indexed buyer, uint256 grossNativeIn, uint256 netNativeIn, uint256 tokensOut, uint256 feeCharged, uint256 virtualTokenReserve, uint256 virtualEthReserve)",
);
const TOKENS_SOLD_EVENT = parseAbiItem(
  "event TokensSold(address indexed seller, uint256 tokensIn, uint256 grossNativeOut, uint256 netNativeOut, uint256 feeCharged, uint256 virtualTokenReserve, uint256 virtualEthReserve)",
);
/** Matches contracts/HoodlumsTestBondingCurve.sol's `Graduated` event exactly. */
const GRADUATED_EVENT = parseAbiItem(
  "event Graduated(address indexed pool, uint256 indexed tokenId, uint256 tokenLiquidity, uint256 nativeLiquidity)",
);
/** Standard Uniswap V3 pool `Swap` event — same signature on any V3 deployment. */
const V3_SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);
/** Minimal read needed to tell which side of a pool is the project token vs. native (WETH). */
const POOL_TOKENS_ABI = parseAbi(["function token0() view returns (address)", "function token1() view returns (address)"]);

const TRADES_CACHE_TTL_MS = 4_000;

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
// Cached indefinitely per pool: which side is native never changes either.
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

type RawCurveLog = {
  eventName: "TokensPurchased" | "TokensSold" | "Graduated";
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
    pool?: Address;
  };
  blockNumber: bigint | null;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
};

type RawSwapLog = {
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
 * Reads curve trade + graduation logs for the whole [fromBlock, toBlock]
 * range in a single `eth_getLogs` call first — confirmed to work on this RPC
 * even across a full-chain range. Only a genuine range/size rejection
 * triggers a recursive halving fallback, so a working single call never pays
 * for extra round trips.
 */
async function fetchCurveLogsInRange(
  client: TokenTradesReadClient,
  curveAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawCurveLog[]> {
  try {
    const logs = await client.getLogs({
      address: curveAddress,
      events: [TOKENS_PURCHASED_EVENT, TOKENS_SOLD_EVENT, GRADUATED_EVENT],
      fromBlock,
      toBlock,
    });
    return logs as unknown as RawCurveLog[];
  } catch (error) {
    if (!isLogRangeError(error) || fromBlock >= toBlock) throw error;

    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    const [lower, upper] = await Promise.all([
      fetchCurveLogsInRange(client, curveAddress, fromBlock, mid),
      fetchCurveLogsInRange(client, curveAddress, mid + 1n, toBlock),
    ]);
    return [...lower, ...upper];
  }
}

/** Same single-call-first/halving strategy as `fetchCurveLogsInRange`, for a graduated curve's locked pool. */
async function fetchPoolSwapLogsInRange(
  client: TokenTradesReadClient,
  poolAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawSwapLog[]> {
  try {
    const logs = await client.getLogs({
      address: poolAddress,
      events: [V3_SWAP_EVENT],
      fromBlock,
      toBlock,
    });
    return logs as unknown as RawSwapLog[];
  } catch (error) {
    if (!isLogRangeError(error) || fromBlock >= toBlock) throw error;

    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    const [lower, upper] = await Promise.all([
      fetchPoolSwapLogsInRange(client, poolAddress, fromBlock, mid),
      fetchPoolSwapLogsInRange(client, poolAddress, mid + 1n, toBlock),
    ]);
    return [...lower, ...upper];
  }
}

function normalizeTradeLog(log: RawCurveLog, timestampByBlock: Map<bigint, number>): TokenTrade | null {
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
  };
}

/**
 * Normalizes a Uniswap V3 pool `Swap` log into a `TokenTrade` (issue #466).
 * Uniswap convention: a positive amount means that token flowed INTO the
 * pool (from the trader), negative means it flowed OUT (to the trader) — so
 * a negative project-token delta is a buy (the trader received tokens).
 * `wallet` follows the issue's own trader convention: `recipient` for a buy
 * (who received the output), `sender` for a sell — either can be a router or
 * aggregator contract rather than the end user's own wallet, unlike a curve
 * trade, which the curve's own `msg.sender` always is.
 */
function normalizePoolSwapLog(
  log: RawSwapLog,
  timestampByBlock: Map<bigint, number>,
  nativeIsToken0: boolean,
): TokenTrade | null {
  if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) return null;
  const blockTimestamp = timestampByBlock.get(log.blockNumber);
  if (blockTimestamp === undefined) return null;

  const { sender, recipient, amount0, amount1, sqrtPriceX96 } = log.args;
  if (!sender || !recipient || amount0 === undefined || amount1 === undefined || sqrtPriceX96 === undefined) return null;

  const tokenDelta = nativeIsToken0 ? amount1 : amount0;
  const nativeDelta = nativeIsToken0 ? amount0 : amount1;
  const direction: TokenTradeDirection = tokenDelta < 0n ? "buy" : "sell";
  const wallet = direction === "buy" ? recipient : sender;
  const nativeAmountRaw = (nativeDelta < 0n ? -nativeDelta : nativeDelta).toString();

  return {
    direction,
    wallet,
    tokenAmountRaw: (tokenDelta < 0n ? -tokenDelta : tokenDelta).toString(),
    nativeAmountRaw,
    grossNativeAmountRaw: nativeAmountRaw,
    feeChargedRaw: "0",
    blockNumber: log.blockNumber.toString(),
    blockTimestamp,
    txHash: log.transactionHash,
    logIndex: log.logIndex,
    venue: "pool",
    spotPriceNativePerTokenRaw: computePoolSpotPriceNativePerTokenRaw(sqrtPriceX96, nativeIsToken0).toString(),
  };
}

function resolveWeth9Address(): Address | null {
  const value = process.env[WETH9_ADDRESS_ENV_VAR];
  return value && isAddress(value) ? (value as Address) : null;
}

/**
 * Reads (or reuses the indefinite cache of) which side of a graduated pool
 * is the native (WETH) leg, by comparing the pool's own `token0()`/
 * `token1()` against the configured `HOODLUMS_BONDING_CURVE_WETH9_ADDRESS`.
 * Returns null — never a guess — when that env var is unset/invalid or
 * matches neither side, in which case the caller skips pool trades for this
 * read rather than risk mislabeling buy/sell direction.
 */
async function resolvePoolNativeIsToken0(client: TokenTradesReadClient, poolAddress: Address): Promise<boolean | null> {
  const key = poolAddress.toLowerCase();
  const cached = poolTokenOrderCache.get(key);
  if (cached !== undefined) return cached;

  const weth9 = resolveWeth9Address();
  if (!weth9) return null;

  const [token0, token1] = await Promise.all([
    client.readContract({ address: poolAddress, abi: POOL_TOKENS_ABI, functionName: "token0" }),
    client.readContract({ address: poolAddress, abi: POOL_TOKENS_ABI, functionName: "token1" }),
  ]);

  const wethLower = weth9.toLowerCase();
  let nativeIsToken0: boolean;
  if ((token0 as string).toLowerCase() === wethLower) {
    nativeIsToken0 = true;
  } else if ((token1 as string).toLowerCase() === wethLower) {
    nativeIsToken0 = false;
  } else {
    return null;
  }

  poolTokenOrderCache.set(key, nativeIsToken0);
  return nativeIsToken0;
}

/**
 * Reads a graduated curve's locked pool's Swap history from `fromBlock`
 * (the curve's own graduation block) onward. Any failure here — an
 * unconfigured WETH9 address, an RPC error reading token0/token1, or a
 * genuine getLogs failure — degrades to no pool trades for this read cycle
 * rather than failing the whole response; the curve's own trade history
 * must never be lost because the newer pool-read path had a problem.
 */
async function readPoolTrades(
  client: TokenTradesReadClient,
  poolAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<TokenTrade[]> {
  try {
    const nativeIsToken0 = await resolvePoolNativeIsToken0(client, poolAddress);
    if (nativeIsToken0 === null) return [];

    const swapLogs = await fetchPoolSwapLogsInRange(client, poolAddress, fromBlock, toBlock);
    if (swapLogs.length === 0) return [];

    const blockNumbers = [...new Set(swapLogs.map((log) => log.blockNumber).filter((value): value is bigint => value !== null))];
    const blocks = await Promise.all(blockNumbers.map((blockNumber) => client.getBlock({ blockNumber })));
    const timestampByBlock = new Map(blocks.map((block) => [block.number, Number(block.timestamp)]));

    return swapLogs
      .map((log) => normalizePoolSwapLog(log, timestampByBlock, nativeIsToken0))
      .filter((trade): trade is TokenTrade => trade !== null);
  } catch {
    return [];
  }
}

/**
 * Reads (or reuses a ~4s cached read of) a curve's full trade history,
 * newest first — including, once graduated, its locked pool's own swap
 * history (issue #466). Concurrent cache misses for the same curve share one
 * in-flight read. Throws `TokenTradesReadError` on a genuine RPC failure
 * reading the curve itself — callers must never treat that the same as a
 * real zero-trade response.
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
      const curveLogs = await fetchCurveLogsInRange(client, curveAddress, fromBlock, latest);

      const graduatedLog = curveLogs.find(
        (log): log is RawCurveLog & { blockNumber: bigint; args: { pool: Address } } =>
          log.eventName === "Graduated" && log.blockNumber !== null && Boolean(log.args.pool),
      );
      const tradeLogs = curveLogs.filter((log) => log.eventName !== "Graduated");

      const poolTrades = graduatedLog
        ? await readPoolTrades(client, graduatedLog.args.pool, graduatedLog.blockNumber, latest)
        : [];

      const blockNumbers = [...new Set(tradeLogs.map((log) => log.blockNumber).filter((value): value is bigint => value !== null))];
      const blocks = await Promise.all(blockNumbers.map((blockNumber) => client.getBlock({ blockNumber })));
      const timestampByBlock = new Map(blocks.map((block) => [block.number, Number(block.timestamp)]));

      const curveTrades = tradeLogs
        .map((log) => normalizeTradeLog(log, timestampByBlock))
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
  poolTokenOrderCache.clear();
  lastReadAt = null;
  lastReadOk = null;
}
