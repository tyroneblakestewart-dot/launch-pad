export type TrendingToken = {
  rank: number;
  name: string;
  ticker: string;
  address: string;
  artworkUrl: string;
  marketCapUsd: number;
  priceChangePercent: number;
  url: string;
};

export type TrendingFeedResult = { tokens: TrendingToken[]; error: boolean };

/**
 * Confirmed by the project owner in issue #185: GMGN's 5-minute Robinhood
 * Chain swap-ranking endpoint. `GMGN_API_KEY` is a server-only bearer token
 * (never a `NEXT_PUBLIC_` value) that must be set in the deployment
 * environment, not committed here.
 */
const GMGN_ENDPOINT =
  "https://gmgn.ai/defi/quotation/v1/rank/robinhood/swaps/5m?orderby=swaps&direction=desc";

const FEED_TIMEOUT_MS = 6_000;
const MAX_TOKENS = 10;

type GmgnRankItem = {
  address?: string;
  symbol?: string;
  name?: string;
  logo?: string;
  price_change_percent5m?: number | string;
  market_cap?: number | string;
  usd_market_cap?: number | string;
};

type GmgnPayload = {
  data?: { rank?: GmgnRankItem[] } | GmgnRankItem[];
};

function toNumber(value: number | string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapGmgnPayloadToTrendingTokens(payload: GmgnPayload | null | undefined): TrendingToken[] {
  const items = Array.isArray(payload?.data) ? payload?.data : payload?.data?.rank;
  if (!Array.isArray(items)) return [];

  return items
    .filter((item): item is GmgnRankItem => Boolean(item?.address && (item.symbol || item.name)))
    .slice(0, MAX_TOKENS)
    .map((item, index) => ({
      rank: index + 1,
      name: item.name || item.symbol || "Unknown",
      ticker: item.symbol || "?",
      address: item.address || "",
      artworkUrl: item.logo || "",
      marketCapUsd: toNumber(item.usd_market_cap ?? item.market_cap),
      priceChangePercent: toNumber(item.price_change_percent5m),
      url: `https://gmgn.ai/robinhood/token/${item.address}`,
    }));
}

/**
 * Server-only fetch of the Robinhood Chain trending feed. Without
 * `GMGN_API_KEY` configured, or on any request failure, this resolves to an
 * empty, error-flagged result instead of throwing — the trending panel
 * shows "Feed unavailable" rather than pretending the integration is live.
 */
export async function fetchRobinhoodTrendingTokens(): Promise<TrendingFeedResult> {
  const apiKey = process.env.GMGN_API_KEY?.trim();
  if (!apiKey) return { tokens: [], error: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(GMGN_ENDPOINT, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return { tokens: [], error: true };

    const payload = (await response.json()) as GmgnPayload;
    return { tokens: mapGmgnPayloadToTrendingTokens(payload), error: false };
  } catch {
    return { tokens: [], error: true };
  } finally {
    clearTimeout(timeout);
  }
}
