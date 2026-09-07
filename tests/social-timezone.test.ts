import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  dateFromWallClock,
  describeTimezone,
  detectTimezone,
  effectiveTimezone,
  groupTimezones,
  isSameZonedDay,
  isValidTimezone,
  listTimezones,
  normaliseTimezone,
  wallClockIn,
  zoneOffsetMs,
  zonedMinutesOfDay,
} from "@/lib/social-timezone";
import { isInQuietHours, shiftOutOfQuietHours } from "@/lib/social-quiet-hours";
import {
  calendarDayAtTime,
  computeDefaultScheduledAtOnDay,
  countPostsScheduledToday,
  defaultCalendarClockTime,
  isCalendarDayBeforeToday,
  parseCalendarDayParts,
} from "@/lib/social-studio-queue";
import { buildCalendarDayMarks, listCalendarDayEntries } from "@/lib/social-calendar-days";

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...parts), "utf8");
}

const NY = "America/New_York";
const TOKYO = "Asia/Tokyo";
const LONDON = "Europe/London";

/**
 * Owner direction, 7 Sep 2026: "what happened to time zones, that needs to
 * come back … and have an edit local time tab". The zone is chosen, stored,
 * and every calendar and queue time is computed in it.
 */
describe("the zone itself", () => {
  it("accepts real zones and refuses anything else", () => {
    expect(isValidTimezone(LONDON)).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(isValidTimezone(42)).toBe(false);
  });

  it("stores a valid zone and falls back to the device for anything else — never a wrong clock", () => {
    expect(normaliseTimezone(TOKYO)).toBe(TOKYO);
    expect(normaliseTimezone("Not/AZone")).toBeNull();
    expect(normaliseTimezone(undefined)).toBeNull();
    expect(normaliseTimezone({ zone: LONDON })).toBeNull();
    expect(effectiveTimezone(TOKYO)).toBe(TOKYO);
    expect(effectiveTimezone(null)).toBe(detectTimezone());
    expect(effectiveTimezone("Not/AZone")).toBe(detectTimezone());
  });

  it("names the zone with its current offset, following daylight saving", () => {
    expect(describeTimezone(LONDON, new Date("2026-09-07T10:00:00Z"))).toBe("Europe/London · GMT+1");
    expect(describeTimezone(LONDON, new Date("2026-12-07T10:00:00Z"))).toBe("Europe/London · GMT+0");
    expect(describeTimezone(NY, new Date("2026-09-07T10:00:00Z"))).toBe("America/New_York · GMT-4");
  });

  it("lists zones, keeps the ones already in play, and groups them by region", () => {
    const zones = listTimezones(TOKYO, LONDON);
    expect(zones).toContain(TOKYO);
    expect(zones).toContain(LONDON);
    expect(zones.length).toBeGreaterThan(20);
    expect([...zones]).toEqual([...zones].sort((a, b) => a.localeCompare(b)));
    // An unknown name is never offered as a choice.
    expect(listTimezones("Not/AZone")).not.toContain("Not/AZone");
    const groups = groupTimezones(["Europe/London", "Asia/Tokyo", "Europe/Berlin", "UTC"]);
    expect(groups.map((group) => group.region)).toEqual(["Asia", "Europe", "Other"]);
    expect(groups.find((group) => group.region === "Europe")?.zones).toEqual(["Europe/Berlin", "Europe/London"]);
  });

  it("reads a wall clock in the zone, and the instant back from it", () => {
    // 09:30 in Tokyo on 7 September 2026 is 00:30 UTC.
    const instant = dateFromWallClock({ year: 2026, month: 8, day: 7, hour: 9, minute: 30 }, TOKYO);
    expect(instant.toISOString()).toBe("2026-09-07T00:30:00.000Z");
    expect(wallClockIn(instant, TOKYO)).toEqual({ year: 2026, month: 8, day: 7, hour: 9, minute: 30 });
    // The same instant is the day before in New York.
    expect(wallClockIn(instant, NY)).toEqual({ year: 2026, month: 8, day: 6, hour: 20, minute: 30 });
    expect(zonedMinutesOfDay(instant, NY)).toBe(20 * 60 + 30);
  });

  it("round-trips every wall clock it is given, across a daylight-saving change", () => {
    for (const zone of [LONDON, NY, TOKYO, "Australia/Sydney"]) {
      for (const [month, day] of [[2, 29], [5, 15], [9, 25], [11, 20]] as const) {
        for (const hour of [0, 3, 9, 14, 23]) {
          const wall = { year: 2026, month, day, hour, minute: 45 };
          const back = wallClockIn(dateFromWallClock(wall, zone), zone);
          // A wall clock the zone genuinely skips (the spring-forward hour) is
          // the one case that cannot round-trip; everything else must.
          if (back.hour !== hour) {
            expect(Math.abs(back.hour - hour)).toBe(1);
            continue;
          }
          expect(back).toEqual(wall);
        }
      }
    }
  });

  it("reports the zone's offset at an instant, on both sides of a daylight-saving change", () => {
    expect(zoneOffsetMs(LONDON, Date.parse("2026-07-01T12:00:00Z"))).toBe(60 * 60 * 1000);
    expect(zoneOffsetMs(LONDON, Date.parse("2026-01-01T12:00:00Z"))).toBe(0);
    expect(zoneOffsetMs(NY, Date.parse("2026-07-01T12:00:00Z"))).toBe(-4 * 60 * 60 * 1000);
    expect(zoneOffsetMs(TOKYO, Date.parse("2026-07-01T12:00:00Z"))).toBe(9 * 60 * 60 * 1000);
  });

  it("compares days on the chosen zone's own clock", () => {
    const late = new Date("2026-09-07T23:30:00Z");
    const justAfter = new Date("2026-09-08T00:30:00Z");
    expect(isSameZonedDay(late, justAfter, "UTC")).toBe(false);
    expect(isSameZonedDay(late, justAfter, TOKYO)).toBe(true);
    expect(isSameZonedDay(late, justAfter, NY)).toBe(true);
  });

  it("falls back to the device clock when no zone is given, exactly as before", () => {
    const at = new Date("2026-09-07T10:15:00Z");
    expect(wallClockIn(at)).toEqual({ year: at.getFullYear(), month: at.getMonth(), day: at.getDate(), hour: at.getHours(), minute: at.getMinutes() });
    expect(dateFromWallClock({ year: 2026, month: 8, day: 7, hour: 9, minute: 30 }).getTime()).toBe(new Date(2026, 8, 7, 9, 30, 0, 0).getTime());
  });
});

