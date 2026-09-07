import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...parts), "utf8");
}

/**
 * Calendar tab, owner test 7 Sep 2026: an "AI makes it" draft for the 14th
 * defaulted to today at approval (the day was only ever a label), and the
 * TODAY x/5 pill read 0/5 on every tab until the Queue tab had been opened.
 */
describe("Calendar AI drafts keep their day, and scheduled posts load on the Calendar tab", () => {
  it("carries the picked day on the draft as a local YYYY-MM-DD", async () => {
    const types = await source("lib", "social-studio-types.ts");
    expect(types).toContain("scheduledDay?: string | null;");

    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("scheduledDay?: string;");
    expect(hub).toContain("scheduledDay: options.scheduledDay ?? null,");
    expect(hub).toContain("const scheduledDay = toCalendarDayIso(selectedDay.year, selectedDay.month, selectedDay.day);");
    expect(hub).toContain("await generateDraft({ dayLabel: selectedDayLabel, scheduledDay, scheduledTime: calendarTime }, setCalendarDraftStatus);");
  });

  it("refuses a day already gone before any paid draft call", async () => {
    const hub = await source("components", "social-hub.tsx");
    const fn = hub.slice(hub.indexOf("async function generateDraftForDay()"), hub.indexOf("function calendarDayScheduledAt("));
    expect(fn).toContain("if (isCalendarDayBeforeToday(scheduledDay, new Date())) {");
    expect(fn).toContain("has already passed — pick today or a later day.");
    expect(fn.indexOf("isCalendarDayBeforeToday(")).toBeLessThan(fn.indexOf("setCalendarAiBusy(true);"));
    // The refusal returns before the busy flag and the request.
    expect(fn.indexOf("return;")).toBeLessThan(fn.indexOf("setCalendarAiBusy(true);"));
  });

  it("the shown default and the approval time both come from the same calendar-day helper", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("function calendarDayScheduledAt(item: QueueItem, awaitingIso: string[], now: Date): Date | null {");
    expect(hub).toContain("computeDefaultScheduledAtOnDay(item.scheduledDay, awaitingIso, now, cadenceSpreadHoursMs(postingCadence))");
    // Shown default (the Queue row's Scheduled input).
    expect(hub).toContain(
      "const base = calendarDayScheduledAt(item, awaitingIso, now) ?? computeDefaultScheduledAt(awaitingIso, now, cadenceSpreadHoursMs(postingCadence));",
    );
    // Approval — still behind the user's own pick, still through the future clamp.
    const approve = hub.slice(hub.indexOf("async function approveQueueItem("));
    expect(approve).toContain("scheduleManuallySet[item.id] && itemScheduledAt[item.id]");
    expect(approve).toContain(
      ": calendarDayScheduledAt(item, awaitingIso, now) ?? computeDefaultScheduledAt(awaitingIso, now, cadenceSpreadHoursMs(postingCadence));",
    );
    expect(approve).toContain("const scheduledAtIso = ensureFutureScheduledAt(picked, now).toISOString();");
  });

  it("loads scheduled posts once per wallet on arrival and on every Calendar tab open, leaving the Queue tab's own load alone", async () => {
    const hub = await source("components", "social-hub.tsx");
    const start = hub.indexOf('const postsLoadedForWalletRef = useRef("");');
    expect(start).toBeGreaterThan(-1);
    const effect = hub.slice(start, start + 700);
    expect(effect).toContain("if (!walletAddress) return;");
    expect(effect).toContain("const firstLoadForWallet = postsLoadedForWalletRef.current !== walletAddress;");
    expect(effect).toContain('if (activeTab === "queue") return;');
    expect(effect).toContain('if (!firstLoadForWallet && activeTab !== "calendar") return;');
    expect(effect).toContain("void queueTabActionsRef.current.loadScheduledPosts();");
    expect(effect).toContain("}, [activeTab, walletAddress]);");
    // Never replenishes from here — that stays the Queue tab's paid decision.
    expect(effect).not.toContain("replenishQueue");
    // The Queue tab's own activation load is untouched.
    expect(hub).toContain('if (activeTab !== "queue") return;\n    void loadScheduledPosts();');
  });

  it("the calendar card says what now happens", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("Drafts a post for this day and adds it to the Queue — approve it there and it goes out on this day.");
    expect(hub).not.toContain("Generates a voice-aware draft for this day");
  });
});
