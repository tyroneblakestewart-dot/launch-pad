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
 * pump.fun's own frontend API, no key required. Moralis's equivalent
 * bonding-tokens endpoint (used in an earlier version of this feed, issue
 * #287) was deprecated and now 404s, so this goes straight to the source.
 * pump.fun is known to block some datacenter IPs, including Vercel
 * functions — any non-2xx response (a block would typically show up as one)
 * resolves to an error result and the row just hides itself, never a
 * broken or dead grid.
 */
const PUMP_FUN_COINS_ENDPOINT =
  "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=market_cap&order=DESC&includeNsfw=false";

const FEED_TIMEOUT_MS = 6_000;
const MIN_PROGRESS_PERCENT = 60;
const MAX_PROGRESS_PERCENT = 99;
const MAX_TOKENS = 6;
// pump.fun's coin payload does include a real last-trade timestamp, so
// (unlike the earlier Moralis-backed version of this feed) staleness is
// strictly enforced: a token is dropped when the field is missing or stale.
const STALE_TRADE_WINDOW_MS = 10 * 60 * 1000;
const GRADUATING_FEED_CACHE_TTL_MS = 60_000;
// pump.fun doesn't expose a bonding-progress percentage directly; it's
// derived from market cap against the well-known ~$69k graduation target.
const GRADUATION_MARKET_CAP_USD = 69_000;

type PumpFunCoin = {
  mint?: string;
  name?: string;
  symbol?: string;
  image_uri?: string;
  usd_market_cap?: number | string;
  complete?: boolean;
  last_trade_timestamp?: number | string;
  lastTradeTimestamp?: number | string;
};

type PumpFunCoinsPayload = PumpFunCoin[] | null | undefined;

function toNumber(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeProgressPercent(usdMarketCap: number): number {
  const raw = (usdMarketCap / GRADUATION_MARKET_CAP_USD) * 100;
  return Math.min(100, Math.max(0, raw));
}

function parseTradeTimestampMs(item: PumpFunCoin): number | null {
  const raw = item.last_trade_timestamp ?? item.lastTradeTimestamp;
  if (raw === undefined || raw === null) return null;

  if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;

  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) return asNumber > 1e12 ? asNumber : asNumber * 1000;

  const asDate = Date.parse(raw);
  return Number.isFinite(asDate) ? asDate : null;
}

export function mapPumpFunCoinsPayloadToGraduatingTokens(
  payload: PumpFunCoinsPayload,
  now: number = Date.now(),
): GraduatingToken[] {
  if (!Array.isArray(payload)) return [];

  return payload
    .map((item): GraduatingToken | null => {
      if (item?.complete) return null;

      const address = item?.mint;
      const ticker = item?.symbol;
      if (!address || !ticker) return null;

      const marketCapUsd = toNumber(item.usd_market_cap);
      if (marketCapUsd === null) return null;

      // Strict staleness filter: pump.fun's payload actually carries this
      // field, so a token is dropped whenever it's missing or stale rather
      // than kept by default (contrast with the earlier Moralis-backed
      // version of this feed, which had no timestamp field at all).
      const tradeTimestampMs = parseTradeTimestampMs(item);
      if (tradeTimestampMs === null || now - tradeTimestampMs > STALE_TRADE_WINDOW_MS) return null;

      return {
        name: item.name || ticker,
        ticker,
        address,
        artworkUrl: item.image_uri || "",
        progressPercent: computeProgressPercent(marketCapUsd),
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(PUMP_FUN_COINS_ENDPOINT, {
      headers: {
        Accept: "application/json",
        // A standard browser UA is a low-risk mitigation against the
        // datacenter/Vercel-IP blocking pump.fun is known to apply — see
        // the module doc comment.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable body>");
      console.error(`[pumpfun-graduating] pump.fun request failed with status ${response.status}:`, body);
      return { tokens: [], error: true };
    }

    const payload = (await response.json()) as PumpFunCoinsPayload;
    return { tokens: mapPumpFunCoinsPayloadToGraduatingTokens(payload), error: false };
  } catch (err) {
    console.error("[pumpfun-graduating] pump.fun request threw:", err);
    return { tokens: [], error: true };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Server-only fetch of pump.fun tokens racing toward graduation, sourced
 * directly from pump.fun's frontend API (see module doc comment). 60s
 * in-memory cache — any failure, block, or malformed response resolves to
 * an empty, error-flagged result instead of throwing, so the panel can hide
 * the row rather than show a stale or dead grid.
 */
export function fetchGraduatingTokens(): Promise<GraduatingFeedResult> {
  if (graduatingFeedCache && graduatingFeedCache.expiresAt > Date.now()) return graduatingFeedCache.result;

  const result = fetchGraduatingTokensUncached();
  graduatingFeedCache = { expiresAt: Date.now() + GRADUATING_FEED_CACHE_TTL_MS, result };
  return result;
}
