import { randomUUID } from "node:crypto";

export const GMGN_TRENDING_INTERVALS = ["5m", "1h"] as const;
export type GmgnTrendingInterval = (typeof GMGN_TRENDING_INTERVALS)[number];

export type RobinhoodTrendingToken = {
  address: string;
  name: string;
  symbol: string;
  price: number | null;
  marketCap: number | null;
  liquidity: number | null;
  volume: number | null;
  swaps: number | null;
  holderCount: number | null;
  priceChangePercent: number | null;
  devHoldingRate: number | null;
  smartMoneyCount: number | null;
};

export type RobinhoodTrendingResult = {
  interval: GmgnTrendingInterval;
  fetchedAt: string;
  tokens: RobinhoodTrendingToken[];
};

type UnknownRecord = Record<string, unknown>;
type CacheEntry = {
  apiKey: string;
  expiresAt: number;
  result: Promise<RobinhoodTrendingResult>;
};

type GlobalWithGmgnCache = typeof globalThis & {
  __hoodlumsGmgnTrendingCache?: Map<GmgnTrendingInterval, CacheEntry>;
};

const GMGN_HOST = "https://openapi.gmgn.ai";
const CACHE_TTL_MS = 45_000;
const REQUEST_TIMEOUT_MS = 8_000;
const RESULT_LIMIT = 12;

function cacheStore(): Map<GmgnTrendingInterval, CacheEntry> {
  const scope = globalThis as GlobalWithGmgnCache;
  if (!scope.__hoodlumsGmgnTrendingCache) {
    scope.__hoodlumsGmgnTrendingCache = new Map();
  }
  return scope.__hoodlumsGmgnTrendingCache;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function firstString(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(record: UnknownRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function extractItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const record = asRecord(data);
  if (!record) return [];
  for (const key of ["rank", "ranks", "list", "items", "tokens"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normaliseToken(value: unknown, interval: GmgnTrendingInterval): RobinhoodTrendingToken | null {
  const record = asRecord(value);
  if (!record) return null;

  const address = firstString(record, ["address", "token_address", "contract_address"]);
  if (!/^0x[0-9a-f]{40}$/i.test(address)) return null;

  const symbol = firstString(record, ["symbol", "token_symbol"]) || "TOKEN";
  const name = firstString(record, ["name", "token_name"]) || symbol;
  const priceChangeKeys =
    interval === "5m"
      ? ["price_change_percent5m", "price_change_5m", "change5m"]
      : ["price_change_percent1h", "price_change_1h", "change1h"];

  return {
    address,
    name,
    symbol,
    price: firstNumber(record, ["price", "price_usd"]),
    marketCap: firstNumber(record, ["market_cap", "marketcap", "usd_market_cap"]),
    liquidity: firstNumber(record, ["liquidity", "pool_liquidity"]),
    volume: firstNumber(record, ["volume", `volume_${interval}`]),
    swaps: firstNumber(record, ["swaps", `swaps_${interval}`]),
    holderCount: firstNumber(record, ["holder_count", "holders"]),
    priceChangePercent: firstNumber(record, priceChangeKeys),
    devHoldingRate: firstNumber(record, ["dev_team_hold_rate", "creator_balance_rate"]),
    smartMoneyCount: firstNumber(record, ["smart_degen_count"]),
  };
}

function parseEnvelope(payload: unknown, interval: GmgnTrendingInterval): RobinhoodTrendingToken[] {
  const envelope = asRecord(payload);
  if (!envelope) throw new Error("GMGN returned an invalid response.");

  const code = envelope.code;
  if (code !== 0 && code !== "0") {
    throw new Error("GMGN could not provide Robinhood Chain market data.");
  }

  return extractItems(envelope.data)
    .map((item) => normaliseToken(item, interval))
    .filter((item): item is RobinhoodTrendingToken => Boolean(item))
    .slice(0, RESULT_LIMIT);
}

async function requestTrending(
  interval: GmgnTrendingInterval,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<RobinhoodTrendingResult> {
  const url = new URL("/v1/market/rank", GMGN_HOST);
  url.searchParams.set("chain", "robinhood");
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(RESULT_LIMIT));
  url.searchParams.set("order_by", "volume");
  url.searchParams.set("direction", "desc");
  url.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
  url.searchParams.set("client_id", randomUUID());

  const response = await fetchImpl(url, {
    headers: {
      "X-APIKEY": apiKey,
      Accept: "application/json",
      "User-Agent": "hoodlums-launchpad/1.0",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GMGN market request failed with HTTP ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);
  return {
    interval,
    fetchedAt: new Date().toISOString(),
    tokens: parseEnvelope(payload, interval),
  };
}

export async function getRobinhoodTrendingTokens(
  interval: GmgnTrendingInterval,
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    now?: number;
  } = {},
): Promise<RobinhoodTrendingResult> {
  const apiKey = options.apiKey ?? process.env.GMGN_API_KEY ?? "";
  if (!apiKey) throw new Error("GMGN market data is not configured.");

  const now = options.now ?? Date.now();
  const store = cacheStore();
  const cached = store.get(interval);
  if (cached && cached.apiKey === apiKey && cached.expiresAt > now) {
    return cached.result;
  }

  const result = requestTrending(interval, apiKey, options.fetchImpl ?? fetch);
  store.set(interval, { apiKey, expiresAt: now + CACHE_TTL_MS, result });
  result.catch(() => {
    if (store.get(interval)?.result === result) store.delete(interval);
  });
  return result;
}

export function isGmgnTrendingInterval(value: string | null): value is GmgnTrendingInterval {
  return GMGN_TRENDING_INTERVALS.includes(value as GmgnTrendingInterval);
}

export function resetGmgnTrendingCacheForTests(): void {
  cacheStore().clear();
}
