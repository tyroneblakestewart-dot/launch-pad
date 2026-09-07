import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CALENDAR_DAY_LAST_SLOT_HOUR,
  DEFAULT_DAILY_START_CLOCK,
  computeDefaultScheduledAt,
  computeDefaultScheduledAtOnDay,
  defaultCalendarClockTime,
  describeSpreadHours,
  normaliseDailyStartTime,
} from "@/lib/social-studio-queue";

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...parts), "utf8");
}

const THREE_HOURS = 3 * 60 * 60 * 1000;
const TOKYO = "Asia/Tokyo";

/**
 * Owner direction, 7 Sep 2026: "all users should be prompted when do you want
 * your first post to start … and space posts out in accordance with the first
 * initial post that's been set".
 */
describe("the daily start time", () => {
  it("keeps a real clock string and treats anything else as unanswered", () => {
    expect(normaliseDailyStartTime("09:30")).toBe("09:30");
    expect(normaliseDailyStartTime("9:30")).toBeNull();
    expect(normaliseDailyStartTime("24:00")).toBeNull();
    expect(normaliseDailyStartTime(null)).toBeNull();
    expect(normaliseDailyStartTime(930)).toBeNull();
    // Until it is answered, the waking window's own start is what every helper uses.
    expect(DEFAULT_DAILY_START_CLOCK).toBe("07:00");
  });

  it("says how far apart the day's posts land, in plain words", () => {
    expect(describeSpreadHours(3 * 60 * 60 * 1000)).toBe("3 hours");
    expect(describeSpreadHours(3.2 * 60 * 60 * 1000)).toBe("3 hours");
    expect(describeSpreadHours(3.4 * 60 * 60 * 1000)).toBe("3½ hours");
    expect(describeSpreadHours(60 * 60 * 1000)).toBe("1 hour");
    expect(describeSpreadHours(45 * 60 * 1000)).toBe("45 minutes");
  });
});

