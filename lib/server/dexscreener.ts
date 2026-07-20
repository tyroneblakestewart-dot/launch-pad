export type DexPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  url?: string;
  liquidity?: { usd?: number | null };
  volume?: { h24?: number | null };
};

export type DexPairResult =
  | { found: false }
  | {
      found: true;
      pairUrl: string;
      embedUrl: string;
      chainId: string;
      dexId: string;
      liquidityUsd: number;
    };

export const DEXSCREENER_ADDRESS_PATTERN = /^[A-Za-z0-9]{24,80}$/;

export function isValidDexscreenerAddress(value: string): boolean {
  return DEXSCREENER_ADDRESS_PATTERN.test(value);
}

function numeric(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isUsablePair(value: unknown): value is DexPair {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pair = value as DexPair;
  return Boolean(
    typeof pair.chainId === "string" &&
      pair.chainId &&
      typeof pair.pairAddress === "string" &&
      pair.pairAddress,
  );
}

export function selectBestDexPair(value: unknown): DexPair | null {
  if (!Array.isArray(value)) return null;

  const pairs = value.filter(isUsablePair);
  pairs.sort((a, b) => {
    const liquidityDifference = numeric(b.liquidity?.usd) - numeric(a.liquidity?.usd);
    if (liquidityDifference !== 0) return liquidityDifference;
    return numeric(b.volume?.h24) - numeric(a.volume?.h24);
  });
  return pairs[0] || null;
}

export function buildDexPairResult(pair: DexPair | null): DexPairResult {
  if (!pair?.chainId || !pair.pairAddress) return { found: false };

  const pairUrl = pair.url || `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`;
  return {
    found: true,
    pairUrl,
    embedUrl: `${pairUrl}?embed=1&theme=dark&trades=0&info=0`,
    chainId: pair.chainId,
    dexId: pair.dexId || "DEX",
    liquidityUsd: numeric(pair.liquidity?.usd),
  };
}
