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
    expect(hub).toContain("      quietHours,\n      timezone,\n      sortedVoiceSourceKeys,");
    expect(hub).toContain("persistSocialStudio({ quietHours: next });");
    expect(hub).toContain("updateQuietHours(next.start === next.end ? null : next);");
    // A cleared time field is ignored rather than saved as off.
    expect(hub).toContain("if (parseClockTime(value) === null) return;");
  });

  it("binds two native time fields (the phone's wheel, a compact hh:mm on desktop — never a 24-row dropdown) and an on/off control", async () => {
    const hub = await source("components", "social-hub.tsx");
    const card = hub.slice(hub.indexOf("<aside className={styles.scheduleCard}>"), hub.indexOf("</aside>", hub.indexOf("<aside className={styles.scheduleCard}>")));
    expect(card).toContain('onChange={(event) => setQuietHourBound("start", event.target.value)}');
    expect(card).toContain('onChange={(event) => setQuietHourBound("end", event.target.value)}');
    // Two quiet-hours fields plus the "at" time beside the date (7 Sep 2026).
    expect(card.match(/type="time"/g)).toHaveLength(3);
    expect(card).not.toContain("<select");
    const css = await source("components", "social-hub.module.css");
    expect(css).toContain('.quietHours input[type="time"] { width: auto; flex: 0 0 auto; min-width: 108px; height: 38px; padding: 0 10px; box-sizing: border-box; color-scheme: dark;');
    expect(css).toContain('.quietHours input[type="time"] { height: 44px; }');
    expect(css).toContain('.quietHours input[type="time"] { min-height: 44px; }');
    expect(card).toContain("onClick={() => updateQuietHours(quietHours ? null : { ...DEFAULT_QUIET_HOURS })}");
    expect(card).not.toContain("<select disabled>");
    expect(card).not.toContain("<ComingSoon");
    expect(card).not.toContain("are not built yet");
    expect(card).toContain("Your local time. Anything landing in this window moves to its end when you approve.");
  });

  it("applies quiet hours to every default time and every approval, after the future clamp, and says so", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("next[item.id] = toDateTimeLocalValue(shiftOutOfQuietHours(base, quietHours, timezone), timezone);");
    expect(hub).toContain("}, [queue, scheduledPosts, postingCadence, quietHours, timezone]);");
    const approve = hub.slice(hub.indexOf("async function approveQueueItem("));
    expect(approve).toContain("const picked = shiftOutOfQuietHours(ensureFutureScheduledAt(rawPicked, now), quietHours, timezone);");
    expect(approve).toContain("const scheduledAtIso = ensureFutureScheduledAt(picked, now).toISOString();");
    expect(approve.indexOf("shiftOutOfQuietHours(ensureFutureScheduledAt(rawPicked, now)")).toBeLessThan(approve.indexOf("const scheduledAtIso ="));
    expect(approve).toContain("to stay out of quiet hours.");
  });

  it("the announcement composer (formerly \"I'll post my own\") is live and adds through the ordinary Queue approve path", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('role="tablist" aria-label="Announcement mode"');
    expect(hub).not.toContain("AI makes it");
    expect(hub).toContain("<InlineStatus status={announcementStatus} />");
    expect(hub).toContain("const X_CHARACTER_LIMIT = 280;");
    expect(hub).not.toContain("I'll post my own");
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
    expect(css).toContain('.quietHours select,\n  .quietHours input[type="time"] { min-height: 44px; }');
  });
});
