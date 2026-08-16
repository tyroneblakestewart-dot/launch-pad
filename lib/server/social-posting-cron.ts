import { bodyContainsLink } from "@/lib/server/social-link-detection";
import {
  getSocialConnectionsStore,
  type SocialConnectionsStore,
} from "@/lib/server/social-connections-store";
import {
  getSocialScheduledPostsStore,
  type DueDestination,
  type SocialScheduledPostsStore,
} from "@/lib/server/social-scheduled-posts-store";
import { postTweetForUser } from "@/lib/server/social-x-client";
import { getSocialXCostStore, readXApiSendCostUsd, readXMonthlyCostCapUsd, type SocialXCostStore } from "@/lib/server/social-x-cost-store";
import { parseArtwork, publishTelegramPost } from "@/lib/server/telegram";

// Shared posting engine for both destinations (issue #335), following the
// same orchestration shape as lib/server/outreach-cron.ts: read due work,
// attempt delivery, record outcomes, never throw. Runs from
// app/api/cron/social-posting (secret-gated, every few minutes).
//
// Every destination gets independent retry-with-backoff up to
// MAX_DESTINATION_ATTEMPTS before it's marked permanently failed. Repeated
// failures against a connection (auth revoked, bot removed from a channel,
// or just a flaky run of errors) flip that connection to reconnect_needed —
// its still-pending destinations keep their long "paused" backoff so they
// resume automatically the moment the user reconnects, instead of being
// lost.
//
// Cost control (issue #342): X's pay-per-use pricing charges far more for a
// link-bearing post than a plain one, so an X destination whose body
// contains a link is NEVER sent through the API — it's routed to
// needs_composer instead (free X intent-composer handoff, done by the user).
// Every remaining (link-free) X send is metered: if sending it would push
// the wallet's running total for the current UTC calendar month past the
// owner-configured cap, the send is paused (not failed) until next month.
// Telegram is unaffected by either check — its Bot API is free.

export const MAX_DESTINATION_ATTEMPTS = 5;
export const RETRY_BACKOFF_BASE_SECONDS = 60;
export const PAUSED_RETRY_DELAY_SECONDS = 60 * 60;
export const DUE_DESTINATIONS_BATCH_LIMIT = 25;
export const CONNECTION_RECONNECT_FAILURE_THRESHOLD = 3;
export const LINK_POST_COMPOSER_REASON =
  "This post contains a link — link posts are published from your own X account to control API cost. Tap to post it from the X composer.";
export const MONTHLY_COST_CAP_REASON =
  "This wallet's monthly X posting cost cap has been reached — X sends resume next month. Telegram is unaffected.";

export function computeRetryBackoffSeconds(attemptCount: number): number {
  return RETRY_BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attemptCount);
}

export type SocialPostingCronResult = {
  ranAt: string;
  processed: number;
  sent: number;
  retried: number;
  failed: number;
  /** X destinations routed to the free composer instead of the paid API because their body contained a link. */
  routedToComposer: number;
  error: string | null;
};

export type SocialPostingCronDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  scheduledPostsStore?: SocialScheduledPostsStore;
  connectionsStore?: SocialConnectionsStore;
  costStore?: SocialXCostStore;
  postTweetForUser?: typeof postTweetForUser;
  publishTelegramPost?: typeof publishTelegramPost;
  /** Overridable for tests; defaults to the real link detector. */
  bodyContainsLink?: typeof bodyContainsLink;
};

function emptyResult(now: Date, overrides: Partial<SocialPostingCronResult> = {}): SocialPostingCronResult {
  return { ranAt: now.toISOString(), processed: 0, sent: 0, retried: 0, failed: 0, routedToComposer: 0, error: null, ...overrides };
}

type Outcome = "sent" | "retried" | "failed" | "routed_to_composer";

type FailureOptions = {
  /** A confirmed "this connection is broken" signal (revoked token, bot removed as admin, unreadable credentials) — flips the connection to reconnect_needed immediately, on the first occurrence. */
  connectionBroken?: boolean;
  /** No connection exists yet, or the platform isn't configured server-side — nothing wrong with any *existing* connection, so its failure count/status is left untouched. */
  paused?: boolean;
};

