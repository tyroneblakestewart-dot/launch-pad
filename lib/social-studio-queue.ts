// Pure, unit-testable logic behind the Social Studio Queue tab (issue #352):
// classifying scheduled posts into "approved & scheduled" vs "history",
// working out which destinations a draft may be approved to, spreading
// default schedule times, and sizing the client-side auto-replenish loop.
// Kept dependency-free of components/social-hub.tsx so it can be tested
// directly instead of only through source-string assertions.

import { DEFAULT_QUEUE_TARGET, MAX_QUEUE_TARGET, type SocialPlatform } from "@/lib/social-studio-types";

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

/** Clamps a user-entered Settings & Rules target into [1, MAX_QUEUE_TARGET], falling back to the default for non-finite input. */
export function clampQueueTarget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_QUEUE_TARGET;
  return Math.min(MAX_QUEUE_TARGET, Math.max(1, Math.round(value)));
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
