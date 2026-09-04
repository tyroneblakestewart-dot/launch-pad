import { formatCompactUsd, formatLaunchAge, formatNativeAmountSixSigFigsTrimmed, formatSignedPercent } from "@/lib/token-page-format";

// Pure display maths for a homepage grid card (owner direction, 4 Sep 2026:
// pump.fun-style cards — artwork with the performance line drawn over it, a
// real market cap, a change pill and the launch age). Dependency-free so it
// is unit-testable in this repo's plain-Node Vitest suite without a DOM.

/**
 * Market cap in native currency: the newest spot price (native per whole
 * token, from the token's real trades) times the fixed whole-token supply
 * recorded at launch. `null` until the first trade exists — the card renders
 * an em dash, never a fabricated zero.
 */
export function computeGridMarketCapNative(lastPrice: number | null, wholeTokenSupply: string): number | null {
  if (lastPrice === null || !Number.isFinite(lastPrice) || lastPrice <= 0) return null;
  const supply = Number(wholeTokenSupply);
  if (!Number.isFinite(supply) || supply <= 0) return null;
  return lastPrice * supply;
}

/** `"0.0042 ETH"` style label, or `"—"` before any trade. */
export function formatGridMarketCap(marketCapNative: number | null): string {
  if (marketCapNative === null) return "—";
  const figure = formatNativeAmountSixSigFigsTrimmed(marketCapNative);
  return figure === "—" ? "—" : `${figure} ETH`;
}

/** Third-party (Dexscreener) market cap in USD, e.g. `"$117.9K"`. */
export function formatGridMarketCapUsd(marketCapUsd: number): string {
  return marketCapUsd > 0 ? formatCompactUsd(marketCapUsd) : "—";
}

export type GridChangePill = { label: string; direction: "up" | "down" | "flat" };

/**
 * The change pill: `+12.3%` in lime for up, `-4.2%` in the design's grey for
 * down, and no pill at all (`null`) while there is nothing to compare — a
 * token with fewer than two priced trades has no direction to show.
 */
export function buildGridChangePill(changePercent: number | null, decimals = 1): GridChangePill | null {
  if (changePercent === null || !Number.isFinite(changePercent)) return null;
  const rounded = Number(changePercent.toFixed(decimals));
  return {
    label: formatSignedPercent(changePercent, decimals),
    direction: rounded > 0 ? "up" : rounded < 0 ? "down" : "flat",
  };
}

/** Lower-case age for the card's meta row, e.g. `2h ago`, `just now`. */
export function formatGridAge(launchedAtIso: string | null): string {
  const label = formatLaunchAge(launchedAtIso);
  return label === "—" ? "—" : label.toLowerCase();
}

/** How many domestic cards the grid shows before "Show more" — two rows of four (owner direction: 8 domestic + 4 third-party = 12 panels). */
export const GRID_PAGE_SIZE = 8;

/** Third-party panels shown in the bottom row. */
export const TRENDING_PANEL_COUNT = 4;
