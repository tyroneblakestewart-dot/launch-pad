// Pure, unit-testable logic behind the Social Studio Queue tab (issue #352):
// classifying scheduled posts into "approved & scheduled" vs "history",
// working out which destinations a draft may be approved to, spreading
// default schedule times, and sizing the client-side auto-replenish loop.
// Kept dependency-free of components/social-hub.tsx so it can be tested
// directly instead of only through source-string assertions.

import { truncateAccountAddress } from "@/lib/account-wallet-state";
import { formatClockTime, parseClockTime } from "@/lib/social-quiet-hours";
import { dateFromWallClock, isSameZonedDay, wallClockIn } from "@/lib/social-timezone";
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

/**
 * Where a one-tap approval goes (owner direction, 6 Sep 2026: no destination
 * toggles — the X and Telegram fields already say it): every connected
 * platform whose field carries text. An empty field means "not this one".
 */
export function approvalDestinations(
  item: { xText: string; telegramText: string },
  connected: readonly SocialPlatform[],
): SocialPlatform[] {
  return connected.filter((platform) => (platform === "x" ? item.xText : item.telegramText).trim().length > 0);
}

/** A post approved at 17:41 must never be scheduled for 17:40 (owner report, 6 Sep 2026): anything earlier than now + lead is moved to now + lead. */
export const MIN_SCHEDULE_LEAD_MS = 2 * 60 * 1000;

export function ensureFutureScheduledAt(candidate: Date, now: Date, minLeadMs = MIN_SCHEDULE_LEAD_MS): Date {
  const floor = now.getTime() + minLeadMs;
  const value = candidate.getTime();
  return Number.isFinite(value) && value >= floor ? candidate : new Date(floor);
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
export function countPostsScheduledToday(scheduledAtIso: readonly string[], now: Date, timeZone?: string | null): number {
  let count = 0;
  for (const iso of scheduledAtIso) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) continue;
    if (isSameZonedDay(at, now, timeZone)) count += 1;
  }
  return count;
}

/** Default schedule-time spread for a cadence: waking hours divided evenly across its daily posting ceiling, so approvals fan out across the day instead of clustering at "now". */
export function cadenceSpreadHoursMs(cadence: PostingCadence): number {
  return Math.round(WAKING_HOURS_MS / cadenceQueueTarget(cadence));
}

/** First and last hour (local time) a calendar-day draft is placed at — the same 07:00–23:00 waking window the cadence spread fans across. */
export const CALENDAR_DAY_FIRST_SLOT_HOUR = 7;
export const CALENDAR_DAY_LAST_SLOT_HOUR = 23;

