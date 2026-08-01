export const ROBINHOOD_TRENDING_INTERVALS = ["5m", "1h"] as const;

export type RobinhoodTrendingInterval = (typeof ROBINHOOD_TRENDING_INTERVALS)[number];

export type RobinhoodTrendingToken = {
  address: string;
  name: string;
  symbol: string;
  rank: number;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volumeUsd: number | null;
  swaps: number | null;
  holders: number | null;
  priceChangePercent: number | null;
  devTeamHoldRate: number | null;
  smartMoneyCount: number | null;
  launchpad: string | null;
};

export type RobinhoodTrendingResponse = {
  source: "GMGN";
  interval: RobinhoodTrendingInterval;
  updatedAt: string;
  tokens: RobinhoodTrendingToken[];
};

export function isRobinhoodTrendingInterval(
  value: unknown,
): value is RobinhoodTrendingInterval {
  return ROBINHOOD_TRENDING_INTERVALS.includes(value as RobinhoodTrendingInterval);
}
