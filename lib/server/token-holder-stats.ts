import { createPublicClient, http, isAddress, parseAbi, parseAbiItem, zeroAddress, type Address } from "viem";
import { ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { resolveTokenCurveAddress } from "@/lib/server/token-launch-curve-lookup";
import {
  BLOCKSCOUT_API_BASE,
  fetchJson,
  type BlockscoutHolderItem,
  type BlockscoutHoldersPage,
} from "@/lib/server/token-holders";
import {
  fetchLogsInRange,
  getTokenTrades,
  resolveStartBlock,
  type TokenTradesReadClient,
} from "@/lib/server/token-trades-rpc";
import type { TokenHolderBreakdown } from "@/lib/token-holder-stats-types";
import type { TokenTrade } from "@/lib/token-trade-types";

/**
 * Holder breakdown for the token page's Stats panel (token page v2 part 3):
 * Top 10 %, Dev % and Snipers %, per the rulings in
 * design/token-page-v2/token-page-data-inventory.md section 8:
 *
 * - Top 10 %: Blockscout's holder list minus the curve and LP addresses, over
 *   total supply.
 * - Dev %: `balanceOf(creator)` over total supply.
 * - Snipers %: distinct buyers whose first `TokensPurchased` is within 10
 *   blocks of `CurveFunded`, current `balanceOf` summed, over total supply.
 *
 * Every denominator is the token's live on-chain `totalSupply()` (the token is
 * burnable, so a stored supply could drift), and every numerator that can be
 * read on-chain is read on-chain — Blockscout is only used for the one thing
 * the chain cannot answer directly, "who are the largest holders". The curve
 * itself is resolved exactly as the token page does
 * (lib/server/token-launch-curve-lookup.ts) and then confirmed on-chain via
 * `token()` before it is trusted, because that lookup's legacy env fallback
 * can name a curve that trades a different token.
 *
 * Reuses lib/server/token-trades-rpc.ts's RPC configuration, start-block
 * resolution and single-call `eth_getLogs` reader (the RPC is pruned — see
 * that module's notes) rather than re-deriving them, and takes the curve's
 * buy history from the same cached `getTokenTrades` read the page already
 * polls, so the only new chain reads per refresh are one small `CurveFunded`
 * log query, a handful of view calls and one `balanceOf` per sniper wallet.
 *
 * Degrades per row, never as a whole: a Blockscout outage nulls Top 10 %
 * only, a missing/unverified curve nulls Dev % and Snipers % only. A genuine
 * RPC failure throws `TokenHolderStatsReadError` — the route turns that into
 * a 502, never a zero-filled breakdown.
 */

export const SNIPER_WINDOW_BLOCKS = 10n;

/** How many sniper wallets' balances are read at most — the 10-block window realistically holds a handful. */
export const MAX_SNIPER_BALANCE_READS = 100;

const HOLDER_STATS_CACHE_TTL_MS = 60_000;
const BLOCKSCOUT_TIMEOUT_MS = 6_000;
const TOP_HOLDER_COUNT = 10;

const CURVE_FUNDED_EVENT = parseAbiItem("event CurveFunded(address indexed creator, uint256 tokenAmount)");
const CURVE_FUNDED_EVENTS = [CURVE_FUNDED_EVENT];

const CURVE_IDENTITY_ABI = parseAbi([
  "function token() view returns (address)",
  "function creator() view returns (address)",
  "function liquidityPool() view returns (address)",
]);

const ERC20_SUPPLY_ABI = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

export class TokenHolderStatsReadError extends Error {}

export type TokenHolderStatsDeps = {
  client?: TokenTradesReadClient;
  now?: number;
  /** Overridable for tests; defaults to the shared cached curve trade read. */
  readTrades?: (chainId: number, curveAddress: Address) => Promise<TokenTrade[]>;
  /** Overridable for tests; defaults to Blockscout's `/tokens/{address}/holders` page. `null` = unavailable. */
  fetchHolders?: (tokenAddress: string) => Promise<BlockscoutHolderItem[] | null>;
};

type RawCurveFundedLog = { eventName?: string; blockNumber: bigint | null };

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

async function defaultFetchHolders(tokenAddress: string): Promise<BlockscoutHolderItem[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BLOCKSCOUT_TIMEOUT_MS);
  try {
    const page = await fetchJson<BlockscoutHoldersPage>(
      `${BLOCKSCOUT_API_BASE}/tokens/${encodeURIComponent(tokenAddress)}/holders`,
      controller.signal,
    );
    if (!page || !Array.isArray(page.items)) return null;
    return page.items;
  } finally {
    clearTimeout(timeout);
  }
}