/** A local calendar day as "YYYY-MM-DD" — the form `QueueItem.scheduledDay` carries (month is 0-based, like `Date`). */
export function toCalendarDayIso(year: number, month: number, day: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** The calendar-day parts of "YYYY-MM-DD", or null for anything that is not exactly a real calendar day. */
export function parseCalendarDayParts(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Parses "YYYY-MM-DD" into the midnight Date of that day in `timeZone` (the device's own zone when none is given), or null for anything that is not exactly a real calendar day. */
export function parseCalendarDayIso(value: unknown, timeZone?: string | null): Date | null {
  const parts = parseCalendarDayParts(value);
  if (!parts) return null;
  return dateFromWallClock({ ...parts, hour: 0, minute: 0 }, timeZone);
}

/** The instant a clock in `timeZone` reads this calendar day ("YYYY-MM-DD") at this clock time ("HH:MM"), or null when either is not well-formed. */
export function calendarDayAtTime(dayIso: string, clock: string, timeZone?: string | null): Date | null {
  const day = parseCalendarDayParts(dayIso);
  const minutes = parseClockTime(clock);
  if (!day || minutes === null) return null;
  return dateFromWallClock({ ...day, hour: Math.floor(minutes / 60), minute: minutes % 60 }, timeZone);
}

/**
 * The Calendar card's default "at" time for a day: the first waking slot,
 * or — when the day is today and that slot has passed — the next quarter
 * hour after now, so the default is never already in the past.
 */
export function defaultCalendarClockTime(dayIso: string, now: Date, timeZone?: string | null): string {
  const day = parseCalendarDayParts(dayIso);
  const firstSlot = CALENDAR_DAY_FIRST_SLOT_HOUR * 60;
  if (!day) return formatClockTime(firstSlot);
  const today = wallClockIn(now, timeZone);
  const isToday = day.year === today.year && day.month === today.month && day.day === today.day;
  const nowMinutes = today.hour * 60 + today.minute;
  if (!isToday || nowMinutes < firstSlot) return formatClockTime(firstSlot);
  const nextQuarter = Math.min(Math.ceil((nowMinutes + 1) / 15) * 15, 23 * 60 + 45);
  return formatClockTime(nextQuarter);
}

/** True when the calendar day is strictly before `now`'s day in `timeZone` — a day nothing can be scheduled on any more. */
export function isCalendarDayBeforeToday(dayIso: string, now: Date, timeZone?: string | null): boolean {
  const day = parseCalendarDayParts(dayIso);
  if (!day) return false;
  const today = wallClockIn(now, timeZone);
  const dayKey = day.year * 10000 + day.month * 100 + day.day;
  return dayKey < today.year * 10000 + today.month * 100 + today.day;
}

/**
 * The default time for a draft the user pinned to a calendar day: ON THAT
 * DAY, never the cadence spread from "now" (owner test, 7 Sep 2026: an
 * "AI makes it" draft for the 14th defaulted to today). Starts at the first
 * waking slot (07:00 local) — or now, if the day is today and 07:00 has
 * passed — and steps one cadence spread past the latest post already
 * pending on that same day, so two calendar drafts for one day fan out
 * like approvals do. Never leaves the day: once the day's waking window is
 * full the last slot (23:00) is reused rather than spilling into the next
 * day the user did not pick. Returns null for a day that is not a real
 * calendar day, so the caller can fall back to the cadence default; a day
 * already in the past yields a time on that day, which the existing
 * approval clamp then lifts to "at least two minutes from now".
 */
export function computeDefaultScheduledAtOnDay(
  dayIso: string,
  existingScheduledAtIso: readonly string[],
  now: Date,
  spreadHoursMs: number,
  timeZone?: string | null,
): Date | null {
  const day = parseCalendarDayParts(dayIso);
  if (!day) return null;
  const atHour = (hour: number, dayOffset = 0) =>
    dateFromWallClock({ year: day.year, month: day.month, day: day.day + dayOffset, hour, minute: 0 }, timeZone).getTime();
  const firstSlotMs = atHour(CALENDAR_DAY_FIRST_SLOT_HOUR);
  const lastSlotMs = atHour(CALENDAR_DAY_LAST_SLOT_HOUR);
  const dayStartMs = atHour(0);
  const dayEndMs = atHour(0, 1);
  const latestOnDayMs = existingScheduledAtIso
    .map((iso) => new Date(iso).getTime())
    .filter((value) => Number.isFinite(value) && value >= dayStartMs && value < dayEndMs)
    .reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  const isToday = now.getTime() >= dayStartMs && now.getTime() < dayEndMs;
  let candidateMs = Math.max(firstSlotMs, isToday ? now.getTime() : Number.NEGATIVE_INFINITY);
  if (Number.isFinite(latestOnDayMs)) candidateMs = Math.max(candidateMs, latestOnDayMs + spreadHoursMs);
  // Late on the day itself, "now" is the honest floor even past the last slot (the approval clamp adds its two minutes).
  const capMs = Math.max(lastSlotMs, isToday ? now.getTime() : Number.NEGATIVE_INFINITY);
  return new Date(Math.min(candidateMs, capMs));
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

/**
 * The header badge's text, from the plan the project-slots read reports —
 * "PRO BUNDLE · 3 TOKENS" / "PRO · 1 TOKEN" as the design draws it. Until
 * that read has answered (or when it cannot name a plan) the badge falls back
 * to the product name rather than guessing a tier.
 */
export function describePlanBadge(
  slotUsage: { plan: "pro" | "pro-bundle" | null; limit: number | null; unlimited: boolean } | null,
): string {
  if (!slotUsage || !slotUsage.plan) return "PRO · AI SOCIAL STUDIO";
  const tier = slotUsage.plan === "pro-bundle" ? "PRO BUNDLE" : "PRO";
  if (slotUsage.unlimited || slotUsage.limit === null) return tier;
  return `${tier} · ${slotUsage.limit} ${slotUsage.limit === 1 ? "TOKEN" : "TOKENS"}`;
}
