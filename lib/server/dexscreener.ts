export type DexPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  url?: string;
  liquidity?: { usd?: number | null };
  volume?: { h24?: number | null };
};

export type DexscreenerPairResult =
  | { found: false }
  | {
      found: true;
      pairUrl: string;
      embedUrl: string;
      chainId: string;
      dexId: string;
      liquidityUsd: number;
    };

export const DEX_ADDRESS_PATTERN = /^[A-Za-z0-9]{24,80}$/;

export function isValidDexAddress(value: string): boolean {
  return DEX_ADDRESS_PATTERN.test(value);
}

export function selectBestPair(pairs: DexPair[]): DexPair | null {
  return (
    [...pairs]
      .filter((item) => item.chainId && item.pairAddress)
      .sort((a, b) => {
        const liquidityDifference =
          Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0);
        if (liquidityDifference !== 0) return liquidityDifference;
        return Number(b.volume?.h24 || 0) - Number(a.volume?.h24 || 0);
      })[0] || null
  );
}

export function buildDexscreenerPairResult(pair: DexPair | null): DexscreenerPairResult {
  if (!pair?.chainId || !pair.pairAddress) return { found: false };

  const pairUrl = pair.url || `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`;
  return {
    found: true,
    pairUrl,
    embedUrl: `${pairUrl}?embed=1&theme=dark&trades=0&info=0`,
    chainId: pair.chainId,
    dexId: pair.dexId || "DEX",
    liquidityUsd: Number(pair.liquidity?.usd || 0),
  };
}