async function recordFailureAndSchedule(
  scheduledPostsStore: SocialScheduledPostsStore,
  connectionsStore: SocialConnectionsStore,
  destination: DueDestination,
  errorMessage: string,
  now: Date,
  options: FailureOptions = {},
): Promise<Outcome> {
  if (options.connectionBroken) {
    await connectionsStore.markReconnectNeeded(destination.walletAddress, destination.platform, errorMessage);
  } else if (!options.paused) {
    // Ordinary transient failure: only flips the connection to reconnect_needed after repeated occurrences.
    await connectionsStore.recordFailure(destination.walletAddress, destination.platform, errorMessage, CONNECTION_RECONNECT_FAILURE_THRESHOLD);
  }

  if (options.paused || options.connectionBroken) {
    await scheduledPostsStore.markDestinationRetry(
      destination.destinationId,
      errorMessage,
      new Date(now.getTime() + PAUSED_RETRY_DELAY_SECONDS * 1000),
    );
    return "retried";
  }

  if (destination.attemptCount + 1 >= MAX_DESTINATION_ATTEMPTS) {
    await scheduledPostsStore.markDestinationFailedFinal(destination.destinationId, errorMessage);
    return "failed";
  }

  const backoffSeconds = computeRetryBackoffSeconds(destination.attemptCount);
  await scheduledPostsStore.markDestinationRetry(
    destination.destinationId,
    errorMessage,
    new Date(now.getTime() + backoffSeconds * 1000),
  );
  return "retried";
}

async function sendOneDestination(
  destination: DueDestination,
  env: Record<string, string | undefined>,
  scheduledPostsStore: SocialScheduledPostsStore,
  connectionsStore: SocialConnectionsStore,
  costStore: SocialXCostStore,
  now: Date,
  postTweet: typeof postTweetForUser,
  publishTelegram: typeof publishTelegramPost,
  linkDetector: typeof bodyContainsLink,
): Promise<Outcome> {
  if (destination.platform === "x" && linkDetector(destination.body)) {
    await scheduledPostsStore.markDestinationNeedsComposer(destination.destinationId, LINK_POST_COMPOSER_REASON);
    return "routed_to_composer";
  }

  const connection = await connectionsStore.get(destination.walletAddress, destination.platform);
  if (!connection) {
    return recordFailureAndSchedule(scheduledPostsStore, connectionsStore, destination, "No connection is on file for this destination.", now, {
      paused: true,
    });
  }
  if (connection.status === "reconnect_needed") {
    return recordFailureAndSchedule(
      scheduledPostsStore,
      connectionsStore,
      destination,
      connection.reconnectReason || "This connection needs to be reconnected before it can post again.",
      now,
      { paused: true },
    );
  }

  const credentialsResult = await connectionsStore.getCredentials(destination.walletAddress, destination.platform);
  if (credentialsResult.status !== "ok") {
    return recordFailureAndSchedule(
      scheduledPostsStore,
      connectionsStore,
      destination,
      "The stored connection credentials could not be read — reconnect this destination.",
      now,
      { connectionBroken: true },
    );
  }

  if (destination.platform === "x") {
    let parsed: { accessToken: string; accessSecret: string } | null = null;
    try {
      parsed = JSON.parse(credentialsResult.plaintext);
    } catch {
      parsed = null;
    }
    if (!parsed?.accessToken || !parsed?.accessSecret) {
      return recordFailureAndSchedule(scheduledPostsStore, connectionsStore, destination, "The stored X credentials are invalid — reconnect X.", now, {
        connectionBroken: true,
      });
    }

    const costPerSend = readXApiSendCostUsd(env);
    const monthlyCap = readXMonthlyCostCapUsd(env);
    const monthlySoFar = await costStore.monthlyTotalUsd(destination.walletAddress, now);
    if (monthlySoFar + costPerSend > monthlyCap) {
      return recordFailureAndSchedule(scheduledPostsStore, connectionsStore, destination, MONTHLY_COST_CAP_REASON, now, { paused: true });
    }

    const result = await postTweet(destination.body, parsed, env);
    if (result.status === "posted") {
      await scheduledPostsStore.markDestinationSent(destination.destinationId, result.xPostId, now);
      await connectionsStore.resetFailures(destination.walletAddress, "x");
      await costStore.recordSend(destination.walletAddress, destination.destinationId, costPerSend, now);
      return "sent";
    }
    if (result.status === "not_configured") {
      return recordFailureAndSchedule(scheduledPostsStore, connectionsStore, destination, "X posting is not configured on this deployment.", now, {
        paused: true,
      });
    }
    if (result.status === "api_error" && (result.httpStatus === 401 || result.httpStatus === 403)) {
      return recordFailureAndSchedule(scheduledPostsStore, connectionsStore, destination, "X access was revoked — reconnect X to resume posting.", now, {
        connectionBroken: true,
      });
    }
    const message = result.status === "api_error" ? `X API error (HTTP ${result.httpStatus}): ${result.message}` : result.message;
    return recordFailureAndSchedule(scheduledPostsStore, connectionsStore, destination, message, now);
  }

  // Telegram
  let parsedTelegram: { chatId: string } | null = null;
  try {
    parsedTelegram = JSON.parse(credentialsResult.plaintext);
  } catch {
    parsedTelegram = null;
  }
  if (!parsedTelegram?.chatId) {
    return recordFailureAndSchedule(scheduledPostsStore, connectionsStore, destination, "The stored Telegram channel is invalid — reconnect Telegram.", now, {
      connectionBroken: true,
    });
  }

  const botToken = (env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!botToken) {
    return recordFailureAndSchedule(scheduledPostsStore, connectionsStore, destination, "Telegram posting is not configured on this deployment.", now, {
      paused: true,
    });
  }

  try {
    const artwork = destination.artworkDataUrl ? parseArtwork(destination.artworkDataUrl) : null;
    const messageIds = await publishTelegram({
      botToken,
      chatId: parsedTelegram.chatId,
      text: destination.body,
      artwork,
    });
    await scheduledPostsStore.markDestinationSent(destination.destinationId, String(messageIds[0] ?? ""), now);
    await connectionsStore.resetFailures(destination.walletAddress, "telegram");
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram publishing failed.";
    const revoked = /chat not found|not enough rights|CHAT_ADMIN_REQUIRED|kicked|have no rights/i.test(message);
    return recordFailureAndSchedule(scheduledPostsStore, connectionsStore, destination, message, now, revoked ? { connectionBroken: true } : {});
  }
}

