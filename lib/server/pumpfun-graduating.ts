import { extractTwitterHandle } from "@/lib/social-links";

export type GraduatingToken = {
  name: string;
  ticker: string;
  address: string;
  artworkUrl: string;
  progressPercent: number;
  url: string;
  // The token creator's own X/Twitter handle, read from the same pump.fun
  // metadata document as artworkUrl (issue #298) — null until that metadata
  // is resolved, and still null afterwards if the creator never published
  // one. Never invented; only ever sourced from their own opt-in metadata.
  creatorXHandle: string | null;
};

export type GraduatingFeedResult = { tokens: GraduatingToken[]; error: boolean };

/**
 * Bitquery's streaming GraphQL API, queried server-to-server (issue #291).
 * pump.fun's own frontend API (used before this, and a Moralis-backed
 * version before that, issue #287) is known to block datacenter IPs
 * including Vercel functions, so production requests from this app never
 * succeeded against it. Bitquery indexes the same on-chain pump.fun
 * bonding-curve pools and is built for server callers. This is a polling
 * GraphQL *query* (not a subscription) since the existing 5-minute cache below
 * already handles polling; a missing/empty BITQUERY_ACCESS_TOKEN, a
 * non-2xx response, or a malformed payload all resolve to an error result
 * so the row just hides itself, same fail-safe contract as before.
 */
const BITQUERY_EAP_ENDPOINT = "https://streaming.bitquery.io/eap";

// The pump.fun bonding-curve program on Solana.
const PUMP_FUN_PROGRAM_ADDRESS = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const FEED_TIMEOUT_MS = 6_000;
const ARTWORK_FETCH_TIMEOUT_MS = 3_000;
// cf-ipfs.com is a CDN-backed gateway and resolves noticeably faster than
// plain ipfs.io, which frequently hangs (issue #297). ipfs.io is kept as a
// same-request fallback for the metadata fetch below when the primary
// gateway itself fails or times out; there's no runtime fallback for the
// final rendered <img> src beyond the client-side load timeout (issue #297,
// hoodlums-graduating-row.tsx), since only the metadata document is ever
// fetched server-side.
const IPFS_GATEWAYS = ["https://cf-ipfs.com/ipfs/", "https://ipfs.io/ipfs/"];
const MIN_PROGRESS_PERCENT = 60;
const MAX_PROGRESS_PERCENT = 99;
const MAX_TOKENS = 6;
// Filters both the Bitquery query itself and the mapped results: a pool
// with no trade in this window is dropped rather than shown stale.
const STALE_TRADE_WINDOW_MS = 10 * 60 * 1000;
// 300s / 5 minutes (up from 30s, issue #305): the 30s cache + 30s client
// poll spent ~2,900 Bitquery queries/day, exhausting the free-tier monthly
// point allowance in under a day (production 402 "access restricted by
// points limit"). A "graduating now" board doesn't need sub-minute
// freshness — 5 minutes reads identically live to a visitor while cutting
// usage ~10x to keep the free tier sustainable. Do NOT lower this further
// without a paid Bitquery plan; every cache miss spends API points.
const GRADUATING_FEED_CACHE_TTL_MS = 300_000;

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
        // Not yet resolved — only the metadata fetch in
        // resolveGraduatingTokensArtwork can populate this.
        creatorXHandle: null,
      }),
    )
    .filter((token) => token.progressPercent >= MIN_PROGRESS_PERCENT && token.progressPercent <= MAX_PROGRESS_PERCENT)
    .sort((a, b) => b.progressPercent - a.progressPercent)
    .slice(0, MAX_TOKENS);
}

function rewriteIpfsUri(uri: string): string {
  if (!uri.startsWith("ipfs://")) return uri;
  return IPFS_GATEWAYS[0] + uri.slice("ipfs://".length);
}