function cacheKey(chainId: number, tokenAddress: string): string {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

type CacheEntry = { stats: TokenHolderBreakdown; cachedAt: number };

const statsCache = new Map<string, CacheEntry>();
const statsInflight = new Map<string, Promise<TokenHolderBreakdown>>();
// A curve is funded exactly once, so its CurveFunded block never changes.
const fundedBlockCache = new Map<string, bigint>();
let lastReadAt: number | null = null;
let lastReadOk: boolean | null = null;

/**
 * Share of `total` held by `part`, scaled 0–100 with two decimals of
 * precision kept (the panel displays one). Pure bigint arithmetic — never a
 * float over 18-decimal raw amounts. Exported for the unit tests.
 */
export function shareOfSupplyPercent(part: bigint, total: bigint): number | null {
  if (total <= 0n || part < 0n) return null;
  return Number((part * 10_000n) / total) / 100;
}

function parseRawBalance(value: string | undefined): bigint {
  if (!value || !/^\d+$/.test(value)) return 0n;
  return BigInt(value);
}

/**
 * Sums the ten largest holder balances after removing the excluded
 * addresses (curve, pool). Pure; exported for the unit tests. Returns null
 * when nothing is left to rank — a brand-new token whose only "holder" is
 * the curve has no Top 10 yet (design ruling: New → "—").
 */
export function sumTopHolderBalances(items: BlockscoutHolderItem[], excluded: Set<string>): bigint | null {
  const balances = items
    .filter((item) => {
      const hash = item.address?.hash?.toLowerCase();
      return Boolean(hash) && !excluded.has(hash!);
    })
    .map((item) => parseRawBalance(item.value))
    .filter((balance) => balance > 0n)
    .sort((a, b) => (a === b ? 0 : a > b ? -1 : 1))
    .slice(0, TOP_HOLDER_COUNT);
  if (balances.length === 0) return null;
  return balances.reduce((sum, balance) => sum + balance, 0n);
}

/**
 * The distinct wallets whose FIRST curve buy landed at or before
 * `fundedBlock + SNIPER_WINDOW_BLOCKS`. Pool swaps (`venue: "pool"`) are
 * post-graduation and can never be sniping a launch, so they are ignored.
 * Pure; exported for the unit tests. Order: earliest first buy first, so a
 * cap on balance reads keeps the earliest snipers.
 */
export function selectSniperWallets(trades: TokenTrade[], fundedBlock: bigint): Address[] {
  const firstBuyBlockByWallet = new Map<string, { wallet: Address; block: bigint }>();
  for (const trade of trades) {
    if (trade.direction !== "buy" || (trade.venue ?? "curve") !== "curve") continue;
    if (!/^\d+$/.test(trade.blockNumber)) continue;
    const block = BigInt(trade.blockNumber);
    const key = trade.wallet.toLowerCase();
    const existing = firstBuyBlockByWallet.get(key);
    if (!existing || block < existing.block) firstBuyBlockByWallet.set(key, { wallet: trade.wallet, block });
  }
  const cutoff = fundedBlock + SNIPER_WINDOW_BLOCKS;
  return [...firstBuyBlockByWallet.values()]
    .filter((entry) => entry.block <= cutoff)
    .sort((a, b) => (a.block === b.block ? 0 : a.block < b.block ? -1 : 1))
    .map((entry) => entry.wallet);
}

async function readCurveFundedBlock(
  client: TokenTradesReadClient,
  chainId: number,
  curveAddress: Address,
): Promise<bigint | null> {
  const key = curveAddress.toLowerCase();
  const cached = fundedBlockCache.get(key);
  if (cached !== undefined) return cached;

  const latest = await client.getBlockNumber();
  const fromBlock = await resolveStartBlock(client, chainId, curveAddress, latest);
  const logs = (await fetchLogsInRange(client, curveAddress, CURVE_FUNDED_EVENTS, fromBlock, latest)) as RawCurveFundedLog[];
  const funded = logs.find((log) => log.blockNumber !== null);
  if (!funded || funded.blockNumber === null) return null;
  fundedBlockCache.set(key, funded.blockNumber);
  return funded.blockNumber;
}

type CurveIdentity = { curve: Address; creator: Address; liquidityPool: Address | null };

/**
 * Resolves the curve trading this token and confirms it on-chain. Returns
 * null when there is no curve, or the resolved curve's `token()` is not this
 * token (the legacy single-curve env fallback can point at another token's
 * curve — never trust it blind).
 */
async function resolveVerifiedCurve(
  client: TokenTradesReadClient,
  chainId: number,
  tokenAddress: Address,
): Promise<CurveIdentity | null> {
  const curve = await resolveTokenCurveAddress(chainId, tokenAddress);
  if (!curve) return null;

  const [curveToken, creator, liquidityPool] = await Promise.all([
    client.readContract({ address: curve, abi: CURVE_IDENTITY_ABI, functionName: "token" }) as Promise<Address>,
    client.readContract({ address: curve, abi: CURVE_IDENTITY_ABI, functionName: "creator" }) as Promise<Address>,
    client.readContract({ address: curve, abi: CURVE_IDENTITY_ABI, functionName: "liquidityPool" }) as Promise<Address>,
  ]);
  if (curveToken.toLowerCase() !== tokenAddress.toLowerCase()) return null;

  return {
    curve,
    creator,
    liquidityPool: liquidityPool && liquidityPool.toLowerCase() !== zeroAddress ? liquidityPool : null,
  };
}

async function computeBreakdown(
  client: TokenTradesReadClient,
  chainId: number,
  tokenAddress: Address,
  deps: TokenHolderStatsDeps,
): Promise<TokenHolderBreakdown> {
  const readTrades = deps.readTrades ?? getTokenTrades;
  const fetchHolders = deps.fetchHolders ?? defaultFetchHolders;

  const [totalSupply, identity, holderItems] = await Promise.all([
    client.readContract({ address: tokenAddress, abi: ERC20_SUPPLY_ABI, functionName: "totalSupply" }) as Promise<bigint>,
    resolveVerifiedCurve(client, chainId, tokenAddress),
    // Blockscout is best-effort: a failure here nulls Top 10 % only.
    fetchHolders(tokenAddress).catch(() => null),
  ]);

  const excluded = new Set<string>();
  if (identity) {
    excluded.add(identity.curve.toLowerCase());
    if (identity.liquidityPool) excluded.add(identity.liquidityPool.toLowerCase());
  }

  const top10Sum = holderItems ? sumTopHolderBalances(holderItems, excluded) : null;
  const top10Percent = top10Sum === null ? null : shareOfSupplyPercent(top10Sum, totalSupply);

  if (!identity) {
    return {
      top10Percent,
      devPercent: null,
      snipersPercent: null,
      sniperWalletCount: 0,
      curveAddress: null,
      liquidityPoolAddress: null,
    };
  }

  const [creatorBalance, fundedBlock, trades] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: ERC20_SUPPLY_ABI,
      functionName: "balanceOf",
      args: [identity.creator],
    }) as Promise<bigint>,
    readCurveFundedBlock(client, chainId, identity.curve),
    readTrades(chainId, identity.curve),
  ]);

  const devPercent = shareOfSupplyPercent(creatorBalance, totalSupply);

  let snipersPercent: number | null = null;
  let sniperWalletCount = 0;
  if (fundedBlock !== null) {
    const snipers = selectSniperWallets(trades, fundedBlock).slice(0, MAX_SNIPER_BALANCE_READS);
    sniperWalletCount = snipers.length;
    const balances = await Promise.all(
      snipers.map(
        (wallet) =>
          client.readContract({
            address: tokenAddress,
            abi: ERC20_SUPPLY_ABI,
            functionName: "balanceOf",
            args: [wallet],
          }) as Promise<bigint>,
      ),
    );
    const sniperTotal = balances.reduce((sum, balance) => sum + balance, 0n);
    snipersPercent = shareOfSupplyPercent(sniperTotal, totalSupply);
  }

  return {
    top10Percent,
    devPercent,
    snipersPercent,
    sniperWalletCount,
    curveAddress: identity.curve,
    liquidityPoolAddress: identity.liquidityPool,
  };
}

