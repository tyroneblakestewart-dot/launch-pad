import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUIET_HOURS,
  QUIET_HOUR_OPTIONS,
  describeQuietHours,
  formatQuietHour,
  isInQuietHours,
  normaliseQuietHours,
  shiftOutOfQuietHours,
} from "@/lib/social-quiet-hours";

const local = (h: number, min = 0, day = 14) => new Date(2026, 8, day, h, min);

describe("Calendar quiet hours (owner direction, 7 Sep 2026)", () => {
  it("defaults to the design's 23:00 → 07:00 and offers every hour", () => {
    expect(DEFAULT_QUIET_HOURS).toEqual({ startHour: 23, endHour: 7 });
    expect(QUIET_HOUR_OPTIONS).toHaveLength(24);
    expect(formatQuietHour(7)).toBe("07:00");
    expect(formatQuietHour(23)).toBe("23:00");
    expect(describeQuietHours(DEFAULT_QUIET_HOURS)).toBe("23:00 and 07:00");
    expect(describeQuietHours(null)).toBeNull();
  });

  it("normalises: missing or corrupt → default, explicit null → off, equal bounds → off, valid → kept", () => {
    expect(normaliseQuietHours(undefined)).toEqual(DEFAULT_QUIET_HOURS);
    expect(normaliseQuietHours("late")).toEqual(DEFAULT_QUIET_HOURS);
    expect(normaliseQuietHours({ startHour: 25, endHour: 7 })).toEqual(DEFAULT_QUIET_HOURS);
    expect(normaliseQuietHours({ startHour: 1.5, endHour: 7 })).toEqual(DEFAULT_QUIET_HOURS);
    expect(normaliseQuietHours(null)).toBeNull();
    expect(normaliseQuietHours({ startHour: 9, endHour: 9 })).toBeNull();
    expect(normaliseQuietHours({ startHour: 1, endHour: 5 })).toEqual({ startHour: 1, endHour: 5 });
  });

  it("knows a wrapping window (23:00 → 07:00): start inclusive, end exclusive", () => {
    const q = DEFAULT_QUIET_HOURS;
    expect(isInQuietHours(local(23, 0), q)).toBe(true);
    expect(isInQuietHours(local(2, 30), q)).toBe(true);
    expect(isInQuietHours(local(6, 59), q)).toBe(true);
    expect(isInQuietHours(local(7, 0), q)).toBe(false);
    expect(isInQuietHours(local(22, 59), q)).toBe(false);
    expect(isInQuietHours(local(12), q)).toBe(false);
    expect(isInQuietHours(local(3), null)).toBe(false);
  });

  it("knows a same-day window (01:00 → 05:00)", () => {
    const q = { startHour: 1, endHour: 5 };
    expect(isInQuietHours(local(1, 0), q)).toBe(true);
    expect(isInQuietHours(local(4, 59), q)).toBe(true);
    expect(isInQuietHours(local(5, 0), q)).toBe(false);
    expect(isInQuietHours(local(23), q)).toBe(false);
  });

  it("moves a time inside the window to the window's end on the right day, and leaves every other time alone", () => {
    const q = DEFAULT_QUIET_HOURS;
    // After the start, same evening → next morning's end.
    expect(shiftOutOfQuietHours(local(23, 30, 14), q).getTime()).toBe(local(7, 0, 15).getTime());
    // Past midnight → that same morning's end.
    expect(shiftOutOfQuietHours(local(2, 15, 15), q).getTime()).toBe(local(7, 0, 15).getTime());
    // Outside the window → untouched, same instance.
    const noon = local(12);
    expect(shiftOutOfQuietHours(noon, q)).toBe(noon);
    expect(shiftOutOfQuietHours(local(3), null).getTime()).toBe(local(3).getTime());
    // Same-day window never changes the day.
    expect(shiftOutOfQuietHours(local(3, 0, 14), { startHour: 1, endHour: 5 }).getTime()).toBe(local(5, 0, 14).getTime());
  });

  it("the shifted time is itself outside the window, so shifting twice changes nothing", () => {
    for (const q of [DEFAULT_QUIET_HOURS, { startHour: 1, endHour: 5 }, { startHour: 20, endHour: 6 }]) {
      for (let hour = 0; hour < 24; hour += 1) {
        const once = shiftOutOfQuietHours(local(hour, 17), q);
        expect(isInQuietHours(once, q)).toBe(false);
        expect(shiftOutOfQuietHours(once, q).getTime()).toBe(once.getTime());
      }
    }
  });
});