export async function runSocialPostingCron(deps: SocialPostingCronDeps = {}): Promise<SocialPostingCronResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  const scheduledPostsStore = deps.scheduledPostsStore ?? getSocialScheduledPostsStore();
  const connectionsStore = deps.connectionsStore ?? getSocialConnectionsStore();
  const costStore = deps.costStore ?? getSocialXCostStore();
  const postTweet = deps.postTweetForUser ?? postTweetForUser;
  const publishTelegram = deps.publishTelegramPost ?? publishTelegramPost;
  const linkDetector = deps.bodyContainsLink ?? bodyContainsLink;

  try {
    const due = await scheduledPostsStore.listDueDestinations(now, DUE_DESTINATIONS_BATCH_LIMIT);
    let sent = 0;
    let retried = 0;
    let failed = 0;
    let routedToComposer = 0;
    const touchedPosts = new Set<string>();

    for (const destination of due) {
      const outcome = await sendOneDestination(destination, env, scheduledPostsStore, connectionsStore, costStore, now, postTweet, publishTelegram, linkDetector);
      if (outcome === "sent") sent += 1;
      else if (outcome === "retried") retried += 1;
      else if (outcome === "routed_to_composer") routedToComposer += 1;
      else failed += 1;
      touchedPosts.add(destination.scheduledPostId);
    }

    for (const postId of touchedPosts) {
      await scheduledPostsStore.recomputePostStatus(postId);
    }

    return emptyResult(now, { processed: due.length, sent, retried, failed, routedToComposer });
  } catch (error) {
    return emptyResult(now, { error: error instanceof Error ? error.message.slice(0, 500) : "Social posting cron run failed unexpectedly." });
  }
}
