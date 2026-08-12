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
 * pump.fun's own frontend API commonly blocks datacenter IPs (including
 * Vercel functions), so per issue #287 this feed goes straight to Moralis's
 * pump.fun bonding-tokens endpoint ("Get Bonding Tokens By Exchange"),
 * behind a server-only `MORALIS_API_KEY`. `bondingCurveProgress` is a 0-100
 * percentage, confirmed against Moralis's docs in issue #287.
 */
const MORALIS_BONDING_ENDPOINT = "https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/bonding";

const FEED_TIMEOUT_MS = 6_000;
const MIN_PROGRESS_PERCENT = 60;
const MAX_PROGRESS_PERCENT = 99;
const MAX_TOKENS = 6;
// Moralis's bonding-tokens response has no last-trade timestamp field at all
// (confirmed against their docs in issue #287) — this window only matters if
// a future response, or a future endpoint, ever includes one.
const STALE_TRADE_WINDOW_MS = 10 * 60 * 1000;
const GRADUATING_FEED_CACHE_TTL_MS = 60_000;

type MoralisBondingItem = {
  tokenAddress?: string;
  address?: string;
  mint?: string;
  name?: string;
  symbol?: string;
  ticker?: string;
  logo?: string;
  image?: string;
  logoUri?: string;
  bondingCurveProgress?: number | string;
  progress?: number | string;
  lastTradeTimestamp?: number | string;
  last_trade_timestamp?: number | string;
  lastTradeTime?: number | string;
};

type MoralisBondingPayload = MoralisBondingItem[] | { result?: MoralisBondingItem[] } | null | undefined;

function toNumber(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Not currently populated by Moralis's bonding-tokens response, but kept
 * (with alias parsing) so a future field of this shape is picked up for
 * free instead of silently ignored.
 */
function parseTradeTimestampMs(item: MoralisBondingItem): number | null {
  const raw = item.lastTradeTimestamp ?? item.last_trade_timestamp ?? item.lastTradeTime;
  if (raw === undefined || raw === null) return null;

  if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;

  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) return asNumber > 1e12 ? asNumber : asNumber * 1000;

  const asDate = Date.parse(raw);
  return Number.isFinite(asDate) ? asDate : null;
}

export function mapMoralisBondingPayloadToGraduatingTokens(
  payload: MoralisBondingPayload,
  now: number = Date.now(),
): GraduatingToken[] {
  const items = Array.isArray(payload) ? payload : payload?.result;
  if (!Array.isArray(items)) return [];

  return items
    .map((item): GraduatingToken | null => {
      const address = item?.tokenAddress || item?.address || item?.mint;
      const ticker = item?.symbol || item?.ticker;
      if (!address || !ticker) return null;

      const progressPercent = toNumber(item.bondingCurveProgress ?? item.progress);
      if (progressPercent === null) return null;

      // Only enforce the staleness window when a timestamp is actually
      // present — Moralis's bonding-tokens response never includes one, and
      // dropping every token on a missing field would empty the row in
      // production (see issue #287). Freshness without it is covered by
      // Moralis only surfacing tokens already >=20% graduated, combined with
      // our 60-99% progress window, descending sort and cap of 6.
      const tradeTimestampMs = parseTradeTimestampMs(item);
      if (tradeTimestampMs !== null && now - tradeTimestampMs > STALE_TRADE_WINDOW_MS) return null;

      return {
        name: item.name || ticker,
        ticker,
        address,
        artworkUrl: item.logo || item.image || item.logoUri || "",
        progressPercent,
        url: `https://pump.fun/coin/${address}`,
      };
    })
    .filter((token): token is GraduatingToken => token !== null)
    .filter((token) => token.progressPercent >= MIN_PROGRESS_PERCENT && token.progressPercent <= MAX_PROGRESS_PERCENT)
    .sort((a, b) => b.progressPercent - a.progressPercent)
    .slice(0, MAX_TOKENS);
}

let graduatingFeedCache: { expiresAt: number; result: Promise<GraduatingFeedResult> } | null = null;

export function resetGraduatingFeedCacheForTests(): void {
  graduatingFeedCache = null;
}

async function fetchGraduatingTokensUncached(): Promise<GraduatingFeedResult> {
  const apiKey = process.env.MORALIS_API_KEY?.trim();
  if (!apiKey) return { tokens: [], error: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(MORALIS_BONDING_ENDPOINT, {
      headers: { Accept: "application/json", "X-API-Key": apiKey },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable body>");
      console.error(`[pumpfun-graduating] Moralis request failed with status ${response.status}:`, body);
      return { tokens: [], error: true };
    }

    const payload = (await response.json()) as MoralisBondingPayload;
    return { tokens: mapMoralisBondingPayloadToGraduatingTokens(payload), error: false };
  } catch (err) {
    console.error("[pumpfun-graduating] Moralis request threw:", err);
    return { tokens: [], error: true };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Server-only fetch of pump.fun tokens racing toward graduation, sourced via
 * Moralis (see module doc comment for why). 60s in-memory cache — any
 * failure, missing key, or malformed response resolves to an empty,
 * error-flagged result instead of throwing, so the panel can hide the row
 * rather than show a stale or dead grid.
 */
export function fetchGraduatingTokens(): Promise<GraduatingFeedResult> {
  if (graduatingFeedCache && graduatingFeedCache.expiresAt > Date.now()) return graduatingFeedCache.result;

  const result = fetchGraduatingTokensUncached();
  graduatingFeedCache = { expiresAt: Date.now() + GRADUATING_FEED_CACHE_TTL_MS, result };
  return result;
}
