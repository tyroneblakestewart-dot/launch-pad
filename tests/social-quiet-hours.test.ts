import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUIET_HOURS,
  describeQuietHours,
  formatClockTime,
  isInQuietHours,
  normaliseQuietHours,
  parseClockTime,
  shiftOutOfQuietHours,
} from "@/lib/social-quiet-hours";

const local = (h: number, min = 0, day = 14) => new Date(2026, 8, day, h, min);

describe("Calendar quiet hours (owner direction, 7 Sep 2026; minutes since the time-field change the same day)", () => {
  it("defaults to the design's 23:00 → 07:00 as clock strings", () => {
    expect(DEFAULT_QUIET_HOURS).toEqual({ start: "23:00", end: "07:00" });
    expect(describeQuietHours(DEFAULT_QUIET_HOURS)).toBe("23:00 and 07:00");
    expect(describeQuietHours(null)).toBeNull();
  });

  it("parses and formats HH:MM strictly", () => {
    expect(parseClockTime("00:00")).toBe(0);
    expect(parseClockTime("22:30")).toBe(1350);
    expect(parseClockTime("23:59")).toBe(1439);
    expect(parseClockTime("24:00")).toBeNull();
    expect(parseClockTime("7:00")).toBeNull();
    expect(parseClockTime("07:60")).toBeNull();
    expect(parseClockTime("")).toBeNull();
    expect(parseClockTime(7)).toBeNull();
    expect(formatClockTime(1350)).toBe("22:30");
    expect(formatClockTime(0)).toBe("00:00");
    expect(formatClockTime(1440 + 30)).toBe("00:30");
  });

  it("normalises: missing or corrupt → default, explicit null → off, equal bounds → off, valid → kept, the first whole-hour shape read as hours", () => {
    expect(normaliseQuietHours(undefined)).toEqual(DEFAULT_QUIET_HOURS);
    expect(normaliseQuietHours("late")).toEqual(DEFAULT_QUIET_HOURS);
    expect(normaliseQuietHours({ start: "25:00", end: "07:00" })).toEqual(DEFAULT_QUIET_HOURS);
    expect(normaliseQuietHours({ startHour: 25, endHour: 7 })).toEqual(DEFAULT_QUIET_HOURS);
    expect(normaliseQuietHours({ startHour: 1.5, endHour: 7 })).toEqual(DEFAULT_QUIET_HOURS);
    expect(normaliseQuietHours(null)).toBeNull();
    expect(normaliseQuietHours({ start: "09:00", end: "09:00" })).toBeNull();
    expect(normaliseQuietHours({ startHour: 9, endHour: 9 })).toBeNull();
    expect(normaliseQuietHours({ start: "01:15", end: "05:45" })).toEqual({ start: "01:15", end: "05:45" });
    // A record saved between the two Calendar PRs on 7 Sep carried whole hours.
    expect(normaliseQuietHours({ startHour: 22, endHour: 8 })).toEqual({ start: "22:00", end: "08:00" });
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

  it("knows a same-day window and honours minutes (01:15 → 05:45)", () => {
    const q = { start: "01:15", end: "05:45" };
    expect(isInQuietHours(local(1, 14), q)).toBe(false);
    expect(isInQuietHours(local(1, 15), q)).toBe(true);
    expect(isInQuietHours(local(5, 44), q)).toBe(true);
    expect(isInQuietHours(local(5, 45), q)).toBe(false);
    expect(isInQuietHours(local(23), q)).toBe(false);
  });

  it("moves a time inside the window to the window's end on the right day, and leaves every other time alone", () => {
    const q = DEFAULT_QUIET_HOURS;
    expect(shiftOutOfQuietHours(local(23, 30, 14), q).getTime()).toBe(local(7, 0, 15).getTime());
    expect(shiftOutOfQuietHours(local(2, 15, 15), q).getTime()).toBe(local(7, 0, 15).getTime());
    const noon = local(12);
    expect(shiftOutOfQuietHours(noon, q)).toBe(noon);
    expect(shiftOutOfQuietHours(local(3), null).getTime()).toBe(local(3).getTime());
    expect(shiftOutOfQuietHours(local(3, 0, 14), { start: "01:15", end: "05:45" }).getTime()).toBe(local(5, 45, 14).getTime());
    // A wheel-picked half-hour end lands exactly there.
    expect(shiftOutOfQuietHours(local(23, 50, 14), { start: "22:30", end: "07:30" }).getTime()).toBe(local(7, 30, 15).getTime());
  });

  it("the shifted time is itself outside the window, so shifting twice changes nothing", () => {
    for (const q of [DEFAULT_QUIET_HOURS, { start: "01:15", end: "05:45" }, { start: "20:30", end: "06:10" }]) {
      for (let minutes = 0; minutes < 1440; minutes += 7) {
        const once = shiftOutOfQuietHours(local(Math.floor(minutes / 60), minutes % 60), q);
        expect(isInQuietHours(once, q)).toBe(false);
        expect(shiftOutOfQuietHours(once, q).getTime()).toBe(once.getTime());
      }
    }
  });
});
