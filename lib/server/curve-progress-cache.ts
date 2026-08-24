import { createPublicClient, http, type PublicClient } from "viem";
import { HOODLUMS_BONDING_CURVE_READ_ABI } from "@/lib/bonding-curve-config";
import {
  computeBondingCurveGraduationStatus,
  type BondingCurveGraduationStatus,
} from "@/lib/bonding-curve-status";
import { ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";

/**
 * Server-side, TTL-cached on-chain read of one bonding curve's graduation
 * state (issue #412 Part 1: "real curve progress % ... server-side read
 * with caching, never per-card client RPC storms"). Every request within
 * the TTL window reuses the same cached snapshot across every visitor, and
 * concurrent cache misses for the same curve share a single in-flight read
 * instead of firing duplicate RPC calls — this is what actually bounds the
 * RPC load from GET /api/token-launches's 30s-poll-sized read rate limit
 * (TOKEN_LAUNCH_READ_LIMIT), not the rate limit alone.
 */
const CACHE_TTL_MS = 20_000;

export type CurveProgressReadClient = Pick<PublicClient, "readContract">;

export type CurveProgressDeps = {
  client?: CurveProgressReadClient;
  now?: number;
};

type CacheEntry = { status: BondingCurveGraduationStatus; cachedAt: number };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<BondingCurveGraduationStatus | null>>();
let lastReadAt: number | null = null;
let lastReadOk: boolean | null = null;

function defaultClient(): CurveProgressReadClient {
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
 * Reads (or reuses a cached read of) a curve's graduation status. Only
 * Robinhood Chain Testnet is supported today, mirroring
 * lib/server/token-launch-reconciliation.ts's own chain restriction;
 * returns `null` for any other chain id rather than guessing an RPC. On a
 * transient read failure, falls back to the last known cached value (still
 * useful for display) instead of surfacing an error to callers, but still
 * records the failure for `getCurveProgressCacheHealth()`.
 */
export async function getCurveProgress(
  chainId: number,
  curveAddress: string,
  deps: CurveProgressDeps = {},
): Promise<BondingCurveGraduationStatus | null> {
  if (chainId !== ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL) return null;

  const now = deps.now ?? Date.now();
  const key = cacheKey(chainId, curveAddress);

  const cached = cache.get(key);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.status;
  }

  const existingInflight = inflight.get(key);
  if (existingInflight) return existingInflight;

  const client = deps.client ?? defaultClient();
  const address = curveAddress as `0x${string}`;

  const readPromise = (async (): Promise<BondingCurveGraduationStatus | null> => {
    try {
      const [funded, graduated, realNativeReserveWei, graduationTargetWei, liquidityPool] = await Promise.all([
        client.readContract({ address, abi: HOODLUMS_BONDING_CURVE_READ_ABI, functionName: "funded" }),
        client.readContract({ address, abi: HOODLUMS_BONDING_CURVE_READ_ABI, functionName: "graduated" }),
        client.readContract({ address, abi: HOODLUMS_BONDING_CURVE_READ_ABI, functionName: "realNativeReserve" }),
        client.readContract({ address, abi: HOODLUMS_BONDING_CURVE_READ_ABI, functionName: "graduationTarget" }),
        client.readContract({ address, abi: HOODLUMS_BONDING_CURVE_READ_ABI, functionName: "liquidityPool" }),
      ]);
      const status = computeBondingCurveGraduationStatus({
        funded: funded as boolean,
        graduated: graduated as boolean,
        realNativeReserveWei: realNativeReserveWei as bigint,
        graduationTargetWei: graduationTargetWei as bigint,
        liquidityPool: liquidityPool as `0x${string}`,
      });
      cache.set(key, { status, cachedAt: now });
      lastReadAt = now;
      lastReadOk = true;
      return status;
    } catch {
      lastReadAt = now;
      lastReadOk = false;
      return cached?.status ?? null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, readPromise);
  return readPromise;
}

export type CurveProgressCacheHealth = {
  lastReadAt: number | null;
  lastReadOk: boolean | null;
  ageMs: number | null;
};

/** Read for the admin `curve-progress-read` System Health stage (rule 10). */
export function getCurveProgressCacheHealth(now = Date.now()): CurveProgressCacheHealth {
  return {
    lastReadAt,
    lastReadOk,
    ageMs: lastReadAt === null ? null : now - lastReadAt,
  };
}

export function resetCurveProgressCacheForTests(): void {
  cache.clear();
  inflight.clear();
  lastReadAt = null;
  lastReadOk = null;
}
