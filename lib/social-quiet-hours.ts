/**
 * Quiet hours for Social Studio posting (owner direction, 7 Sep 2026: wire
 * the Calendar tab's unbuilt controls). A per-project window, in the
 * user's own local time, inside which nothing is ever scheduled: every
 * send happens at a time decided at approval, so keeping approval out of
 * the window keeps the night quiet without any server-side rule. The
 * window may wrap midnight (23:00 → 07:00, the design's default) or not
 * (01:00 → 05:00); a start equal to its end is no window at all.
 *
 * Bounds are "HH:MM" clock strings — what a native time field speaks — so
 * the phone's wheel picker can set 22:30 and mean it (owner direction,
 * 7 Sep 2026: "time panels need to be better, too long on desktop, mobile
 * can have a touch roller"). Records saved with the first shape
 * (`{ startHour, endHour }`) are read as whole hours.
 */
import { dateFromWallClock, wallClockIn } from "@/lib/social-timezone";

export type QuietHours = { start: string; end: string };

/** The design's mock-up always showed 23:00 → 07:00, so a record saved before the field existed gets exactly that. */
export const DEFAULT_QUIET_HOURS: QuietHours = { start: "23:00", end: "07:00" };

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes since local midnight for "HH:MM", or null for anything else. */
export function parseClockTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = CLOCK_TIME.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** "HH:MM" for minutes since midnight (wrapped into one day). */
export function formatClockTime(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function isHour(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;
}

/**
 * `null` is an explicit "off"; a missing or corrupt value falls back to the
 * default window; a window whose start equals its end is off too. The
 * first shape (`{ startHour, endHour }`, whole hours) is read as well.
 */
export function normaliseQuietHours(raw: unknown): QuietHours | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_QUIET_HOURS };
  const candidate = raw as Partial<QuietHours> & { startHour?: unknown; endHour?: unknown };
  let start = parseClockTime(candidate.start);
  let end = parseClockTime(candidate.end);
  if (start === null && end === null && isHour(candidate.startHour) && isHour(candidate.endHour)) {
    start = candidate.startHour * 60;
    end = candidate.endHour * 60;
  }
  if (start === null || end === null) return { ...DEFAULT_QUIET_HOURS };
  if (start === end) return null;
  return { start: formatClockTime(start), end: formatClockTime(end) };
}

/** Whether the wall-clock time of `date` falls inside the window (start inclusive, end exclusive), read in `timeZone` — the device's own clock when none is given. */
export function isInQuietHours(date: Date, quiet: QuietHours | null, timeZone?: string | null): boolean {
  if (!quiet) return false;
  const start = parseClockTime(quiet.start);
  const end = parseClockTime(quiet.end);
  if (start === null || end === null || start === end) return false;
  const wall = wallClockIn(date, timeZone);
  const minutes = wall.hour * 60 + wall.minute;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * The same instant when it is outside the window, else the window's end
 * on the day that end falls — the next morning for a window that wraps
 * midnight and a time after the start, the same morning for a time
 * already past midnight.
 */
export function shiftOutOfQuietHours(date: Date, quiet: QuietHours | null, timeZone?: string | null): Date {
  if (!quiet || !isInQuietHours(date, quiet, timeZone)) return date;
  const start = parseClockTime(quiet.start) ?? 0;
  const end = parseClockTime(quiet.end) ?? 0;
  const wall = wallClockIn(date, timeZone);
  const minutes = wall.hour * 60 + wall.minute;
  const wraps = start > end;
  const dayOffset = wraps && minutes >= start ? 1 : 0;
  return dateFromWallClock(
    { year: wall.year, month: wall.month, day: wall.day + dayOffset, hour: Math.floor(end / 60), minute: end % 60 },
    timeZone,
  );
}

/** "23:00 and 07:00" for the "Never post between … and …" sentence, or null when off. */
export function describeQuietHours(quiet: QuietHours | null): string | null {
  return quiet ? `${quiet.start} and ${quiet.end}` : null;
}
