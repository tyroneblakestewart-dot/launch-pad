import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { runContentFilterFailClosed } from "@/lib/server/content-filter";
import { bodyContainsLink } from "@/lib/server/social-link-detection";
import { getPostgresPool } from "@/lib/server/postgres";
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
// app/api/cron/social-posting (secret-gated, every minute).
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
// Issue #392 — a final content-filter check right before send, so a body
// approved before the filter existed (or one the client-side checks missed)
// can never go out. This is terminal: the destination is marked permanently
// failed directly, bypassing recordFailureAndSchedule's retry/backoff
// entirely, since a filter violation is never a transient or auth problem
// that should be retried.
export const CONTENT_FILTER_REJECTION_ERROR_MESSAGE =
  "This post was blocked by our content safety filter (hateful slurs and sexualisation of minors are never allowed) and was not sent.";

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

export const SOCIAL_POSTING_JOB_KEY = "social-posting";
export const SOCIAL_POSTING_HEARTBEAT_TIMEOUT_MS = 2_000;

export type SocialPostingHeartbeatRecorder = {
  markStarted(startedAt: Date): Promise<void>;
  markCompleted(result: SocialPostingCronResult, completedAt: Date): Promise<void>;
};

type HeartbeatPool = {
  query(text: string, params?: unknown[]): Promise<unknown>;
};

const NOOP_SOCIAL_POSTING_HEARTBEAT: SocialPostingHeartbeatRecorder = {
  markStarted: async () => undefined,
  markCompleted: async () => undefined,
};

/**
 * Uses one overwrite-only row. Missing DATABASE_URL is a no-op so local
 * tests and deliberately unconfigured deployments retain the cron's
 * existing no-throw behaviour.
 */
export function createSocialPostingHeartbeatRecorder(
  env: Record<string, string | undefined> = process.env,
  getPool: (databaseUrl: string) => HeartbeatPool = getPostgresPool,
  /** The scheduled_job_heartbeats row to write. Defaults to this cron's own key; the Buy Bot cron reuses the exact same statements under its own key. */
  jobKey: string = SOCIAL_POSTING_JOB_KEY,
): SocialPostingHeartbeatRecorder {
  const databaseUrl = (env.DATABASE_URL || "").trim();
  if (!databaseUrl) return NOOP_SOCIAL_POSTING_HEARTBEAT;

  const pool = getPool(databaseUrl);
  return {
    async markStarted(startedAt) {
      // $2 is reused for both last_started_at and updated_at. Postgres infers
      // a bare parameter's type from the single expression it first appears
      // in, not from every column it's later assigned to — an explicit cast
      // on every occurrence keeps that inference unambiguous even though
      // both targets happen to be timestamptz today. Do not remove these
      // casts as "redundant"; see issue #386.
      await pool.query(
        `INSERT INTO scheduled_job_heartbeats (
           job_key, last_started_at, last_status, updated_at
         ) VALUES ($1, $2::timestamptz, 'running', $2::timestamptz)
         ON CONFLICT (job_key) DO UPDATE SET
           last_started_at = EXCLUDED.last_started_at,
           last_status = 'running',
           updated_at = EXCLUDED.updated_at`,
        [jobKey, startedAt],
      );
    },
    async markCompleted(result, completedAt) {
      const succeeded = result.error === null;
      // $3 (completedAt) is reused across last_completed_at, the CASE
      // producing last_succeeded_at, and updated_at; $4 (succeeded) is
      // reused across two CASE conditions. Postgres deduces a parameter's
      // type from the specific expression it's evaluated in — inside
      // `CASE WHEN $4 THEN $3 ELSE NULL END` it cannot fall back to the
      // target column's type, and NULL gives it nothing to unify against —
      // so reused, uncast parameters here previously raised "inconsistent
      // types deduced for parameter $3" and silently dropped every
      // heartbeat write. An explicit cast at every occurrence removes the
      // ambiguity; do not "clean up" these casts as redundant. See issue
      // #386.
      await pool.query(
        `INSERT INTO scheduled_job_heartbeats (
           job_key,
           last_started_at,
           last_completed_at,
           last_succeeded_at,
           last_status,
           last_processed,
           last_sent,
           last_retried,
           last_failed,
           last_routed_to_composer,
           updated_at
         ) VALUES (
           $1, $2::timestamptz, $3::timestamptz,
           CASE WHEN $4::boolean THEN $3::timestamptz ELSE NULL END,
           CASE WHEN $4::boolean THEN 'succeeded' ELSE 'failed' END,
           $5, $6, $7, $8, $9, $3::timestamptz
         )
         ON CONFLICT (job_key) DO UPDATE SET
           last_started_at = EXCLUDED.last_started_at,
           last_completed_at = EXCLUDED.last_completed_at,
           last_succeeded_at = CASE
             WHEN EXCLUDED.last_status = 'succeeded' THEN EXCLUDED.last_succeeded_at
             ELSE scheduled_job_heartbeats.last_succeeded_at
           END,
           last_status = EXCLUDED.last_status,
           last_processed = EXCLUDED.last_processed,
           last_sent = EXCLUDED.last_sent,
           last_retried = EXCLUDED.last_retried,
           last_failed = EXCLUDED.last_failed,
           last_routed_to_composer = EXCLUDED.last_routed_to_composer,
           updated_at = EXCLUDED.updated_at`,
        [
          jobKey,
          new Date(result.ranAt),
          completedAt,
          succeeded,
          result.processed,
          result.sent,
          result.retried,
          result.failed,
          result.routedToComposer,
        ],
      );
    },
  };
}

