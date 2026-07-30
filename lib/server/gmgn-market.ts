import { randomUUID } from "node:crypto";
import {
  type RobinhoodTrendingInterval,
  type RobinhoodTrendingResponse,
  type RobinhoodTrendingToken,
} from "@/lib/robinhood-market";

const GMGN_MARKET_URL = "https://openapi.gmgn.ai/v1/market/rank";
const GMGN_TIMEOUT_MS = 8_000;
const GMGN_CACHE_TTL_MS = 55_000;
const GMGN_RESULT_LIMIT = 8;

type GmgnEnvelope = {
  code?: unknown;
  data?: { rank?: unknown };
};

type RequestOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  clientId?: () => string;
};

type CacheEntry = {
  expiresAt: number;
  result: Promise<RobinhoodTrendingResponse>;
};

const cache = new Map<RobinhoodTrendingInterval, CacheEntry>();

export class GmgnMarketError extends Error {
  readonly kind: "timeout" | "network" | "http" | "invalid";
  readonly status?: number;

  constructor(
    kind: GmgnMarketError["kind"],
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "GmgnMarketError";
    this.kind = kind;
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normaliseRankItem(
  value: unknown,
  index: number,
  interval: RobinhoodTrendingInterval,
): RobinhoodTrendingToken | null {
  const item = asRecord(value);
  if (!item) return null;

  const address = stringValue(item.address);
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;

  const name = stringValue(item.name) || "Unnamed token";
  const symbol = stringValue(item.symbol) || "TOKEN";
  const intervalChangeKey = interval === "5m" ? "price_change_percent5m" : "price_change_percent1h";

  return {
    address,
    name,
    symbol,
    rank: Math.max(1, Math.trunc(numberValue(item.rank) ?? index + 1)),
    priceUsd: numberValue(item.price),
    marketCapUsd: numberValue(item.market_cap),
    liquidityUsd: numberValue(item.liquidity),
    volumeUsd: numberValue(item.volume),
    swaps: numberValue(item.swaps),
    holders: numberValue(item.holder_count),
    priceChangePercent:
      numberValue(item.price_change_percent) ?? numberValue(item[intervalChangeKey]),
    devTeamHoldRate: numberValue(item.dev_team_hold_rate),
    smartMoneyCount: numberValue(item.smart_degen_count),
    launchpad: stringValue(item.launchpad_platform),
  };
}

export async function requestRobinhoodTrending(
  apiKey: string,
  interval: RobinhoodTrendingInterval,
  options: RequestOptions = {},
): Promise<RobinhoodTrendingResponse> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new GmgnMarketError("invalid", "GMGN market access is not configured.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const clientId = options.clientId ?? randomUUID;
  const requestedAt = now();
  const url = new URL(GMGN_MARKET_URL);
  url.searchParams.set("chain", "robinhood");
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(GMGN_RESULT_LIMIT));
  url.searchParams.set("order_by", "volume");
  url.searchParams.set("direction", "desc");
  url.searchParams.set("timestamp", String(Math.floor(requestedAt / 1_000)));
  url.searchParams.set("client_id", clientId());

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "hoodlums-launchpad/1.0",
        "X-APIKEY": trimmedKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(GMGN_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      throw new GmgnMarketError("timeout", "GMGN market request timed out.");
    }
    throw new GmgnMarketError("network", "GMGN market request failed.");
  }

  if (!response.ok) {
    throw new GmgnMarketError(
      "http",
      `GMGN market request failed with HTTP ${response.status}.`,
      response.status,
    );
  }

  let payload: GmgnEnvelope;
  try {
    payload = (await response.json()) as GmgnEnvelope;
  } catch {
    throw new GmgnMarketError("invalid", "GMGN returned an invalid response.");
  }

  if (payload.code !== 0 && payload.code !== "0") {
    throw new GmgnMarketError("invalid", "GMGN returned an unsuccessful response.");
  }

  const rank = payload.data?.rank;
  if (!Array.isArray(rank)) {
    throw new GmgnMarketError("invalid", "GMGN returned no trending-token ranking.");
  }

  const tokens = rank
    .map((item, index) => normaliseRankItem(item, index, interval))
    .filter((item): item is RobinhoodTrendingToken => Boolean(item))
    .slice(0, GMGN_RESULT_LIMIT);

  return {
    source: "GMGN",
    interval,
    updatedAt: new Date(requestedAt).toISOString(),
    tokens,
  };
}

export async function getCachedRobinhoodTrending(
  apiKey: string,
  interval: RobinhoodTrendingInterval,
  options: RequestOptions = {},
): Promise<RobinhoodTrendingResponse> {
  const now = options.now ?? Date.now;
  const currentTime = now();
  const existing = cache.get(interval);
  if (existing && existing.expiresAt > currentTime) return existing.result;

  const result = requestRobinhoodTrending(apiKey, interval, {
    ...options,
    now: () => currentTime,
  });
  cache.set(interval, { expiresAt: currentTime + GMGN_CACHE_TTL_MS, result });

  try {
    return await result;
  } catch (error) {
    if (cache.get(interval)?.result === result) cache.delete(interval);
    throw error;
  }
}

export function resetGmgnMarketCacheForTests(): void {
  cache.clear();
}
