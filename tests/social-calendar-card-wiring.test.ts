import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...parts), "utf8");
}

/**
 * Owner direction, 7 Sep 2026, after the Calendar test pass: wire the
 * tab's unbuilt controls rather than list them. The schedule card's quiet
 * hours, "I'll post my own" and WHERE IT POSTS chips are live; the
 * coming-soon note and badge are gone.
 */
describe("Calendar schedule card: quiet hours, own posts and live destination chips", () => {
  it("persists quiet hours per project with the design's default and migrate-on-read", async () => {
    const types = await source("lib", "social-studio-types.ts");
    expect(types).toContain("quietHours: QuietHours | null;");
    expect(types).toContain("quietHours: { ...DEFAULT_QUIET_HOURS },");
    const db = await source("lib", "social-studio-db.ts");
    expect(db).toContain("quietHours: normaliseQuietHours(merged.quietHours),");
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("setQuietHours(record.quietHours);");
    expect(hub).toContain("      quietHours,\n      sortedVoiceSourceKeys,");
    expect(hub).toContain("persistSocialStudio({ quietHours: next });");
    expect(hub).toContain("updateQuietHours(next.startHour === next.endHour ? null : next);");
  });

  it("binds the two selects and an on/off control, and no select on the card is a disabled placeholder", async () => {
    const hub = await source("components", "social-hub.tsx");
    const card = hub.slice(hub.indexOf("<aside className={styles.scheduleCard}>"), hub.indexOf("</aside>", hub.indexOf("<aside className={styles.scheduleCard}>")));
    expect(card).toContain('onChange={(event) => setQuietHourBound("startHour", Number(event.target.value))}');
    expect(card).toContain('onChange={(event) => setQuietHourBound("endHour", Number(event.target.value))}');
    expect(card).toContain("{QUIET_HOUR_OPTIONS.map((hour) => <option key={hour} value={hour}>{formatQuietHour(hour)}</option>)}");
    expect(card).toContain("onClick={() => updateQuietHours(quietHours ? null : { ...DEFAULT_QUIET_HOURS })}");
    expect(card).not.toContain("<select disabled>");
    expect(card).not.toContain("<ComingSoon");
    expect(card).not.toContain("are not built yet");
    expect(card).toContain("Every post still needs your approve tap in the Queue before it goes out.");
  });

  it("applies quiet hours to every default time and every approval, after the future clamp, and says so", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("next[item.id] = toDateTimeLocalValue(shiftOutOfQuietHours(base, quietHours));");
    expect(hub).toContain("}, [queue, scheduledPosts, postingCadence, quietHours]);");
    const approve = hub.slice(hub.indexOf("async function approveQueueItem("));
    expect(approve).toContain("const picked = shiftOutOfQuietHours(ensureFutureScheduledAt(rawPicked, now), quietHours);");
    expect(approve).toContain("const scheduledAtIso = ensureFutureScheduledAt(picked, now).toISOString();");
    expect(approve.indexOf("shiftOutOfQuietHours(ensureFutureScheduledAt(rawPicked, now)")).toBeLessThan(approve.indexOf("const scheduledAtIso ="));
    expect(approve).toContain("to stay out of quiet hours.");
  });

  it("\"I'll post my own\" adds a manual draft pinned to the selected day through the ordinary Queue approve path", async () => {
    const hub = await source("components", "social-hub.tsx");
    const start = hub.indexOf("function addOwnPostForDay()");
    const fn = hub.slice(start, hub.indexOf("\n  }\n", start));
    expect(fn).toContain('source: "manual",');
    expect(fn).toContain("dayLabel: selectedDayLabel,");
    expect(fn).toContain("scheduledDay,");
    expect(fn).toContain("if (isCalendarDayBeforeToday(scheduledDay, new Date())) {");
    expect(fn).toContain("if (text.length > X_CHARACTER_LIMIT) {");
    expect(fn).toContain("persistSocialStudio({ queue: next });");
    // Never posts directly — no network call in the composer path.
    expect(fn).not.toContain("fetch(");
    expect(fn).not.toContain("publish");
    expect(hub).toContain("const X_CHARACTER_LIMIT = 280;");
    expect(hub).toContain("aria-expanded={ownPostOpen}");
    expect(hub).toContain("<InlineStatus status={ownPostStatus} />");
    // The Queue caption names the day for an own post.
    expect(hub).toContain("? `Your own · ${item.dayLabel}`");
  });

  it("WHERE IT POSTS reflects the real connected platforms", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('className={myConnectedPlatforms.includes("x") ? styles.chipConnected : styles.chipOff}');
    expect(hub).toContain('className={myConnectedPlatforms.includes("telegram") ? styles.chipConnected : styles.chipOff}');
    expect(hub).not.toContain("<span><XMark /> X</span>");
    const css = await source("components", "social-hub.module.css");
    expect(css).toContain(".destinationChips .chipConnected {");
    expect(css).toContain(".destinationChips .chipOff {");
    expect(css).toContain(".ownPostComposer textarea {");
    expect(css).toContain(".quietHours select { min-height: 44px; }");
  });
});
