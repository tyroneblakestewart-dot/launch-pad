// Pure display-formatting helpers for the public token page (issue #225),
// kept dependency-free so they're unit-testable without a network call or a
// DOM renderer (this repo's Vitest suite runs in a plain Node environment).

/** Shortens a 0x/base58 address to `0x7f3a…9c2e` style, matching the design reference. */
export function shortenAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Formats a USD amount compactly (e.g. `$248.6K`), or an em dash when unavailable. */
export function formatCompactUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Formats a holder-count integer with thousands separators, or an em dash when unavailable. */
export function formatHolderCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US");
}

/** Formats a holder's percent of supply, matching `TokenHolderStats`'s `<0.01` floor. */
export function formatHolderPercent(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return "—";
  return `${percent < 0.01 ? "<0.01" : percent.toFixed(2)}%`;
}

/**
 * Formats a USD price, showing enough decimal places to keep ~3 significant
 * digits visible for sub-cent memecoin prices (e.g. `$0.0002486`) instead of
 * rounding them all down to `$0.00`.
 */
export function formatUsdPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  if (value >= 1) return `$${value.toFixed(4)}`;
  const decimals = Math.min(12, Math.max(4, -Math.floor(Math.log10(Math.abs(value))) + 2));
  return `$${value.toFixed(decimals)}`;
}

/**
 * Formats a native-currency price (e.g. testnet ETH per token) with the same
 * significant-digit scaling as formatUsdPrice, but with no currency symbol —
 * the homepage grid's hover preview (issue #440) reads prices straight off
 * on-chain trades, and there is no USD conversion available for that path
 * without a new server call.
 */
export function formatNativeAmount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (value >= 1) return value.toFixed(4);
  const decimals = Math.min(12, Math.max(4, -Math.floor(Math.log10(Math.abs(value))) + 2));
  return value.toFixed(decimals);
}

/**
 * Formats a unix-seconds timestamp as a short "time ago" label (e.g. `4m`,
 * `2h`), matching lib/server/token-market-stats.ts's `relativeTime` style
 * but for the epoch-seconds timestamps real on-chain trades carry (issue
 * #430) instead of an ISO string.
 */
export function formatTimeAgoSeconds(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return "";
  const diffSeconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (diffSeconds < 60) return `${diffSeconds}s`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.floor(diffHours / 24)}d`;
}

/** Formats a 24h percent change with an up/down arrow, e.g. `▲ 34.7%` / `▼ 4.2%`. */
export function formatPriceChange(percent: number | null): { label: string; up: boolean } | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  const up = percent >= 0;
  return { label: `${up ? "▲" : "▼"} ${Math.abs(percent).toFixed(1)}%`, up };
}
