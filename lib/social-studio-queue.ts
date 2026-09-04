// Pure, unit-testable logic behind the Social Studio Queue tab (issue #352):
// classifying scheduled posts into "approved & scheduled" vs "history",
// working out which destinations a draft may be approved to, spreading
// default schedule times, and sizing the client-side auto-replenish loop.
// Kept dependency-free of components/social-hub.tsx so it can be tested
// directly instead of only through source-string assertions.

import { truncateAccountAddress } from "@/lib/account-wallet-state";
import {
  DEFAULT_POSTING_CADENCE,
  DEFAULT_QUEUE_TARGET,
  MAX_QUEUE_TARGET,
  POSTING_CADENCE_OPTIONS,
  type PostingCadence,
  type SocialPlatform,
} from "@/lib/social-studio-types";

export type ConnectionStatusSummary = {
  platform: SocialPlatform;
  status: "connected" | "reconnect_needed";
};

/** Destinations a draft may actually be approved to — connected accounts only, per the issue's "limited to destinations the user has actually connected". */
export function connectedPlatforms(connections: ConnectionStatusSummary[]): SocialPlatform[] {
  return connections.filter((connection) => connection.status === "connected").map((connection) => connection.platform);
}

/** How many replacement drafts the auto-replenish loop should generate right now — never negative, never more than the shortfall. */
export function replenishShortfall(readyCount: number, target: number): number {
  return Math.max(0, target - readyCount);
}

/**
 * Matches the server's MAX_RECENT_DRAFTS_CONTEXT input cap
 * (lib/server/social-draft-pipeline.ts) — no point carrying a longer local
 * window than the server will ever read.
 */
export const MAX_ROLLING_RECENT_DRAFTS = 5;

/**
 * Advances a refill batch's local rolling recent-draft context by one newly
 * generated X text, most recent first, capped at MAX_ROLLING_RECENT_DRAFTS
 * (issue #366). A refill loop seeds this from the current queue once, then
 * calls this after each successful generation instead of reading the
 * React `queue` state — which does not update synchronously mid-loop, so
 * every request in a batch was seeing the same stale (often empty) context.
 */
export function advanceRollingRecentDrafts(current: string[], newDraftXText: string): string[] {
  return [newDraftXText, ...current].slice(0, MAX_ROLLING_RECENT_DRAFTS);
}

/** Clamps a user-entered Settings & Rules target into [1, MAX_QUEUE_TARGET], falling back to the default for non-finite input. */
export function clampQueueTarget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_QUEUE_TARGET;
  return Math.min(MAX_QUEUE_TARGET, Math.max(1, Math.round(value)));
}

/**
 * Whether a post still anchors the schedule-spread default (issue #380) —
 * `needs_composer` is terminal (it never sends automatically, the user must
 * tap through the free X composer themselves), so it must not permanently
 * push every later default further out. Only genuinely still-pending
 * `scheduled` posts should do that.
 */
export function isPendingSendStatus(status: string): boolean {
  return status === "scheduled";
}

const AWAITING_SEND_STATUSES = new Set(["scheduled", "needs_composer"]);
const HISTORY_STATUSES = new Set(["sent", "partially_sent", "failed", "canceled"]);

/** "Approved & scheduled" section membership — waiting to send, or waiting on a manual composer hand-off. */
export function isAwaitingSend(status: string): boolean {
  return AWAITING_SEND_STATUSES.has(status);
}

/** "History" section membership — sent, failed, mixed, or canceled; nothing left to do automatically. */
export function isHistoryStatus(status: string): boolean {
  return HISTORY_STATUSES.has(status);
}

/**
 * A sensible default schedule time for a newly-approved draft: "now", unless
 * that would land within `spreadHoursMs` of the latest already-scheduled
 * post, in which case it's pushed out by one spread interval so a run of
 * approvals doesn't pile up at the same instant.
 */