/**
 * Reads (or reuses a ~60s cached read of) the holder breakdown for a token.
 * Concurrent cache misses for the same token share one in-flight read.
 * Throws `TokenHolderStatsReadError` on a genuine chain-read failure —
 * callers must never present that as a real zero breakdown.
 */
export async function getTokenHolderBreakdown(
  chainId: number,
  tokenAddress: string,
  deps: TokenHolderStatsDeps = {},
): Promise<TokenHolderBreakdown> {
  if (chainId !== ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL) {
    throw new TokenHolderStatsReadError("Holder stats are only available on Robinhood Chain Testnet.");
  }
  if (!isAddress(tokenAddress)) {
    throw new TokenHolderStatsReadError("A valid token address is required.");
  }

  const now = deps.now ?? Date.now();
  const key = cacheKey(chainId, tokenAddress);

  const cached = statsCache.get(key);
  if (cached && now - cached.cachedAt < HOLDER_STATS_CACHE_TTL_MS) return cached.stats;

  const existingInflight = statsInflight.get(key);
  if (existingInflight) return existingInflight;

  const client = deps.client ?? defaultClient();

  const readPromise = (async (): Promise<TokenHolderBreakdown> => {
    try {
      const stats = await computeBreakdown(client, chainId, tokenAddress, deps);
      statsCache.set(key, { stats, cachedAt: now });
      lastReadAt = now;
      lastReadOk = true;
      return stats;
    } catch (error) {
      lastReadAt = now;
      lastReadOk = false;
      throw error instanceof TokenHolderStatsReadError
        ? error
        : new TokenHolderStatsReadError(error instanceof Error ? error.message : "Holder stats read failed.");
    } finally {
      statsInflight.delete(key);
    }
  })();

  statsInflight.set(key, readPromise);
  return readPromise;
}

export type TokenHolderStatsReadHealth = {
  lastReadAt: number | null;
  lastReadOk: boolean | null;
  ageMs: number | null;
};

/** Read for the admin `holder-stats-read` System Health stage (rule 10). */
export function getTokenHolderStatsReadHealth(now = Date.now()): TokenHolderStatsReadHealth {
  return {
    lastReadAt,
    lastReadOk,
    ageMs: lastReadAt === null ? null : now - lastReadAt,
  };
}

export function resetTokenHolderStatsForTests(): void {
  statsCache.clear();
  statsInflight.clear();
  fundedBlockCache.clear();
  lastReadAt = null;
  lastReadOk = null;
}
