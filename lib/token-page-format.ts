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

/**
 * Formats a native-currency price (ETH per token) at exactly six
 * significant figures, e.g. `0.0000359717` or `1.00000`, with no unit
 * suffix — the token page v2 header band's big figure and the Stats panel
 * (issue #443 part 1) both need this exact precision regardless of
 * magnitude. `null`/non-finite/negative inputs return `"—"`.
 */
export function formatNativePriceSixSigFigs(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return (0).toFixed(6);
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.max(0, 6 - 1 - exponent);
  return value.toFixed(decimals);
}

/**
 * Formats a token balance with thousands separators and at most two decimal
 * places, e.g. `74,503.26` (issue #458 item 4) — the swap panel's sell-side
 * "bal" figure previously rendered a token balance at full 18-decimal
 * precision with no thousands separators, wrapping onto multiple lines.
 * Native/ETH balances are unaffected — they keep
 * `formatNativeAmountSixSigFigsTrimmed`'s six-significant-figure precision,
 * since a whole ETH balance is rarely large enough to need thousands
 * separators and needs far more than two decimals to read as non-zero.
 */
export function formatTokenBalanceAmount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Formats a native-currency amount at a fixed decimal count, or `"—"` when unavailable. */
export function formatNativeFixed(value: number | null, decimals: number): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

/**
 * Formats a native-currency amount (ETH) at up to six significant figures
 * with trailing zeros trimmed, e.g. `0.0000099`, `0.01` or `4` — the shared
 * helper behind the header band's graduation summary and "x ETH remaining"
 * line (issue #447 item 4). A fixed-decimal format like `formatNativeFixed`
 * reads wrong at both ends of a small testnet graduation target (`0.01` ETH
 * shown as `0.0` and a `0.0000099` raised amount shown as `0.00`), so this
 * reuses `formatNativePriceSixSigFigs`'s magnitude-aware precision and then
 * strips the zeros it pads on to hit exactly six significant figures.
 */
export function formatNativeAmountSixSigFigsTrimmed(value: number | null): string {
  const formatted = formatNativePriceSixSigFigs(value);
  if (formatted === "—" || !formatted.includes(".")) return formatted;
  return formatted.replace(/0+$/, "").replace(/\.$/, "");
}

/** Formats a signed percentage at a fixed decimal count, e.g. `+11.92%` / `-4.20%`, or `"—"` when unavailable. */
export function formatSignedPercent(value: number | null, decimals: number): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "+";
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

/**
 * Formats how long ago an ISO timestamp was, as the header band's coarse
 * single-unit "LAUNCHED xD AGO" duration (issue #443 part 1) — matching
 * `formatTimeAgoSeconds`'s m/h/d scale but for an ISO launch timestamp and
 * with no seconds tier (a token is never "launched Ns ago" in this design;
 * anything under a minute reads "JUST NOW"). Invalid/missing input: `"—"`.
 */
export function formatLaunchAge(launchedAtIso: string | null): string {
  if (!launchedAtIso) return "—";
  const launchedAt = new Date(launchedAtIso);
  if (Number.isNaN(launchedAt.getTime())) return "—";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - launchedAt.getTime()) / 1000));
  if (diffSeconds < 60) return "JUST NOW";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}M AGO`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}H AGO`;
  return `${Math.floor(diffHours / 24)}D AGO`;
}

/**
 * Builds the swap panel's fee note (issue #443 part 1 item 6) from the
 * curve's real fee constants instead of a hard-coded string, e.g.
 * `"1% fee · 60% treasury / 40% creator · bonding"`. `graduated` flips the
 * trailing phase word to `"graduated"`.
 */
export function formatFeeNote(
  tradingFeeBps: bigint,
  protocolShareBps: bigint,
  creatorShareBps: bigint,
  graduated: boolean,
): string {
  const feePercent = Number(tradingFeeBps) / 100;
  const protocolPercent = Number(protocolShareBps) / 100;
  const creatorPercent = Number(creatorShareBps) / 100;
  const phase = graduated ? "graduated" : "bonding";
  return `${feePercent}% fee · ${protocolPercent}% treasury / ${creatorPercent}% creator · ${phase}`;
}
