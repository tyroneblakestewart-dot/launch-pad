import { describe, expect, it } from "vitest";
import {
  buildCalendarDayMarks,
  describeCalendarDayMarks,
  describeCalendarPostStatus,
  describeDetectedTimezone,
  listCalendarDayEntries,
} from "@/lib/social-calendar-days";

const at = (day: number, hour: number, month = 8) => new Date(2026, month, day, hour).toISOString();
const posts = [
  { id: "a", status: "scheduled", scheduledAt: at(7, 16), body: "Today post", destinations: [{ platform: "telegram", status: "pending" }] },
  { id: "b", status: "needs_composer", scheduledAt: at(12, 10), body: "Composer one", destinations: [{ platform: "x", status: "needs_composer" }] },
  { id: "c", status: "sent", scheduledAt: at(3, 9), body: "Sent one", destinations: [{ platform: "telegram", status: "sent" }, { platform: "x", status: "sent" }] },
  { id: "d", status: "partially_sent", scheduledAt: at(3, 11), body: "Partly", destinations: [] },
  { id: "e", status: "failed", scheduledAt: at(12, 12), body: "Failed", destinations: [] },
  { id: "f", status: "canceled", scheduledAt: at(12, 13), body: "Canceled", destinations: [] },
  { id: "g", status: "scheduled", scheduledAt: at(2, 9, 9), body: "October", destinations: [] },
  { id: "h", status: "scheduled", scheduledAt: "not-a-date", body: "Bad", destinations: [] },
];
const drafts = [
  { id: "d1", scheduledDay: "2026-09-12", source: "calendar-ai", xText: "Draft twelve" },
  { id: "d2", scheduledDay: "2026-09-14", source: "manual", xText: "", telegramText: "Own words" },
  { id: "d3", scheduledDay: null, source: "auto-replenish", xText: "No day" },
  { id: "d4", scheduledDay: "2026-10-01", source: "calendar-ai", xText: "Next month" },
];

describe("calendar day markers (owner direction, 7 Sep 2026)", () => {
  it("counts scheduled, sent, failed and pinned drafts per local day of the month in view, ignoring canceled, other months and bad dates", () => {
    const marks = buildCalendarDayMarks(posts, drafts, 2026, 8);
    expect(marks.get(7)).toEqual({ scheduled: 1, sent: 0, failed: 0, drafts: 0 });
    expect(marks.get(12)).toEqual({ scheduled: 1, sent: 0, failed: 1, drafts: 1 });
    expect(marks.get(3)).toEqual({ scheduled: 0, sent: 2, failed: 0, drafts: 0 });
    expect(marks.get(14)).toEqual({ scheduled: 0, sent: 0, failed: 0, drafts: 1 });
    expect(marks.has(1)).toBe(false);
    expect([...marks.keys()].sort((a, b) => a - b)).toEqual([3, 7, 12, 14]);
    expect(buildCalendarDayMarks(posts, drafts, 2026, 9).get(1)).toEqual({ scheduled: 0, sent: 0, failed: 0, drafts: 1 });
    expect(buildCalendarDayMarks(posts, drafts, 2026, 9).get(2)).toEqual({ scheduled: 1, sent: 0, failed: 0, drafts: 0 });
  });

  it("describes a day in plain words, never 'No scheduled posts' when something is there", () => {
    expect(describeCalendarDayMarks(undefined)).toBe("Nothing yet");
    expect(describeCalendarDayMarks(undefined, true)).toBe("Today · nothing yet");
    expect(describeCalendarDayMarks({ scheduled: 2, sent: 0, failed: 0, drafts: 1 })).toBe("2 scheduled · 1 draft to approve");
    expect(describeCalendarDayMarks({ scheduled: 0, sent: 1, failed: 1, drafts: 2 }, true)).toBe("Today · 2 drafts to approve · 1 sent · 1 failed");
  });

  it("lists a day's posts by time then its drafts, with platforms and plain status words", () => {
    const entries = listCalendarDayEntries(posts, drafts, 2026, 8, 12);
    expect(entries.map((entry) => entry.id)).toEqual(["b", "e", "d1"]);
    expect(entries[0]).toMatchObject({ kind: "post", platforms: ["x"], status: "needs_composer", body: "Composer one" });
    expect(entries[2]).toMatchObject({ kind: "draft", source: "calendar-ai", body: "Draft twelve" });
    expect(listCalendarDayEntries(posts, drafts, 2026, 8, 14)[0]).toMatchObject({ kind: "draft", body: "Own words" });
    expect(listCalendarDayEntries(posts, drafts, 2026, 8, 20)).toEqual([]);
    expect(describeCalendarPostStatus("needs_composer")).toBe("tap to post on X");
    expect(describeCalendarPostStatus("partially_sent")).toBe("partly sent");
  });

  it("names the browser's own zone with its current offset, following daylight saving", () => {
    expect(describeDetectedTimezone(new Date("2026-09-07T10:00:00Z"), "Europe/London")).toBe("Europe/London · GMT+1");
    // Node's ICU prints "GMT+0" for a zero offset where browsers print "GMT"; either is honest.
    expect(describeDetectedTimezone(new Date("2026-11-07T10:00:00Z"), "Europe/London")).toMatch(/^Europe\/London · GMT(\+0)?$/);
    expect(describeDetectedTimezone(new Date("2026-09-07T10:00:00Z"), "America/New_York")).toBe("America/New_York · GMT-4");
    // An unrecognised zone falls back to the device's own zone and names it —
    // the user always sees the clock actually in force, never a vague phrase
    // (the stored value is validated by normaliseTimezone before it gets here).
    expect(describeDetectedTimezone(new Date(), "Not/AZone")).toBe(describeDetectedTimezone(new Date()));
  });
});
