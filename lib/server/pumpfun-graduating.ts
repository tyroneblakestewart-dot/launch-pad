export type GraduatingToken = {
  name: string;
  ticker: string;
  address: string;
  artworkUrl: string;
  progressPercent: number;
  url: string;
};

export type GraduatingFeedResult = { tokens: GraduatingToken[]; error: boolean };

/**
 * Bitquery's streaming GraphQL API, queried server-to-server (issue #291).
 * pump.fun's own frontend API (used before this, and a Moralis-backed
 * version before that, issue #287) is known to block datacenter IPs
 * including Vercel functions, so production requests from this app never
 * succeeded against it. Bitquery indexes the same on-chain pump.fun
 * bonding-curve pools and is built for server callers. This is a polling
 * GraphQL *query* (not a subscription) since the existing 60s cache below
 * already handles polling; a missing/empty BITQUERY_ACCESS_TOKEN, a
 * non-2xx response, or a malformed payload all resolve to an error result
 * so the row just hides itself, same fail-safe contract as before.
 */
const BITQUERY_EAP_ENDPOINT = "https://streaming.bitquery.io/eap";

// The pump.fun bonding-curve program on Solana.
const PUMP_FUN_PROGRAM_ADDRESS = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const FEED_TIMEOUT_MS = 6_000;
const MIN_PROGRESS_PERCENT = 60;
const MAX_PROGRESS_PERCENT = 99;
const MAX_TOKENS = 6;
// Filters both the Bitquery query itself and the mapped results: a pool
// with no trade in this window is dropped rather than shown stale.
const STALE_TRADE_WINDOW_MS = 10 * 60 * 1000;
const GRADUATING_FEED_CACHE_TTL_MS = 60_000;

// Bitquery's own documented example for pump.fun bonding-curve progress:
// progress% = 100 - ((Base.PostAmount - POST_AMOUNT_AT_100_PERCENT) / POST_AMOUNT_RANGE * 100)
const POST_AMOUNT_AT_100_PERCENT = 206_900_000;
const POST_AMOUNT_RANGE = 793_100_000;

// The 60-99% display window, expressed as the equivalent Base.PostAmount
// bounds so the range is pushed down into the query itself rather than
// fetched wide and filtered client-side.
const MIN_POST_AMOUNT_FOR_99_PERCENT = 214_831_000;
const MAX_POST_AMOUNT_FOR_60_PERCENT = 524_140_000;

const GRADUATING_POOLS_QUERY = `
  query GraduatingPumpFunPools(
    $program: String!
    $minPostAmount: String!
    $maxPostAmount: String!
    $since: DateTime!
    $limit: Int!
  ) {
    Solana(dataset: realtime) {
      DEXPools(
        orderBy: { descending: Block_Time }
        limit: { count: $limit }
        where: {
          Pool: {
            Dex: { ProgramAddress: { is: $program } }
            Base: { PostAmount: { ge: $minPostAmount, le: $maxPostAmount } }
          }
          Block: { Time: { since: $since } }
        }
      ) {
        Block {
          Time
        }
        Pool {
          Base {
            PostAmount
          }
          Market {
            BaseCurrency {
              MintAddress
              Name
              Symbol
              Uri
            }
          }
        }
      }
    }
  }
`;

type BitqueryPool = {
  Block?: { Time?: string | null } | null;
  Pool?: {
    Base?: { PostAmount?: number | string | null } | null;
    Market?: {
      BaseCurrency?: {
        MintAddress?: string | null;
        Name?: string | null;
        Symbol?: string | null;
        Uri?: string | null;
      } | null;
    } | null;
  } | null;
};