describe("scheduling from the start time", () => {
  it("changes nothing at all until the question is answered", () => {
    const now = new Date("2026-09-07T10:00:00Z");
    // No start time: "now", or one spread past the latest pending post — the
    // exact behaviour every approval had before.
    expect(computeDefaultScheduledAt([], now, THREE_HOURS).toISOString()).toBe(now.toISOString());
    expect(computeDefaultScheduledAt([], now, THREE_HOURS, null).toISOString()).toBe(now.toISOString());
    expect(
      computeDefaultScheduledAt(["2026-09-07T12:00:00Z"], now, THREE_HOURS, null).toISOString(),
    ).toBe("2026-09-07T15:00:00.000Z");
  });

  it("puts the first post of the day at the chosen time", () => {
    // 05:00 UTC, before the 09:00 start.
    const now = new Date("2026-09-07T05:00:00Z");
    expect(computeDefaultScheduledAt([], now, THREE_HOURS, "09:00", "UTC").toISOString()).toBe("2026-09-07T09:00:00.000Z");
  });

  it("steps one spread at a time from that start, never landing between slots", () => {
    const now = new Date("2026-09-07T05:00:00Z");
    const first = computeDefaultScheduledAt([], now, THREE_HOURS, "09:00", "UTC");
    const second = computeDefaultScheduledAt([first.toISOString()], now, THREE_HOURS, "09:00", "UTC");
    const third = computeDefaultScheduledAt([first.toISOString(), second.toISOString()], now, THREE_HOURS, "09:00", "UTC");
    expect([first, second, third].map((at) => at.toISOString())).toEqual([
      "2026-09-07T09:00:00.000Z",
      "2026-09-07T12:00:00.000Z",
      "2026-09-07T15:00:00.000Z",
    ]);
  });

  it("takes the next slot on the grid when the start time has already passed", () => {
    // 13:20 UTC: past 09:00 and past the 12:00 slot, so the next one is 15:00.
    const now = new Date("2026-09-07T13:20:00Z");
    expect(computeDefaultScheduledAt([], now, THREE_HOURS, "09:00", "UTC").toISOString()).toBe("2026-09-07T15:00:00.000Z");
  });

  it("rolls to tomorrow's start once the day's waking window is full", () => {
    // 22:30 UTC is past the last waking slot for this grid, so the next post
    // is tomorrow's first — never the middle of the night.
    const now = new Date("2026-09-07T22:30:00Z");
    const next = computeDefaultScheduledAt([], now, THREE_HOURS, "09:00", "UTC");
    expect(next.toISOString()).toBe("2026-09-08T09:00:00.000Z");
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it("keeps every slot inside the waking window", () => {
    const now = new Date("2026-09-07T05:00:00Z");
    let scheduled: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const next = computeDefaultScheduledAt(scheduled, now, THREE_HOURS, "09:00", "UTC");
      expect(next.getUTCHours()).toBeGreaterThanOrEqual(9);
      expect(next.getUTCHours()).toBeLessThanOrEqual(CALENDAR_DAY_LAST_SLOT_HOUR);
      scheduled = [...scheduled, next.toISOString()];
    }
  });

  it("reads the start time on the chosen zone's clock", () => {
    const now = new Date("2026-09-06T20:00:00Z"); // 05:00 on the 7th in Tokyo
    expect(computeDefaultScheduledAt([], now, THREE_HOURS, "09:00", TOKYO).toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("starts a calendar-pinned draft's day at the chosen time too", () => {
    const now = new Date("2026-09-07T10:00:00Z");
    expect(
      computeDefaultScheduledAtOnDay("2026-09-14", [], now, THREE_HOURS, "UTC", "09:30")?.toISOString(),
    ).toBe("2026-09-14T09:30:00.000Z");
    // Unanswered, it is the waking window's own start, exactly as before.
    expect(
      computeDefaultScheduledAtOnDay("2026-09-14", [], now, THREE_HOURS, "UTC", null)?.toISOString(),
    ).toBe("2026-09-14T07:00:00.000Z");
  });

  it("defaults the calendar 'at' field to the chosen time", () => {
    const now = new Date("2026-09-07T10:00:00Z");
    expect(defaultCalendarClockTime("2026-09-14", now, "UTC", "09:30")).toBe("09:30");
    expect(defaultCalendarClockTime("2026-09-14", now, "UTC", null)).toBe("07:00");
  });
});

describe("asking for it, and changing it later", () => {
  it("stores the answer on the project record, unanswered until then", async () => {
    const types = await source("lib", "social-studio-types.ts");
    expect(types).toContain("dailyStartTime: string | null;");
    expect(types).toContain("dailyStartTime: null,");
    const db = await source("lib", "social-studio-db.ts");
    expect(db).toContain("dailyStartTime: normaliseDailyStartTime(merged.dailyStartTime),");
  });

  it("asks once above the tabs, with a Not now that does not nag", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("What time should your posts start each day?");
    expect(hub).toContain("The day&apos;s first post goes out then, and the rest space out from it.");
    expect(hub).toContain("{selectedProjectId && !dailyStartTime && !dailyStartLater && !showDetailsBox ? (");
    expect(hub).toContain("function askDailyStartLater() {");
    expect(hub).toContain('const DAILY_START_LATER_KEY = "hoodlums.social.dailyStartLater.v1";');
    expect(hub).toContain("setDailyStartLater(readDailyStartLater(projectOwner));");
    // The question never competes with the token-details box.
    expect(hub).toContain("Set this time");
    expect(hub).toContain("Not now");
  });

  it("saves at once and can be changed on the Calendar card afterwards", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("function updateDailyStartTime(next: string) {");
    expect(hub).toContain("persistSocialStudio({ dailyStartTime: next });");
    expect(hub).toContain("<span className={styles.eyebrow}>POSTS START AT</span>");
    expect(hub).toContain("value={dailyStartTime ?? DEFAULT_DAILY_START_CLOCK}");
    expect(hub).toContain("onChange={(event) => updateDailyStartTime(event.target.value)}");
    expect(hub).toContain("describeSpreadHours(cadenceSpreadHoursMs(postingCadence))");
  });

  it("feeds the start time into every scheduling decision", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("computeDefaultScheduledAt(awaitingIso, now, cadenceSpreadHoursMs(postingCadence), dailyStartTime, timezone)");
    expect(hub).toContain("computeDefaultScheduledAtOnDay(item.scheduledDay, awaitingIso, now, cadenceSpreadHoursMs(postingCadence), timezone, dailyStartTime)");
    expect(hub).toContain("setCalendarTime(defaultCalendarClockTime(selectedDayIso, new Date(), timezone, dailyStartTime));");
  });

  it("gives the question's controls a 44px touch target", async () => {
    const css = await source("components", "social-hub.module.css");
    expect(css).toContain(".startTimeAsk {");
    expect(css).toContain("  .startTimeAsk button,\n  .startTimeAsk input[type=\"time\"],");
  });
});