export function computeDefaultScheduledAt(
  existingScheduledAtIso: string[],
  now: Date,
  spreadHoursMs = 2 * 60 * 60 * 1000,
): Date {
  const nowMs = now.getTime();
  const latestMs = existingScheduledAtIso
    .map((iso) => new Date(iso).getTime())
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), nowMs);
  return new Date(latestMs > nowMs ? latestMs + spreadHoursMs : nowMs);
}

/** The free X intent-composer URL used for both the existing manual queue and #344's needs_composer hand-off. */
export function buildXIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/** Waking-hours window (07:00–23:00) that a cadence's default schedule spread fans approvals across, instead of clustering them (issue #358). */
const WAKING_HOURS_MS = 16 * 60 * 60 * 1000;

/** Falls back to the default cadence for any unrecognised or missing stored value (e.g. a pre-#358 record). */
export function normalisePostingCadence(value: unknown): PostingCadence {
  return POSTING_CADENCE_OPTIONS.some((option) => option.id === value) ? (value as PostingCadence) : DEFAULT_POSTING_CADENCE;
}

/** The Ready-to-review replenish target a cadence drives (issue #358) — always that cadence's own daily posting ceiling. */
export function cadenceQueueTarget(cadence: PostingCadence): number {
  return POSTING_CADENCE_OPTIONS.find((option) => option.id === cadence)?.postsPerDayMax ?? DEFAULT_QUEUE_TARGET;
}

/**
 * How many of `scheduledAtIso` fall on the same local calendar day as
 * `now` — the numerator of the design's "TODAY 3/5 posts" pill. Local, not
 * UTC, because the number describes the user's own day; an unparseable
 * timestamp is ignored rather than counted.
 */
export function countPostsScheduledToday(scheduledAtIso: readonly string[], now: Date): number {
  let count = 0;
  for (const iso of scheduledAtIso) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) continue;
    if (
      at.getFullYear() === now.getFullYear() &&
      at.getMonth() === now.getMonth() &&
      at.getDate() === now.getDate()
    ) {
      count += 1;
    }
  }
  return count;
}

/** Default schedule-time spread for a cadence: waking hours divided evenly across its daily posting ceiling, so approvals fan out across the day instead of clustering at "now". */
export function cadenceSpreadHoursMs(cadence: PostingCadence): number {
  return Math.round(WAKING_HOURS_MS / cadenceQueueTarget(cadence));
}

/**
 * Whether `text` is still exactly one of the canned `buildTemplate()`
 * outputs, unedited (issue #380). A single edited character makes this
 * false — the caller supplies the current project's template outputs (one
 * per non-custom TemplateId) since this module has no access to the
 * component's TokenProject/buildTemplate types.
 */
export function isUneditedTemplateText(text: string, templateOutputs: string[]): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return templateOutputs.some((output) => output.trim() === trimmed);
}

/**
 * Guards every wallet-signed Studio action against the wallet identity
 * split behind issue #388: connect/approve/cancel/reschedule sign with
 * whatever account the wallet app currently has active, but every read
 * (connections, posts) is keyed off the wallet confirmed in the Account
 * panel. Signing under a different account than the one reads use makes
 * the server store the row where the Studio will never look for it again.
 * Returns null when there's nothing to compare (no confirmed wallet yet,
 * i.e. before the Account panel has been used) or the accounts already
 * match; otherwise a ready-to-display error naming both addresses, so the
 * caller can bail out before ever requesting a challenge to sign.
 */
export function describeWalletMismatch(activeAccount: string, confirmedAddress: string): string | null {
  if (!confirmedAddress || !activeAccount) return null;
  if (activeAccount.toLowerCase() === confirmedAddress.toLowerCase()) return null;
  return `Your wallet app is on a different account (${truncateAccountAddress(activeAccount)}) than the one confirmed on Hoodlums (${truncateAccountAddress(confirmedAddress)}). Switch accounts in your wallet app, or re-confirm your wallet from the Account panel.`;
}