type BitqueryDEXPoolsResponse = {
  data?: { Solana?: { DEXPools?: BitqueryPool[] | null } | null } | null;
  errors?: Array<{ message?: string }> | null;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeProgressPercent(postAmount: number): number {
  const raw = 100 - ((postAmount - POST_AMOUNT_AT_100_PERCENT) / POST_AMOUNT_RANGE) * 100;
  return Math.min(100, Math.max(0, raw));
}

function parseBlockTimeMs(pool: BitqueryPool): number | null {
  const raw = pool.Block?.Time;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

type Candidate = {
  address: string;
  ticker: string;
  name: string;
  artworkUrl: string;
  postAmount: number;
  blockTimeMs: number;
};

export function mapBitqueryPoolsToGraduatingTokens(
  payload: BitqueryDEXPoolsResponse | null | undefined,
  now: number = Date.now(),
): GraduatingToken[] {
  const pools = payload?.data?.Solana?.DEXPools;
  if (!Array.isArray(pools)) return [];

  // Bitquery can return multiple pool-state rows per mint within the
  // window; keep only the newest one per token.
  const newestByMint = new Map<string, Candidate>();

  for (const pool of pools) {
    const currency = pool?.Pool?.Market?.BaseCurrency;
    const address = currency?.MintAddress;
    const ticker = currency?.Symbol;
    if (!address || !ticker) continue;

    const postAmount = toNumber(pool?.Pool?.Base?.PostAmount);
    if (postAmount === null) continue;

    const blockTimeMs = parseBlockTimeMs(pool);
    if (blockTimeMs === null || now - blockTimeMs > STALE_TRADE_WINDOW_MS) continue;

    const existing = newestByMint.get(address);
    if (existing && existing.blockTimeMs >= blockTimeMs) continue;

    newestByMint.set(address, {
      address,
      ticker,
      name: currency?.Name || ticker,
      artworkUrl: currency?.Uri || "",
      postAmount,
      blockTimeMs,
    });
  }

  return Array.from(newestByMint.values())
    .map(
      (candidate): GraduatingToken => ({
        name: candidate.name,
        ticker: candidate.ticker,
        address: candidate.address,
        artworkUrl: candidate.artworkUrl,
        progressPercent: computeProgressPercent(candidate.postAmount),
        url: `https://pump.fun/coin/${candidate.address}`,
      }),
    )
    .filter((token) => token.progressPercent >= MIN_PROGRESS_PERCENT && token.progressPercent <= MAX_PROGRESS_PERCENT)
    .sort((a, b) => b.progressPercent - a.progressPercent)
    .slice(0, MAX_TOKENS);
}

let graduatingFeedCache: { expiresAt: number; result: Promise<GraduatingFeedResult> } | null = null;

export function resetGraduatingFeedCacheForTests(): void {
  graduatingFeedCache = null;
}

async function fetchGraduatingTokensUncached(): Promise<GraduatingFeedResult> {
  const token = (process.env.BITQUERY_ACCESS_TOKEN || "").trim();
  if (!token) {
    return { tokens: [], error: true };
  }

  const now = Date.now();
  const variables = {
    program: PUMP_FUN_PROGRAM_ADDRESS,
    minPostAmount: String(MIN_POST_AMOUNT_FOR_99_PERCENT),
    maxPostAmount: String(MAX_POST_AMOUNT_FOR_60_PERCENT),
    since: new Date(now - STALE_TRADE_WINDOW_MS).toISOString(),
    limit: 50,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(BITQUERY_EAP_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: GRADUATING_POOLS_QUERY, variables }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable body>");
      console.error(`[pumpfun-graduating] Bitquery request failed with status ${response.status}:`, body);
      return { tokens: [], error: true };
    }

    const payload = (await response.json()) as BitqueryDEXPoolsResponse;
    if (payload?.errors?.length) {
      console.error("[pumpfun-graduating] Bitquery returned GraphQL errors:", payload.errors);
      return { tokens: [], error: true };
    }

    return { tokens: mapBitqueryPoolsToGraduatingTokens(payload, now), error: false };
  } catch (err) {
    console.error("[pumpfun-graduating] Bitquery request threw:", err);
    return { tokens: [], error: true };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Server-only fetch of pump.fun tokens racing toward graduation, sourced
 * from Bitquery's indexed pump.fun bonding-curve pool state (see module doc
 * comment). 60s in-memory cache — any failure, missing token, or malformed
 * response resolves to an empty, error-flagged result instead of throwing,
 * so the panel can hide the row rather than show a stale or dead grid.
 */
export function fetchGraduatingTokens(): Promise<GraduatingFeedResult> {
  if (graduatingFeedCache && graduatingFeedCache.expiresAt > Date.now()) return graduatingFeedCache.result;

  const result = fetchGraduatingTokensUncached();
  graduatingFeedCache = { expiresAt: Date.now() + GRADUATING_FEED_CACHE_TTL_MS, result };
  return result;
}
