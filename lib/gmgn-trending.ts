import { randomUUID } from "node:crypto";

const GMGN_MARKET_RANK_URL = "https://openapi.gmgn.ai/v1/market/rank";
const CACHE_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;
const RESULT_LIMIT = 12;

type JsonRecord = Record<string, unknown>;

export type TrendingToken = {
  address: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  marketCap: number | null;
  liquidity: number | null;
  volume5m: number | null;
  swaps5m: number | null;
  holders: number | null;
  change5m: number | null;
  launchpad: string | null;
  rank: number;
};

export type RobinhoodTrendingSnapshot = {
  chain: "robinhood";
  interval: "5m";
  fetchedAt: string;
  tokens: TrendingToken[];
};

export class GmgnTrendingError extends Error {
  constructor(
    public readonly kind: "not_configured" | "timeout" | "upstream" | "invalid_response",
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GmgnTrendingError";
  }
}

let cachedSnapshot: { value: RobinhoodTrendingSnapshot; expiresAt: number } | null = null;
let inFlightRequest: Promise<RobinhoodTrendingSnapshot> | null = null;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeLogoUrl(value: unknown): string | null {
  const raw = textValue(value);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function rankEntries(payload: unknown): unknown[] {
  const root = asRecord(payload);
  if (!root) return [];

  const data = asRecord(root.data) ?? root;
  return Array.isArray(data.rank) ? data.rank : [];
}

export function normaliseTrendingRank(
  payload: unknown,
  fetchedAt = Date.now(),
): RobinhoodTrendingSnapshot {
  const tokens = rankEntries(payload)
    .map((entry, index): TrendingToken | null => {
      const item = asRecord(entry);
      if (!item) return null;

      const address = textValue(item.address);
      if (!address) return null;

      const symbol = textValue(item.symbol) ?? "TOKEN";
      return {
        address,
        symbol,
        name: textValue(item.name) ?? symbol,
        logoUrl: safeLogoUrl(item.logo),
        marketCap: numberValue(item.market_cap),
        liquidity: numberValue(item.liquidity),
        volume5m: numberValue(item.volume),
        swaps5m: numberValue(item.swaps),
        holders: numberValue(item.holder_count),
        change5m: numberValue(item.price_change_percent5m ?? item.price_change_percent),
        launchpad: textValue(item.launchpad_platform),
        rank: numberValue(item.rank) ?? index + 1,
      };
    })
    .filter((token): token is TrendingToken => token !== null)
    .slice(0, RESULT_LIMIT);

  return {
    chain: "robinhood",
    interval: "5m",
    fetchedAt: new Date(fetchedAt).toISOString(),
    tokens,
  };
}

async function requestRobinhoodTrending(apiKey: string): Promise<RobinhoodTrendingSnapshot> {
  const url = new URL(GMGN_MARKET_RANK_URL);
  url.searchParams.set("chain", "robinhood");
  url.searchParams.set("interval", "5m");
  url.searchParams.set("order_by", "volume");
  url.searchParams.set("direction", "desc");
  url.searchParams.set("limit", String(RESULT_LIMIT));
  url.searchParams.set("timestamp", String(Math.floor(Date.now() / 1_000)));
  url.searchParams.set("client_id", randomUUID());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-APIKEY": apiKey,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new GmgnTrendingError(
        "upstream",
        502,
        `GMGN market request failed with status ${response.status}.`,
      );
    }

    const root = asRecord(payload);
    if (root && typeof root.code === "number" && root.code !== 0) {
      throw new GmgnTrendingError("upstream", 502, "GMGN market request was rejected.");
    }

    if (!root) {
      throw new GmgnTrendingError("invalid_response", 502, "GMGN returned invalid JSON.");
    }

    return normaliseTrendingRank(payload);
  } catch (error) {
    if (error instanceof GmgnTrendingError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GmgnTrendingError("timeout", 504, "GMGN market request timed out.");
    }
    throw new GmgnTrendingError("upstream", 502, "GMGN market request failed.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function getRobinhoodTrending(): Promise<RobinhoodTrendingSnapshot> {
  const now = Date.now();
  if (cachedSnapshot && cachedSnapshot.expiresAt > now) return cachedSnapshot.value;
  if (inFlightRequest) return inFlightRequest;

  const apiKey = process.env.GMGN_API_KEY?.trim();
  if (!apiKey) {
    throw new GmgnTrendingError("not_configured", 503, "GMGN_API_KEY is not configured.");
  }

  const request = requestRobinhoodTrending(apiKey);
  inFlightRequest = request;

  try {
    const snapshot = await request;
    cachedSnapshot = { value: snapshot, expiresAt: Date.now() + CACHE_TTL_MS };
    return snapshot;
  } finally {
    if (inFlightRequest === request) inFlightRequest = null;
  }
}