/** The next gateway to retry with, or null if `uri` isn't on the primary IPFS gateway. */
function ipfsFallbackUri(uri: string): string | null {
  const [primary, fallback] = IPFS_GATEWAYS;
  if (!uri.startsWith(primary)) return null;
  return fallback + uri.slice(primary.length);
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico"];

function looksLikeImageUri(uri: string): boolean {
  const withoutQueryOrHash = uri.split(/[?#]/)[0] || "";
  const lower = withoutQueryOrHash.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

type MetadataResolution = { artworkUrl: string; creatorXHandle: string | null };

const EMPTY_METADATA_RESOLUTION: MetadataResolution = { artworkUrl: "", creatorXHandle: null };

/**
 * Fetches `uri` and, by content rather than filename (issue #297 — some
 * pump.fun metadata URIs have no ".json" suffix, e.g.
 * https://meta.<host>.uk/metadata/<id>), decides whether it's pump.fun's
 * metadata JSON document (Bitquery's BaseCurrency.Uri, whose "image" field
 * is the real artwork and whose "twitter" field, if present, is the
 * creator's own opt-in X handle — issue #298) or already an image being
 * served without an extension. A JSON content-type, or a body that sniffs
 * as JSON (starts with "{"), is parsed for "image"/"twitter"; anything else
 * that fetched successfully is treated as the image itself (with no handle
 * to read). Any fetch/timeout/parse failure, non-2xx status, or missing
 * "image" field resolves artworkUrl to "". This is the single metadata
 * fetch shared by both fields — no extra network request for the handle.
 */
async function fetchArtworkFromUri(uri: string): Promise<MetadataResolution> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ARTWORK_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(uri, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return EMPTY_METADATA_RESOLUTION;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.startsWith("image/")) return { artworkUrl: uri, creatorXHandle: null };

    const text = await response.text();
    const trimmed = text.trimStart();
    if (!contentType.includes("json") && !trimmed.startsWith("{")) return { artworkUrl: uri, creatorXHandle: null };

    const metadata = JSON.parse(trimmed) as { image?: unknown; twitter?: unknown };
    const image = typeof metadata?.image === "string" ? metadata.image.trim() : "";
    return {
      artworkUrl: image ? rewriteIpfsUri(image) : "",
      creatorXHandle: extractTwitterHandle(metadata?.twitter),
    };
  } catch {
    return EMPTY_METADATA_RESOLUTION;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * A direct image URI (obvious by extension) passes through unresolved
 * instead of costing an extra request — no metadata document exists to read
 * a creator handle from in that case. Everything else is a metadata-URI
 * candidate: fetched and sniffed by content (see `fetchArtworkFromUri`). If
 * the URI is on the primary IPFS gateway and that fetch comes back with no
 * artwork (timeout, hang, or non-2xx — the frequent ipfs.io failure mode
 * this guards against), retry once against the fallback gateway before
 * giving up.
 */
async function resolveArtworkUrl(rawUri: string): Promise<MetadataResolution> {
  if (!rawUri) return EMPTY_METADATA_RESOLUTION;
  const uri = rewriteIpfsUri(rawUri);
  if (!/^https?:\/\//i.test(uri)) return { artworkUrl: uri, creatorXHandle: null };
  if (looksLikeImageUri(uri)) return { artworkUrl: uri, creatorXHandle: null };

  const resolved = await fetchArtworkFromUri(uri);
  if (resolved.artworkUrl) return resolved;

  const fallbackUri = ipfsFallbackUri(uri);
  if (!fallbackUri) return EMPTY_METADATA_RESOLUTION;
  return fetchArtworkFromUri(fallbackUri);
}

/** Resolves every token's artwork (and, from the same fetch, creator handle) in parallel, each independently timed out. */
export async function resolveGraduatingTokensArtwork(tokens: GraduatingToken[]): Promise<GraduatingToken[]> {
  return Promise.all(
    tokens.map(async (token) => {
      const resolved = await resolveArtworkUrl(token.artworkUrl);
      return { ...token, artworkUrl: resolved.artworkUrl, creatorXHandle: resolved.creatorXHandle };
    }),
  );
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

    const mapped = mapBitqueryPoolsToGraduatingTokens(payload, now);
    const tokens = await resolveGraduatingTokensArtwork(mapped);
    return { tokens, error: false };
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
 * comment). 5-minute in-memory cache (issue #305) — any failure, missing
 * token, or malformed response resolves to an empty, error-flagged result
 * instead of throwing, so the panel can hide the row rather than show a
 * stale or dead grid.
 */
export function fetchGraduatingTokens(): Promise<GraduatingFeedResult> {
  if (graduatingFeedCache && graduatingFeedCache.expiresAt > Date.now()) return graduatingFeedCache.result;

  const result = fetchGraduatingTokensUncached();
  graduatingFeedCache = { expiresAt: Date.now() + GRADUATING_FEED_CACHE_TTL_MS, result };
  return result;
}
