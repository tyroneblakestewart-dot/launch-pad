import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import {
  formatBuyAlertMessage,
  isTelegramChannelLostError,
  MAX_BUY_ALERTS_PER_RUN,
  selectBuyAlerts,
} from "@/lib/server/buy-bot-alerts";
import { getBuyBotStore, type BuyBot, type BuyBotStore } from "@/lib/server/buy-bot-store";
import { runContentFilterFailClosed } from "@/lib/server/content-filter";
import { getCurveProgress } from "@/lib/server/curve-progress-cache";
import {
  createSocialPostingHeartbeatRecorder,
  recordHeartbeatBestEffort,
  type SocialPostingCronResult,
  type SocialPostingHeartbeatRecorder,
} from "@/lib/server/social-posting-cron";
import { parseArtwork, publishTelegramPost } from "@/lib/server/telegram";
import { getTokenLaunchesStore, type TokenLaunchesStore } from "@/lib/server/token-launches-store";
import { getTokenTrades } from "@/lib/server/token-trades-rpc";
import type { TokenTrade } from "@/lib/token-trade-types";

// The Buy Bot's engine (owner direction, 5 Sep 2026), run every minute from
// app/api/cron/buy-bot. For every active bot it reads the token's curve
// trades through the exact same cached lib/server/token-trades-rpc.ts read
// the token page and homepage grid already poll (so a hundred bots on one
// token are still one RPC read every ~4s), picks the buys strictly after the
// bot's cursor that clear its threshold, and posts each one to the bot's own
// Telegram channel with the launch's recorded artwork as the photo. The
// cursor only ever advances past a buy that was actually delivered, so a
// crashed run resumes where it stopped. Nothing here spends money: the
// Telegram Bot API is free and no model is involved.
//
// Failure handling mirrors lib/server/social-posting-cron.ts's connection
// rules: a Telegram error that means "the bot can't post here any more"
// (kicked, rights removed, channel deleted) flips the bot straight to
// reconnect_needed; ordinary transient errors only get there after
// BUY_BOT_RECONNECT_FAILURE_THRESHOLD consecutive failures. A trade-read
// failure is counted but never touches the cursor or the bot's status — the
// chain being unreachable is nothing the user can fix by re-adding the bot.

export const BUY_BOT_JOB_KEY = "buy-bot";
export const BUY_BOT_BATCH_LIMIT = 25;
export const BUY_BOT_RECONNECT_FAILURE_THRESHOLD = 5;
export const BUY_BOT_CONTENT_FILTER_MESSAGE = "The content filter blocked this announcement.";

export type BuyBotCronResult = {
  ranAt: string;
  /** Bots worked this run. */
  processed: number;
  /** Buy announcements delivered. */
  sent: number;
  /** Bots whose run hit an error (trade read, channel read, Telegram). */
  failed: number;
  /** Bots flipped to reconnect_needed this run. */
  reconnectNeeded: number;
  error: string | null;
};

export type BuyBotTradesReader = (chainId: number, curveAddress: `0x${string}`) => Promise<TokenTrade[]>;
export type BuyBotProgressReader = typeof getCurveProgress;

let tradesReaderForTests: BuyBotTradesReader | null = null;

/** Test seam shared by the cron and the enable route (which seats a new bot's cursor from the same read): inject a reader instead of hitting the RPC. */
export function setBuyBotTradesReaderForTests(reader: BuyBotTradesReader | null): void {
  tradesReaderForTests = reader;
}

/** The injected test reader when one is set, else the real cached curve-trades read. */
export function resolveBuyBotTradesReader(): BuyBotTradesReader {
  return tradesReaderForTests ?? ((chainId, curve) => getTokenTrades(chainId, curve));
}

export type BuyBotCronDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  store?: BuyBotStore;
  launchesStore?: TokenLaunchesStore;
  readTrades?: BuyBotTradesReader;
  readProgress?: BuyBotProgressReader;
  publishTelegramPost?: typeof publishTelegramPost;
  contentFilterCheck?: typeof runContentFilterFailClosed;
  heartbeatRecorder?: SocialPostingHeartbeatRecorder;
};

function emptyResult(now: Date, overrides: Partial<BuyBotCronResult> = {}): BuyBotCronResult {
  return { ranAt: now.toISOString(), processed: 0, sent: 0, failed: 0, reconnectNeeded: 0, error: null, ...overrides };
}

/** Maps this cron's counters onto the shared constant-size heartbeat row: processed = bots, sent = alerts, failed = bots that errored, retried/composer unused. */
export function toHeartbeatResult(result: BuyBotCronResult): SocialPostingCronResult {
  return {
    ranAt: result.ranAt,
    processed: result.processed,
    sent: result.sent,
    retried: 0,
    failed: result.failed,
    routedToComposer: 0,
    error: result.error,
  };
}

type BotOutcome = { sent: number; failed: boolean; reconnectNeeded: boolean };

