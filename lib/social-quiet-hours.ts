/**
 * Quiet hours for Social Studio posting (owner direction, 7 Sep 2026: wire
 * the Calendar tab's unbuilt controls). A per-project window, in the
 * user's own local time, inside which nothing is ever scheduled: every
 * send happens at a time decided at approval, so keeping approval out of
 * the window keeps the night quiet without any server-side rule. The
 * window may wrap midnight (23:00 → 07:00, the design's default) or not
 * (01:00 → 05:00); a start equal to its end is no window at all.
 */
export type QuietHours = { startHour: number; endHour: number };

/** The design's mock-up always showed 23:00 → 07:00, so a record saved before the field existed gets exactly that. */
export const DEFAULT_QUIET_HOURS: QuietHours = { startHour: 23, endHour: 7 };

export const QUIET_HOUR_OPTIONS: readonly number[] = Array.from({ length: 24 }, (_, hour) => hour);

function isHour(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;
}

/**
 * `null` is an explicit "off"; a missing or corrupt value falls back to the
 * default window; a window whose start equals its end is off too.
 */
export function normaliseQuietHours(raw: unknown): QuietHours | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_QUIET_HOURS };
  const candidate = raw as Partial<QuietHours>;
  if (!isHour(candidate.startHour) || !isHour(candidate.endHour)) return { ...DEFAULT_QUIET_HOURS };
  if (candidate.startHour === candidate.endHour) return null;
  return { startHour: candidate.startHour, endHour: candidate.endHour };
}

/** "23:00" */
export function formatQuietHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Whether the local wall-clock time of `date` falls inside the window (start inclusive, end exclusive). */
export function isInQuietHours(date: Date, quiet: QuietHours | null): boolean {
  if (!quiet) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  const start = quiet.startHour * 60;
  const end = quiet.endHour * 60;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * The same instant when it is outside the window, else the window's end
 * (endHour:00 local) on the day that end falls — the next morning for a
 * window that wraps midnight and a time after the start, the same morning
 * for a time already past midnight.
 */
export function shiftOutOfQuietHours(date: Date, quiet: QuietHours | null): Date {
  if (!quiet || !isInQuietHours(date, quiet)) return date;
  const wraps = quiet.startHour > quiet.endHour;
  const afterStart = date.getHours() >= quiet.startHour;
  const dayOffset = wraps && afterStart ? 1 : 0;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset, quiet.endHour, 0, 0, 0);
}

/** "23:00 and 07:00" for the "Never post between … and …" sentence, or null when off. */
export function describeQuietHours(quiet: QuietHours | null): string | null {
  return quiet ? `${formatQuietHour(quiet.startHour)} and ${formatQuietHour(quiet.endHour)}` : null;
}
