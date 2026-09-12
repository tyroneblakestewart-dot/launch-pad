import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  dateFromWallClock,
  describeTimezone,
  detectTimezone,
  effectiveTimezone,
  isSameZonedDay,
  isValidTimezone,
  listTimezones,
  normaliseTimezone,
  searchTimezones,
  buildTimezoneOptions,
  suggestedTimezones,
  timezoneOffsetLabel,
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

  it("lists zones and keeps the ones already in play", () => {
    const zones = listTimezones(TOKYO, LONDON);
    expect(zones).toContain(TOKYO);
    expect(zones).toContain(LONDON);
    expect(zones.length).toBeGreaterThan(20);
    expect([...zones]).toEqual([...zones].sort((a, b) => a.localeCompare(b)));
    // An unknown name is never offered as a choice.
    expect(listTimezones("Not/AZone")).not.toContain("Not/AZone");
  });

  /**
   * Owner report, 7 Sep 2026: the full list as a native dropdown filled the
   * whole screen and was mis-tapped onto Africa/Abidjan. Typing finds it.
   */
  it("finds a zone by city name, closest match first", () => {
    const zones = listTimezones();
    expect(searchTimezones(zones, "lond")[0]).toBe("Europe/London");
    expect(searchTimezones(zones, "new york")[0]).toBe("America/New_York");
    // An underscore in the name never has to be typed.
    expect(searchTimezones(zones, "new_york")[0]).toBe("America/New_York");
    expect(searchTimezones(zones, "tokyo")[0]).toBe(TOKYO);
    // The region works too, and a whole-name match still ranks behind a city.
    expect(searchTimezones(zones, "europe").every((zone) => zone.startsWith("Europe/"))).toBe(true);
    expect(searchTimezones(zones, "zzzz nothing")).toEqual([]);
  });

  it("caps how many matches it returns", () => {
    const zones = listTimezones();
    expect(searchTimezones(zones, "a").length).toBeLessThanOrEqual(40);
    expect(searchTimezones(zones, "a", 3).length).toBeLessThanOrEqual(3);
    expect(suggestedTimezones(TOKYO, LONDON).length).toBeLessThanOrEqual(8);
  });

  /**
   * Owner report, 7 Sep 2026: "limited countries". IANA zones are named after
   * cities, so a country word found nothing — you had to already know your
   * zone was called Europe/London.
   */
  it("finds a zone by country, not only by city", () => {
    const zones = listTimezones();
    for (const [query, expected] of [
      ["uk", "Europe/London"],
      ["britain", "Europe/London"],
      ["england", "Europe/London"],
      ["ireland", "Europe/Dublin"],
      ["usa", "America/New_York"],
      ["germany", "Europe/Berlin"],
      ["japan", "Asia/Tokyo"],
      ["south africa", "Africa/Johannesburg"],
      ["nigeria", "Africa/Lagos"],
      ["australia", "Australia/Sydney"],
    ] as const) {
      expect(searchTimezones(zones, query)[0]).toBe(expected);
    }
    // India is Asia/Kolkata on a current runtime and Asia/Calcutta on an older
    // ICU — the same zone under two names, and either is a correct answer.
    expect(["Asia/Kolkata", "Asia/Calcutta"]).toContain(searchTimezones(zones, "india")[0]);
    // A partial country word works while typing.
    expect(searchTimezones(zones, "germ")[0]).toBe("Europe/Berlin");
    // Cities still win for a city query.
    expect(searchTimezones(zones, "berlin")[0]).toBe("Europe/Berlin");
  });

  it("offers every zone when nothing is typed, suggestions first", () => {
    const zones = listTimezones();
    const options = buildTimezoneOptions(zones, "", TOKYO, LONDON);
    // The whole world is reachable by scrolling — not a list of eight.
    expect(options.length).toBe(zones.length);
    expect(options[0]).toBe(TOKYO);
    expect(options[1]).toBe(LONDON);
    expect(new Set(options).size).toBe(options.length);
    expect(options).toContain("Pacific/Auckland");
    // Typing narrows it to the matches.
    const typed = buildTimezoneOptions(zones, "tokyo", TOKYO, LONDON);
    expect(typed[0]).toBe(TOKYO);
    expect(typed.length).toBeLessThan(zones.length);
  });

  it("suggests the zone in force and the device's own before anything is typed", () => {
    const suggestions = suggestedTimezones(TOKYO, LONDON);
    expect(suggestions[0]).toBe(TOKYO);
    expect(suggestions[1]).toBe(LONDON);
    // Never an alphabetical wall starting at Africa/Abidjan.
    expect(suggestions[0]).not.toBe("Africa/Abidjan");
    expect(suggestedTimezones(null, LONDON)[0]).toBe(LONDON);
    expect(suggestedTimezones("Not/AZone", null).length).toBeGreaterThan(0);
  });

  it("labels each match with its current offset", () => {
    expect(timezoneOffsetLabel(LONDON, new Date("2026-09-07T10:00:00Z"))).toBe("GMT+1");
    expect(timezoneOffsetLabel(TOKYO, new Date("2026-09-07T10:00:00Z"))).toBe("GMT+9");
    expect(timezoneOffsetLabel("Not/AZone")).toBe("");
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

  it("renders a compact type-to-find picker that saves at once, never a full-screen dropdown", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('const [timezone, setTimezone] = useState<string | null>(null);');
    expect(hub).toContain("setTimezone(record.timezone);");
    expect(hub).toContain("function updateTimezone(next: string) {");
    expect(hub).toContain("persistSocialStudio({ timezone: chosen });");
    expect(hub).toContain('{timezone ? "Change" : "Edit local time"}');
    expect(hub).toContain('placeholder="Type a city — London, New York…"');
    expect(hub).toContain("<b>Follow this device</b>");
    expect(hub).toContain("onClick={() => updateTimezone(zone)}");
    // A search box and a short result list, never a <select> of every zone.
    expect(hub).not.toContain("<optgroup");
    expect(hub).not.toContain('aria-label="Time zone"\n');
    // Matches are computed only while the picker is open.
    expect(hub).toContain("if (!timezoneEditing) return [];");
    expect(hub).toContain("return buildTimezoneOptions(listTimezones(timezone, deviceTimezone), timezoneQuery, timezone, deviceTimezone);");
    // Enter takes the top match; Escape closes; choosing closes it too.
    expect(hub).toContain('if (event.key === "Enter" && timezoneMatches[0]) updateTimezone(timezoneMatches[0]);');
    expect(hub).toContain('if (event.key === "Escape") setTimezoneEditing(false);');
    expect(hub).toContain("    setTimezoneEditing(false);\n    setTimezoneQuery(\"\");");
  });

  it("keeps the result list small and scrolling inside itself", async () => {
    const css = await source("components", "social-hub.module.css");
    expect(css).toContain(".timezoneResults {");
    expect(css).toContain("  max-height: 232px;");
    expect(css).toContain("  overflow-y: auto;");
    expect(css).toContain("  position: absolute;");
  });

  /**
   * Owner recording, 7 Sep 2026: every row rendered as a white pill. A button
   * with no background of its own falls back to the browser's light default,
   * and nothing else in this app hits that because every other button states
   * one. The row must state its own.
   */
  it("gives every row its own dark background, never the browser's default", async () => {
    const css = await source("components", "social-hub.module.css");
    const block = css.slice(css.indexOf(".timezoneResults button {"), css.indexOf(".timezoneResults p {"));
    expect(block).toContain("background: transparent;");
    expect(block).toContain("color: var(--text-primary);");
    expect(block).toContain("border: 1px solid transparent;");
    // Hover is a lime block; the zone in force is lime text and a tick, so two
    // rows never look pressed at once (owner recording: "stuck highlighted on africa").
    expect(block).toContain("background: rgba(198, 245, 62, 0.13);");
    expect(block).toContain('.timezoneResults button[aria-selected="true"] b,');
    expect(block).not.toContain('.timezoneResults button[aria-selected="true"] {\n  border-color');
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("{zone === timezone ? `✓ ${timezoneOffsetLabel(zone)}` : timezoneOffsetLabel(zone)}");
    expect(hub).toContain("{timezone ? deviceTimezone : `✓ ${deviceTimezone}`}");
    // The app-wide hover lift would jitter a list row.
    expect(block).toContain(".timezoneResults button:hover:not(:disabled) { transform: none; }");
  });

  it("closes when the user taps anywhere else", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("const timezonePickerRef = useRef<HTMLDivElement | null>(null);");
    expect(hub).toContain("const closeOnOutsideClick = (event: PointerEvent) => {");
    expect(hub).toContain("if (picker && event.target instanceof Node && !picker.contains(event.target)) setTimezoneEditing(false);");
    expect(hub).toContain('document.addEventListener("pointerdown", closeOnOutsideClick);');
    expect(hub).toContain('return () => document.removeEventListener("pointerdown", closeOnOutsideClick);');
    expect(hub).toContain("<div className={styles.timezonePicker} ref={timezonePickerRef}>");
  });

  /**
   * On a phone the floating list ran under the fixed bottom nav (its own
   * breakpoint is 1099px), which covered the lower rows.
   */
  it("sits in flow on a phone instead of under the fixed bottom nav", async () => {
    const css = await source("components", "social-hub.module.css");
    const block = css.slice(css.indexOf("@media (max-width: 1099px) {\n  .timezonePicker"));
    expect(block).toContain("  .timezoneResults {\n    order: 3;\n    position: static;");
    expect(block).toContain("    width: 100%;");
    expect(block).toContain("  .timezonePicker > .timezoneEdit { order: 2; }");
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('timezonePickerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });');
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
    expect(css).toContain("  .timezonePicker > input,\n  .timezoneResults button,");
  });
});