async function runOneBot(
  bot: BuyBot,
  env: Record<string, string | undefined>,
  store: BuyBotStore,
  launchesStore: TokenLaunchesStore,
  readTrades: BuyBotTradesReader,
  readProgress: BuyBotProgressReader,
  publishTelegram: typeof publishTelegramPost,
  contentFilterCheck: typeof runContentFilterFailClosed,
  now: Date,
): Promise<BotOutcome> {
  const botToken = (env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!botToken) {
    // Nothing wrong with the bot itself — the deployment just can't post. Leave status untouched.
    return { sent: 0, failed: true, reconnectNeeded: false };
  }

  let trades: TokenTrade[];
  try {
    trades = await readTrades(bot.chainId, bot.curveAddress as `0x${string}`);
  } catch (error) {
    await store.recordFailure(bot.id, `Trade read failed: ${error instanceof Error ? error.message : "unknown error"}`, Number.MAX_SAFE_INTEGER);
    return { sent: 0, failed: true, reconnectNeeded: false };
  }

  const alerts = selectBuyAlerts(trades, { blockNumber: bot.cursorBlockNumber, logIndex: bot.cursorLogIndex }, bot.thresholdWei, MAX_BUY_ALERTS_PER_RUN);
  if (alerts.length === 0) return { sent: 0, failed: false, reconnectNeeded: false };

  const channel = await store.getChannel(bot.id);
  let chatId = "";
  if (channel.status === "ok") {
    try {
      chatId = String((JSON.parse(channel.plaintext) as { chatId?: unknown }).chatId ?? "");
    } catch {
      chatId = "";
    }
  }
  if (!chatId) {
    await store.markReconnectNeeded(bot.id, "The stored Telegram channel could not be read — add the Buy Bot to your channel again.");
    return { sent: 0, failed: true, reconnectNeeded: true };
  }

  const launch = await launchesStore.findByTokenAddress(bot.chainId, bot.tokenAddress).catch(() => null);
  const tokenName = launch?.tokenName || bot.tokenAddress;
  const ticker = launch?.ticker || "";
  const decimals = launch?.decimals ?? 18;
  const artwork = launch?.artworkThumbnail ? parseArtwork(launch.artworkThumbnail) : null;
  const progress = await readProgress(bot.chainId, bot.curveAddress).catch(() => null);

  let sent = 0;
  for (const trade of alerts) {
    const text = formatBuyAlertMessage({
      tokenName,
      ticker,
      decimals,
      chain: "robinhood",
      tokenAddress: bot.tokenAddress,
      trade,
      progress,
    });

    // The only free text here is the token's own name/ticker, which a
    // launch could still carry — run the same fail-closed pre-send check
    // every other Telegram send in this codebase runs. A blocked message is
    // skipped (cursor advanced) rather than retried forever: it will never
    // pass on a retry.
    if (contentFilterCheck({ body: text }).blocked) {
      await store.advanceCursor(bot.id, trade.blockNumber, trade.logIndex, now);
      void recordAdminActivityBestEffort({
        kind: "content-filter-rejected",
        serviceKey: "buy-bot",
        message: `Content filter blocked a Buy Bot announcement before send (token: ${bot.tokenAddress}, wallet: ${bot.walletAddress}).`,
      });
      continue;
    }

    try {
      await publishTelegram({ botToken, chatId, text, artwork });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Telegram send failed.";
      if (isTelegramChannelLostError(message)) {
        await store.markReconnectNeeded(bot.id, `Telegram: ${message.slice(0, 300)} — add the Buy Bot to your channel again.`);
        void recordAdminActivityBestEffort({
          kind: "buy-bot-reconnect-needed",
          serviceKey: "buy-bot",
          message: `Buy Bot for ${bot.tokenAddress} (wallet ${bot.walletAddress}) lost its Telegram channel.`,
        });
        return { sent, failed: true, reconnectNeeded: true };
      }
      await store.recordFailure(bot.id, `Telegram: ${message.slice(0, 300)}`, BUY_BOT_RECONNECT_FAILURE_THRESHOLD);
      const flipped = bot.failureCount + 1 >= BUY_BOT_RECONNECT_FAILURE_THRESHOLD;
      return { sent, failed: true, reconnectNeeded: flipped };
    }

    await store.advanceCursor(bot.id, trade.blockNumber, trade.logIndex, now);
    sent += 1;
  }

  return { sent, failed: false, reconnectNeeded: false };
}

export async function runBuyBotCron(deps: BuyBotCronDeps = {}): Promise<BuyBotCronResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  const store = deps.store ?? getBuyBotStore();
  const launchesStore = deps.launchesStore ?? getTokenLaunchesStore();
  const readTrades: BuyBotTradesReader = deps.readTrades ?? resolveBuyBotTradesReader();
  const readProgress = deps.readProgress ?? getCurveProgress;
  const publishTelegram = deps.publishTelegramPost ?? publishTelegramPost;
  const contentFilterCheck = deps.contentFilterCheck ?? runContentFilterFailClosed;
  const heartbeat = deps.heartbeatRecorder ?? createSocialPostingHeartbeatRecorder(env, undefined, BUY_BOT_JOB_KEY);

  await recordHeartbeatBestEffort("start", () => heartbeat.markStarted(now), "Buy Bot cron");

  let result: BuyBotCronResult;
  try {
    const bots = await store.listActive(BUY_BOT_BATCH_LIMIT);
    let sent = 0;
    let failed = 0;
    let reconnectNeeded = 0;

    for (const bot of bots) {
      // Isolated per bot — one bot's unexpected throw must never abort the rest of the batch.
      try {
        const outcome = await runOneBot(bot, env, store, launchesStore, readTrades, readProgress, publishTelegram, contentFilterCheck, now);
        sent += outcome.sent;
        if (outcome.failed) failed += 1;
        if (outcome.reconnectNeeded) reconnectNeeded += 1;
      } catch (error) {
        failed += 1;
        console.error("Buy Bot run failed for one bot.", bot.id, error instanceof Error ? error.message : error);
      }
    }

    result = emptyResult(now, { processed: bots.length, sent, failed, reconnectNeeded });
  } catch (error) {
    result = emptyResult(now, { error: error instanceof Error ? error.message.slice(0, 500) : "Buy Bot cron run failed unexpectedly." });
  }

  const completedAt = deps.now ?? new Date();
  await recordHeartbeatBestEffort("completion", () => heartbeat.markCompleted(toHeartbeatResult(result), completedAt), "Buy Bot cron");
  return result;
}
