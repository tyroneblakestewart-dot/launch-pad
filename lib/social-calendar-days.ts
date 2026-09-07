/**
 * Calendar day markers and the day list (owner direction, 7 Sep 2026: the
 * legend promised lime and grey dots that no code ever drew, and every
 * mobile week card said "No scheduled posts"). Pure and client-safe: reads
 * the approved posts the hub already holds and the Ready-to-review drafts
 * pinned to a day (PR #532's `scheduledDay`), never a second fetch.
 */
import { parseCalendarDayParts, toCalendarDayIso } from "./social-studio-queue";
import { describeTimezone, wallClockIn } from "./social-timezone";

export type CalendarPostLike = { id: string; status: string; scheduledAt: string; body?: string; destinations?: ReadonlyArray<{ platform: string; status: string }> };
export type CalendarDraftLike = { id: string; scheduledDay?: string | null; source?: string; xText?: string; telegramText?: string };

export type CalendarDayMarks = {
  /** Approved and waiting to send (scheduled / needs_composer). */
  scheduled: number;
  /** Already went out (sent / partially_sent). */
  sent: number;
  /** Sent attempt that failed on every destination. */
  failed: number;
  /** Ready-to-review drafts pinned to this day — nothing goes out until approved. */
  drafts: number;
};

const SCHEDULED_STATUSES = new Set(["scheduled", "needs_composer"]);
const SENT_STATUSES = new Set(["sent", "partially_sent"]);

function zonedDayOf(iso: string, timeZone?: string | null): { year: number; month: number; day: number } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const wall = wallClockIn(at, timeZone);
  return { year: wall.year, month: wall.month, day: wall.day };
}

function emptyMarks(): CalendarDayMarks {
  return { scheduled: 0, sent: 0, failed: 0, drafts: 0 };
}

/** Per-day counts for one month (month 0-based, read in `timeZone` — the device's own zone when none is given); days with nothing are absent. Canceled posts never count. */
export function buildCalendarDayMarks(
  posts: readonly CalendarPostLike[],
  drafts: readonly CalendarDraftLike[],
  year: number,
  month: number,
  timeZone?: string | null,
): Map<number, CalendarDayMarks> {
  const marks = new Map<number, CalendarDayMarks>();
  const bump = (day: number, key: keyof CalendarDayMarks) => {
    const current = marks.get(day) ?? emptyMarks();
    current[key] += 1;
    marks.set(day, current);
  };
  for (const post of posts) {
    const zoned = zonedDayOf(post.scheduledAt, timeZone);
    if (!zoned || zoned.year !== year || zoned.month !== month) continue;
    if (SCHEDULED_STATUSES.has(post.status)) bump(zoned.day, "scheduled");
    else if (SENT_STATUSES.has(post.status)) bump(zoned.day, "sent");
    else if (post.status === "failed") bump(zoned.day, "failed");
  }
  for (const draft of drafts) {
    const day = parseCalendarDayParts(draft.scheduledDay);
    if (!day || day.year !== year || day.month !== month) continue;
    bump(day.day, "drafts");
  }
  return marks;
}

/** The mobile week card's one line: "2 scheduled · 1 draft to approve", "Today · nothing yet", "Nothing yet". */
export function describeCalendarDayMarks(marks: CalendarDayMarks | undefined, isToday = false): string {
  const parts: string[] = [];
  if (marks?.scheduled) parts.push(`${marks.scheduled} scheduled`);
  if (marks?.drafts) parts.push(`${marks.drafts} ${marks.drafts === 1 ? "draft" : "drafts"} to approve`);
  if (marks?.sent) parts.push(`${marks.sent} sent`);
  if (marks?.failed) parts.push(`${marks.failed} failed`);
  const summary = parts.length ? parts.join(" · ") : "nothing yet";
  return isToday ? `Today · ${summary}` : summary.charAt(0).toUpperCase() + summary.slice(1);
}

/** The plain label for a pinned draft's origin on the day list and the Queue row. */
export function describeDraftSource(source: string | undefined): string {
  switch (source) {
    case "calendar-ai": return "Calendar AI";
    case "announcement": return "Announcement";
    case "announcement-ai": return "Announcement (AI)";
    case "manual": return "Your own";
    default: return "AI";
  }
}

export type CalendarDayEntry =
  | { kind: "post"; id: string; at: string; timeLabel: string; status: string; platforms: string[]; body: string }
  | { kind: "draft"; id: string; source: string; body: string };

function timeLabel(iso: string, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (timeZone) options.timeZone = timeZone;
  return new Date(iso).toLocaleTimeString(undefined, options);
}

/** Everything the calendar knows about one day, posts first by time then drafts — for the "On this day" list on the schedule card. */
export function listCalendarDayEntries(
  posts: readonly CalendarPostLike[],
  drafts: readonly CalendarDraftLike[],
  year: number,
  month: number,
  day: number,
  timeZone?: string | null,
): CalendarDayEntry[] {
  const dayIso = toCalendarDayIso(year, month, day);
  const postEntries = posts
    .filter((post) => post.status !== "canceled")
    .filter((post) => {
      const zoned = zonedDayOf(post.scheduledAt, timeZone);
      return zoned !== null && toCalendarDayIso(zoned.year, zoned.month, zoned.day) === dayIso;
    })
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .map<CalendarDayEntry>((post) => ({
      kind: "post",
      id: post.id,
      at: post.scheduledAt,
      timeLabel: timeLabel(post.scheduledAt, timeZone),
      status: post.status,
      platforms: (post.destinations ?? []).map((destination) => destination.platform),
      body: post.body ?? "",
    }));
  const draftEntries = drafts
    .filter((draft) => draft.scheduledDay === dayIso)
    .map<CalendarDayEntry>((draft) => ({
      kind: "draft",
      id: draft.id,
      source: draft.source ?? "manual",
      body: draft.xText || draft.telegramText || "",
    }));
  return [...postEntries, ...draftEntries];
}

/**
 * "Europe/London · GMT+1" for the line above the calendar — the browser's
 * own zone by default, or the one the user picked (owner direction, 7 Sep
 * 2026: "what happened to time zones, that needs to come back"). One
 * definition, in `lib/social-timezone.ts`, so the label and the scheduling
 * maths can never name different zones.
 */
export function describeDetectedTimezone(now: Date = new Date(), timeZone?: string | null): string {
  return describeTimezone(timeZone ?? null, now);
}

/** Plain words for a post's status on the day list. */
export function describeCalendarPostStatus(status: string): string {
  switch (status) {
    case "scheduled": return "scheduled";
    case "needs_composer": return "tap to post on X";
    case "sent": return "sent";
    case "partially_sent": return "partly sent";
    case "failed": return "failed";
    case "canceled": return "canceled";
    default: return status;
  }
}