describe("scheduling in the chosen zone", () => {
  it("places a calendar day and time at that clock in the zone", () => {
    expect(calendarDayAtTime("2026-09-14", "18:30", TOKYO)?.toISOString()).toBe("2026-09-14T09:30:00.000Z");
    expect(calendarDayAtTime("2026-09-14", "18:30", NY)?.toISOString()).toBe("2026-09-14T22:30:00.000Z");
    expect(calendarDayAtTime("2026-09-14", "nonsense", TOKYO)).toBeNull();
    expect(calendarDayAtTime("not-a-day", "18:30", TOKYO)).toBeNull();
    expect(parseCalendarDayParts("2026-02-30")).toBeNull();
    expect(parseCalendarDayParts("2026-09-14")).toEqual({ year: 2026, month: 8, day: 14 });
  });

  it("counts today's posts on the chosen zone's day, not the device's", () => {
    const iso = ["2026-09-07T23:30:00Z"];
    const now = new Date("2026-09-07T10:00:00Z");
    expect(countPostsScheduledToday(iso, now, "UTC")).toBe(1);
    // In Tokyo "now" is the evening of the 7th and that post is the morning of the 8th.
    expect(countPostsScheduledToday(iso, now, TOKYO)).toBe(0);
  });

  it("knows which day is already gone on the chosen zone's clock", () => {
    // 03:00 UTC on the 8th is still the 7th in New York.
    const now = new Date("2026-09-08T03:00:00Z");
    expect(isCalendarDayBeforeToday("2026-09-07", now, "UTC")).toBe(true);
    expect(isCalendarDayBeforeToday("2026-09-07", now, NY)).toBe(false);
    expect(isCalendarDayBeforeToday("2026-09-09", now, "UTC")).toBe(false);
  });

  it("defaults the calendar 'at' time from the zone's own clock", () => {
    // 10:00 UTC is 19:00 in Tokyo, so today's first waking slot has passed
    // there (the default becomes the next quarter hour) but not in New York.
    const now = new Date("2026-09-07T10:00:00Z");
    expect(defaultCalendarClockTime("2026-09-07", now, TOKYO)).toBe("19:15");
    expect(defaultCalendarClockTime("2026-09-07", now, NY)).toBe("07:00");
    expect(defaultCalendarClockTime("2026-09-14", now, TOKYO)).toBe("07:00");
  });

  it("places a calendar-day draft in the zone's waking window", () => {
    const now = new Date("2026-09-07T10:00:00Z");
    const spread = 3 * 60 * 60 * 1000;
    // 07:00 on the 14th in Tokyo is 22:00 UTC on the 13th.
    expect(computeDefaultScheduledAtOnDay("2026-09-14", [], now, spread, TOKYO)?.toISOString()).toBe("2026-09-13T22:00:00.000Z");
    expect(computeDefaultScheduledAtOnDay("2026-09-14", [], now, spread, NY)?.toISOString()).toBe("2026-09-14T11:00:00.000Z");
    // A post already pending that day pushes the next one one spread on, still in the zone.
    expect(
      computeDefaultScheduledAtOnDay("2026-09-14", ["2026-09-13T22:00:00.000Z"], now, spread, TOKYO)?.toISOString(),
    ).toBe("2026-09-14T01:00:00.000Z");
  });

  it("reads quiet hours on the zone's clock and moves a post to the window's end there", () => {
    const quiet = { start: "23:00", end: "07:00" };
    const at = new Date("2026-09-14T15:00:00Z"); // 00:00 in Tokyo, 11:00 in New York
    expect(isInQuietHours(at, quiet, TOKYO)).toBe(true);
    expect(isInQuietHours(at, quiet, NY)).toBe(false);
    // Tokyo's 07:00 on the 15th is 22:00 UTC on the 14th.
    expect(shiftOutOfQuietHours(at, quiet, TOKYO).toISOString()).toBe("2026-09-14T22:00:00.000Z");
    expect(shiftOutOfQuietHours(at, quiet, NY)).toBe(at);
  });

  it("marks calendar days and lists a day's posts on the zone's clock", () => {
    const posts = [{ id: "p1", status: "scheduled", scheduledAt: "2026-09-07T23:30:00Z", destinations: [{ platform: "telegram", status: "pending" }] }];
    expect(buildCalendarDayMarks(posts, [], 2026, 8, "UTC").get(7)?.scheduled).toBe(1);
    // The same post is the 8th in Tokyo.
    expect(buildCalendarDayMarks(posts, [], 2026, 8, TOKYO).get(7)).toBeUndefined();
    expect(buildCalendarDayMarks(posts, [], 2026, 8, TOKYO).get(8)?.scheduled).toBe(1);
    expect(listCalendarDayEntries(posts, [], 2026, 8, 8, TOKYO)).toHaveLength(1);
    expect(listCalendarDayEntries(posts, [], 2026, 8, 8, TOKYO)[0]?.kind === "post" ? listCalendarDayEntries(posts, [], 2026, 8, 8, TOKYO)[0].timeLabel : "").toContain("8:30");
    expect(listCalendarDayEntries(posts, [], 2026, 8, 7, TOKYO)).toHaveLength(0);
  });
});

