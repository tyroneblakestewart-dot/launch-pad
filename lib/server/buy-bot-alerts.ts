import { formatEther, formatUnits } from "viem";
import { tradeSpotPriceNativePerToken } from "@/lib/candle-bucketing";
import { formatGraduationProgressPercent, type BondingCurveGraduationStatus } from "@/lib/bonding-curve-status";
import { buildHoodlumsTradeUrl } from "@/lib/free-site-platform-facts";
import {
  formatNativeAmountSixSigFigsTrimmed,
  formatNativePriceSixSigFigs,
  formatTokenBalanceAmount,
  shortenAddress,
} from "@/lib/token-page-format";
import type { TokenTrade } from "@/lib/token-trade-types";
import type { SupportedChain } from "@/lib/types";

// Pure Buy Bot selection and message maths (owner direction, 5 Sep 2026) —
// no I/O, so the cron's "which buys, in what words" is unit-tested directly
// in Node the way lib/social-studio-queue.ts is. Every number comes from the
// trade's own emitted fields (gross native paid, tokens out, post-trade
// reserves) through the same formatters the token page already uses — the
// bot can never announce a figure the page itself wouldn't show.

/** Curve trades are ordered by (blockNumber, logIndex) — a cursor is the last one already announced. */
export type BuyBotCursor = { blockNumber: string; logIndex: number };

/** At most this many announcements per bot per cron run — Telegram allows roughly 20 messages a minute per channel, and a burst is spread across runs rather than dropped. */
export const MAX_BUY_ALERTS_PER_RUN = 5;

export function compareTradeOrder(a: BuyBotCursor, b: BuyBotCursor): number {
  const blockA = BigInt(a.blockNumber);
  const blockB = BigInt(b.blockNumber);
  if (blockA !== blockB) return blockA < blockB ? -1 : 1;
  return a.logIndex - b.logIndex;
}

/** The newest trade's position, or the zero cursor when a curve has no trades yet — what a freshly enabled bot starts from so history is never replayed. */
export function newestTradeCursor(trades: readonly TokenTrade[]): BuyBotCursor {
  let newest: BuyBotCursor | null = null;
  for (const trade of trades) {
    const candidate = { blockNumber: trade.blockNumber, logIndex: trade.logIndex };
    if (!newest || compareTradeOrder(candidate, newest) > 0) newest = candidate;
  }
  return newest ?? { blockNumber: "0", logIndex: -1 };
}

/** What the buyer paid, gross of the curve fee — the "size" a channel reader means by a buy. Falls back to the post-fee amount for fixtures without the gross field. */
export function buyGrossNativeWei(trade: TokenTrade): bigint {
  return BigInt(trade.grossNativeAmountRaw ?? trade.nativeAmountRaw);
}

/**
 * Buys strictly after the cursor whose gross size is at or above the
 * threshold, oldest first, capped at `limit`. Sells are never announced;
 * post-graduation pool buys are, since "every purchase" doesn't stop at
 * graduation.
 */
export function selectBuyAlerts(
  trades: readonly TokenTrade[],
  cursor: BuyBotCursor,
  thresholdWei: string,
  limit = MAX_BUY_ALERTS_PER_RUN,
): TokenTrade[] {
  const threshold = BigInt(thresholdWei);
  return trades
    .filter((trade) => trade.direction === "buy")
    .filter((trade) => compareTradeOrder({ blockNumber: trade.blockNumber, logIndex: trade.logIndex }, cursor) > 0)
    .filter((trade) => buyGrossNativeWei(trade) >= threshold)
    .sort((a, b) => compareTradeOrder(a, b))
    .slice(0, Math.max(0, limit));
}

export type BuyAlertMessageInput = {
  tokenName: string;
  ticker: string;
  decimals: number;
  chain: SupportedChain;
  tokenAddress: string;
  trade: TokenTrade;
  progress: BondingCurveGraduationStatus | null;
};

/**
 * Plain-text Telegram body (no parse_mode, so nothing a token name contains
 * can ever be read as markup). Fits comfortably inside a 1024-char photo
 * caption so it rides as the artwork's caption in one message.
 */
export function formatBuyAlertMessage(input: BuyAlertMessageInput): string {
  const ticker = input.ticker.trim().toUpperCase();
  const paid = formatNativeAmountSixSigFigsTrimmed(Number(formatEther(buyGrossNativeWei(input.trade))));
  const tokensOut = formatTokenBalanceAmount(Number(formatUnits(BigInt(input.trade.tokenAmountRaw), input.decimals)));
  const spot = tradeSpotPriceNativePerToken(input.trade, input.decimals);
  const priceLine = spot > 0 ? `Price ${formatNativePriceSixSigFigs(spot)} ETH` : null;
  const progressLine =
    input.progress?.state === "graduated"
      ? "Graduated · trading on the locked pool"
      : input.progress?.state === "bonding"
        ? `Graduation ${formatGraduationProgressPercent(input.progress.progressBps)}`
        : null;

  const lines = [
    `🟢 New buy — ${input.tokenName.trim() || ticker}${ticker ? ` ($${ticker})` : ""}`,
    `${paid} ETH → ${tokensOut}${ticker ? ` ${ticker}` : ""}`,
    `Buyer ${shortenAddress(input.trade.wallet)}`,
  ];
  const stats = [priceLine, progressLine].filter((line): line is string => line !== null);
  if (stats.length > 0) lines.push(stats.join(" · "));
  lines.push(`Trade on Hoodlums: ${buildHoodlumsTradeUrl(input.chain, input.tokenAddress)}`);
  return lines.join("\n");
}

/** Telegram error texts that mean the bot can no longer post in that channel at all — worth flipping straight to reconnect_needed rather than retrying. */
export function isTelegramChannelLostError(message: string): boolean {
  return /chat not found|bot was kicked|bot is not a member|not enough rights|CHAT_WRITE_FORBIDDEN|need administrator rights|bot was blocked|chat_write_forbidden|have no rights to send/i.test(
    message,
  );
}
