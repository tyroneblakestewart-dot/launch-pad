import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...parts), "utf8");
}

/** Owner direction, 7 Sep 2026: the calendar grid shows what it knows, the phone strip opens on today, and the timezone line is honest. */
describe("Calendar grid: day markers, the day list, the mobile strip and the timezone label", () => {
  it("marks days from the loaded posts and pinned drafts, on both the desktop grid and the mobile strip", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("() => buildCalendarDayMarks(scheduledPosts, queue, calendarView.year, calendarView.month),");
    expect(hub).toContain("const marks = day !== null ? calendarDayMarks.get(day) : undefined;");
    expect(hub).toContain("{marks.scheduled ? <i className={styles.limeDot} /> : null}");
    expect(hub).toContain("{marks.drafts ? <i className={styles.draftDot} /> : null}");
    expect(hub).toContain("{marks.sent || marks.failed ? <i className={styles.greyDot} /> : null}");
    expect(hub).toContain("<small>{describeCalendarDayMarks(calendarDayMarks.get(day), isToday)}</small>");
    expect(hub).not.toContain('"No scheduled posts"');
    // The legend describes what is drawn.
    expect(hub).toContain("<span><i className={styles.limeDot} />Scheduled</span>");
    expect(hub).toContain("<span><i className={styles.draftDot} />Draft to approve</span>");
    expect(hub).toContain("<span><i className={styles.greyDot} />Sent</span>");
    expect(hub).not.toContain("Lime days will hold launches or announcements.");
  });

  it("lists the selected day's posts and drafts on the card, each opening the Queue", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("() => listCalendarDayEntries(scheduledPosts, queue, selectedDay.year, selectedDay.month, selectedDay.day),");
    const list = hub.slice(hub.indexOf("<ul className={styles.dayEntries}>"), hub.indexOf("</ul>", hub.indexOf("<ul className={styles.dayEntries}>")));
    expect(list).toContain('onClick={() => setActiveTab("queue")}');
    expect(list).toContain("{describeCalendarPostStatus(entry.status)}");
    expect(list).toContain("Waiting for your approve tap");
  });

  it("scrolls the mobile strip to the selected day when the tab opens, without scrolling the page", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("<div className={styles.mobileWeek} ref={mobileWeekRef}>");
    expect(hub).toContain("data-day={day}");
    const start = hub.indexOf("// The mobile week strip opens on the selected day");
    const effect = hub.slice(start, start + 700);
    expect(effect).toContain('if (activeTab !== "calendar") return;');
    expect(effect).toContain("if (!strip || strip.clientWidth === 0) return;");
    expect(effect).toContain('strip.scrollTo({ left: Math.max(0, target.offsetLeft - strip.offsetLeft - 8), behavior: "auto" });');
    expect(effect).not.toContain("scrollIntoView");
    expect(effect).toContain("}, [activeTab, calendarView.year, calendarView.month, selectedDay]);");
    const css = await source("components", "social-hub.module.css");
    expect(css).toContain(".weekSelected { border-color: var(--accent-lime); background: var(--studio-lime-card-bg);");
    expect(css).not.toContain(".weekSelected { border-color: var(--accent-lime); background: var(--cta-bg); }");
  });

  it("shows the browser's detected zone instead of a select nothing read, resolved after mount", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('const [detectedTimezone, setDetectedTimezone] = useState("your local time");');
    expect(hub).toContain("setDetectedTimezone(describeDetectedTimezone());");
    expect(hub).toContain("<b>{detectedTimezone}</b>");
    expect(hub).not.toContain("timezoneId");
    expect(hub).not.toContain("TIMEZONES");
  });
});