describe("the picker and what it changes", () => {
  it("stores the zone on the project record, migrating an older record to the device", async () => {
    const types = await source("lib", "social-studio-types.ts");
    expect(types).toContain("timezone: string | null;");
    expect(types).toContain("timezone: null,");
    const db = await source("lib", "social-studio-db.ts");
    expect(db).toContain("timezone: normaliseTimezone(merged.timezone),");
  });

  it("renders an edit control that saves at once, and never a fixed-offset list", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('const [timezone, setTimezone] = useState<string | null>(null);');
    expect(hub).toContain("setTimezone(record.timezone);");
    expect(hub).toContain("function updateTimezone(next: string) {");
    expect(hub).toContain("persistSocialStudio({ timezone: chosen });");
    expect(hub).toContain('{timezone ? "Change" : "Edit local time"}');
    expect(hub).toContain('<option value="">Follow this device{deviceTimezone ? ` · ${deviceTimezone}` : ""}</option>');
    expect(hub).toContain("onChange={(event) => updateTimezone(event.target.value)}");
    // The options are built only when the picker is open.
    expect(hub).toContain("timezoneEditing ? groupTimezones(listTimezones(timezone, deviceTimezone)) : []");
  });

  it("shows and reads the schedule pickers in the chosen zone", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("function toDateTimeLocalValue(date: Date, timeZone?: string | null): string {");
    expect(hub).toContain("function fromDateTimeLocalValue(value: string, timeZone?: string | null): Date {");
    expect(hub).toContain("? fromDateTimeLocalValue(itemScheduledAt[item.id], timezone)");
    expect(hub).toContain("function formatScheduledAt(iso: string, timeZone?: string | null): string {");
  });

  it("treats 'today' on the calendar as today in the chosen zone", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("const todayInZone = wallClockIn(new Date(), timezone);");
    expect(hub).toContain("const isCurrentMonthView = calendarView.year === todayInZone.year && calendarView.month === todayInZone.month;");
    expect(hub).toContain("const isToday = day !== null && isCurrentMonthView && day === todayInZone.day;");
    expect(hub).toContain("setCalendarView({ year: todayInZone.year, month: todayInZone.month });");
  });

  it("gives the control a 44px touch target", async () => {
    const css = await source("components", "social-hub.module.css");
    expect(css).toContain(".timezoneEdit {");
    expect(css).toContain("  .timezoneEdit,\n  .timezoneControl select,");
  });
});