export async function recordHeartbeatBestEffort(
  action: "start" | "completion",
  operation: () => Promise<void>,
  jobLabel = "Social posting cron",
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("heartbeat timed out")), SOCIAL_POSTING_HEARTBEAT_TIMEOUT_MS);
  });
  try {
    await Promise.race([operation(), timeout]);
  } catch (error) {
    console.error(
      `${jobLabel} heartbeat ${action} could not be recorded.`,
      error instanceof Error ? error.message : error,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  /** Overridable for tests; defaults to the real fail-closed content filter. */
  contentFilterCheck?: typeof runContentFilterFailClosed;
  /** Overridable for tests; production writes one constant-size DB row. */
  heartbeatRecorder?: SocialPostingHeartbeatRecorder;
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

/**
 * A destination whose publish call has already succeeded is 'sent' — full
 * stop (issue #377). A failure to record that here is a monitoring
 * problem, never a delivery decision: it must never propagate into
 * recordFailureAndSchedule or connectionsStore.recordFailure, or a lost
 * status write would make the next cron run see the row as still due and
 * republish an already-delivered message.
 */
async function markSentBestEffort(
  scheduledPostsStore: SocialScheduledPostsStore,
  connectionsStore: SocialConnectionsStore,
  destination: DueDestination,
  externalPostId: string,
  now: Date,
): Promise<void> {
  try {
    await scheduledPostsStore.markDestinationSent(destination.destinationId, externalPostId, now);
  } catch (error) {
    console.error("Marking a destination sent failed after a successful publish.", error instanceof Error ? error.message : error);
  }
  try {
    await connectionsStore.resetFailures(destination.walletAddress, destination.platform);
  } catch (error) {
    console.error("Resetting connection failures failed after a successful publish.", error instanceof Error ? error.message : error);
  }
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
  contentFilterCheck: typeof runContentFilterFailClosed,
): Promise<Outcome> {
  const contentFilterOutcome = contentFilterCheck({ body: destination.body });
  if (contentFilterOutcome.blocked) {
    await scheduledPostsStore.markDestinationFailedFinal(destination.destinationId, CONTENT_FILTER_REJECTION_ERROR_MESSAGE);
    void recordAdminActivityBestEffort({
      kind: "content-filter-rejected",
      serviceKey: "social-posting",
      message: `Content filter rejected a scheduled post before send (platform: ${destination.platform}, wallet: ${destination.walletAddress}).`,
    });
    return "failed";
  }

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
      await markSentBestEffort(scheduledPostsStore, connectionsStore, destination, result.xPostId, now);
      // Best-effort (issue #368): a DB failure here must never turn an
      // already-successful post into a cron failure or schedule a duplicate
      // retry — the destination stays "sent" either way.
      try {
        await costStore.recordSend(destination.walletAddress, destination.destinationId, costPerSend, now);
      } catch (error) {
        console.error("X posting cost recording failed after a successful send.", error instanceof Error ? error.message : error);
      }
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

  let messageIds: number[];
  try {
    const artwork = destination.artworkDataUrl ? parseArtwork(destination.artworkDataUrl) : null;
    messageIds = await publishTelegram({
      botToken,
      chatId: parsedTelegram.chatId,
      text: destination.body,
      artwork,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram publishing failed.";
    const revoked = /chat not found|not enough rights|CHAT_ADMIN_REQUIRED|kicked|have no rights/i.test(message);
    return recordFailureAndSchedule(scheduledPostsStore, connectionsStore, destination, message, now, revoked ? { connectionBroken: true } : {});
  }

  // Outside the publish try/catch on purpose (issue #377) — the message is
  // already in the channel at this point, so nothing below this line may
  // ever route into recordFailureAndSchedule.
  await markSentBestEffort(scheduledPostsStore, connectionsStore, destination, String(messageIds[0] ?? ""), now);
  return "sent";
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
  const contentFilterCheck = deps.contentFilterCheck ?? runContentFilterFailClosed;
  const heartbeat = deps.heartbeatRecorder ?? createSocialPostingHeartbeatRecorder(env);

  await recordHeartbeatBestEffort("start", () => heartbeat.markStarted(now));

  let result: SocialPostingCronResult;
  try {
    const due = await scheduledPostsStore.listDueDestinations(now, DUE_DESTINATIONS_BATCH_LIMIT);
    let sent = 0;
    let retried = 0;
    let failed = 0;
    let routedToComposer = 0;
    const touchedPosts = new Set<string>();

    for (const destination of due) {
      // Isolated per destination (issue #377) — one destination's
      // unexpected throw must not abort the rest of the batch or skip
      // recomputePostStatus for posts already processed this run.
      try {
        const outcome = await sendOneDestination(destination, env, scheduledPostsStore, connectionsStore, costStore, now, postTweet, publishTelegram, linkDetector, contentFilterCheck);
        if (outcome === "sent") sent += 1;
        else if (outcome === "retried") retried += 1;
        else if (outcome === "routed_to_composer") routedToComposer += 1;
        else failed += 1;
      } catch (error) {
        console.error("Unexpected error while processing a social posting destination.", error instanceof Error ? error.message : error);
        failed += 1;
      } finally {
        touchedPosts.add(destination.scheduledPostId);
      }
    }

    for (const postId of touchedPosts) {
      await scheduledPostsStore.recomputePostStatus(postId);
    }

    result = emptyResult(now, { processed: due.length, sent, retried, failed, routedToComposer });
  } catch (error) {
    result = emptyResult(now, { error: error instanceof Error ? error.message.slice(0, 500) : "Social posting cron run failed unexpectedly." });
  }

  const completedAt = deps.now ?? new Date();
  await recordHeartbeatBestEffort("completion", () => heartbeat.markCompleted(result, completedAt));
  return result;
}
