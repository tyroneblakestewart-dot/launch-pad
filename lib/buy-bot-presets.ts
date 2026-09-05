// Shared (client + server) Buy Bot settings — the three "only above" buy
// thresholds the Settings & Rules row has always drawn, now backed by real
// wei values so the browser, the enable/update routes and the cron all agree
// on exactly what a threshold means. Owner decisions (5 Sep 2026): the Buy
// Bot posts into its own Telegram channel binding (separate from the Social
// Studio posting connection), announces text plus the launch's recorded
// artwork, and defaults to 0.01 ETH when first switched on.

export type BuyBotThresholdPreset = {
  label: string;
  /** Gross native amount in wei, as a decimal string (never a float). */
  wei: string;
};

export const BUY_BOT_THRESHOLD_PRESETS: readonly BuyBotThresholdPreset[] = [
  { label: "0.01 ETH", wei: "10000000000000000" },
  { label: "0.05 ETH", wei: "50000000000000000" },
  { label: "0.1 ETH", wei: "100000000000000000" },
] as const;

export const DEFAULT_BUY_BOT_THRESHOLD_WEI = BUY_BOT_THRESHOLD_PRESETS[0].wei;

/** True only for one of the three preset wei strings — the server never accepts an arbitrary threshold. */
export function isBuyBotThresholdPreset(value: unknown): value is string {
  return typeof value === "string" && BUY_BOT_THRESHOLD_PRESETS.some((preset) => preset.wei === value);
}

/** The preset label for a stored wei value, or the raw value when it isn't a preset (defensive: never throws for display). */
export function formatBuyBotThreshold(wei: string): string {
  return BUY_BOT_THRESHOLD_PRESETS.find((preset) => preset.wei === wei)?.label ?? `${wei} wei`;
}

/** Inverse of `formatBuyBotThreshold` for the Rules row's label-keyed select; falls back to the default. */
export function buyBotThresholdWeiForLabel(label: string): string {
  return BUY_BOT_THRESHOLD_PRESETS.find((preset) => preset.label === label)?.wei ?? DEFAULT_BUY_BOT_THRESHOLD_WEI;
}

export type BuyBotStatus = "active" | "paused" | "reconnect_needed";

export function isBuyBotStatus(value: unknown): value is BuyBotStatus {
  return value === "active" || value === "paused" || value === "reconnect_needed";
}

/** Shape returned by GET /api/social/buy-bot for one bot — never includes the channel binding itself, only its display name/handle. */
export type BuyBotSummary = {
  chainId: number;
  tokenAddress: string;
  channelDisplayName: string;
  channelExternalId: string;
  thresholdWei: string;
  status: BuyBotStatus;
  lastError: string | null;
  lastPostedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
