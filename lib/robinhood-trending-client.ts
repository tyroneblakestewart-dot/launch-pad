/**
 * Shared client-side helper for `/api/trending-robinhood`, used by
 * `components/robinhood-trending-panel.tsx`.
 */

export type TrendingToken = {
  rank: number;
  name: string;
  ticker: string;
  addressLabel: string;
  marketCapUsd: number;
  percentChange5m: number;
  artworkUrl: string;
  linkUrl: string;
};

export type RobinhoodTrendingResponse = {
  tokens: TrendingToken[];
  error: boolean;
};

export async function fetchRobinhoodTrending(signal?: AbortSignal): Promise<RobinhoodTrendingResponse> {
  try {
    const response = await fetch("/api/trending-robinhood", { signal });
    if (!response.ok) return { tokens: [], error: true };
    const payload = (await response.json().catch(() => ({}))) as Partial<RobinhoodTrendingResponse>;
    return {
      tokens: Array.isArray(payload.tokens) ? payload.tokens : [],
      error: Boolean(payload.error),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { tokens: [], error: true };
  }
}

export function formatCompactUsd(value: number): string {
  if (!value) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercentChange(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}
