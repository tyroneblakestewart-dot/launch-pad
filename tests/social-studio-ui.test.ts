import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Hoodlums AI Social Studio", () => {
  it("uses the approved Social wordmark, subtitle and four-tab product structure", async () => {
    const social = await source("components", "social-hub.tsx");
    const page = await source("app", "(app)", "social", "page.tsx");

    expect(social).toContain('src="/hoodlums-social-wordmark.png"');
    expect(social).toContain("Prepare once. Review every destination. Publish without sharing passwords.");
    expect(social).toContain('desktop: "Setup"');
    expect(social).toContain('desktop: "Calendar & Schedule"');
    expect(social).toContain('desktop: "Queue & History"');
    expect(social).toContain('desktop: "Settings & Rules"');
    expect(page).toContain('title: "AI Social Studio"');
    expect(social).not.toContain("Project Social Hub");
  });

  it("preserves the existing project, composer, X and Telegram publishing paths", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("PROJECT_STORAGE_KEY");
    expect(social).toContain("DRAFT_STORAGE_KEY");
    expect(social).toContain("TELEGRAM_CHAT_STORAGE_KEY");
    expect(social).toContain("buildTemplate");
    expect(social).toContain("selectProject");
    expect(social).toContain("saveDraft");
    expect(social).toContain("copyPost");
    expect(social).toContain("downloadArtwork");
    expect(social).toContain("openXComposer");
    expect(social).toContain("https://x.com/intent/post?text=");
    expect(social).toContain("postTelegram");
    expect(social).toContain('fetch("/api/social/telegram"');
    expect(social).toContain("publishBoth");
    expect(social).toContain("Approve &amp; open X composer");
    expect(social).toContain("Approve & post to Telegram");
    expect(social).toContain("APPROVE BOTH DESTINATIONS");
  });

  it("removes the raw bot-token field while retaining server-side Telegram posting", async () => {
    const social = await source("components", "social-hub.tsx");
    const route = await source("app", "api", "social", "telegram", "route.ts");

    expect(social).not.toContain("telegramBotToken");
    expect(social).not.toContain("Paste the BotFather token");
    expect(social).not.toContain("botToken:");
    expect(route).toContain("process.env.TELEGRAM_BOT_TOKEN");
    expect(route).toContain("requestedBotToken || configuredBotToken");
    expect(route).toContain("publishTelegramPost");
  });

  it("activates the AI Social Studio tabs (issue #332): voice, drafting, mascot images, calendar AI and the queue", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("Teach the AI your voice");
    expect(social).toContain('fetch("/api/social/voice-profile"');
    expect(social).toContain("buildVoiceProfile");
    expect(social).not.toContain('<textarea disabled placeholder="Paste a post here');

    expect(social).toContain('fetch("/api/social/draft"');
    expect(social).toContain("generateDraftFromSetup");
    expect(social).toContain("generateDraftForDay");

    expect(social).toContain("Your mascot");
    expect(social).toContain('fetch("/api/social/mascot/visual-dna"');
    expect(social).toContain('fetch("/api/social/mascot/image"');
    expect(social).toContain("toggleMascotAction");
    expect(social).toContain("toggleMascotPlace");
    expect(social).not.toContain("{MASCOT_ACTIONS.map((label) => <button type=\"button\" disabled key={label}>{label}</button>)}");

    expect(social).toContain("MONTH_NAMES[calendarView.month]");
    expect(social).toContain('onClick={generateDraftForDay} disabled={calendarAiBusy}');

    expect(social).toContain("What&apos;s going out");
    expect(social).toContain("postQueueItemToX");
    expect(social).toContain("sendQueueItemToTelegram");
    expect(social).toContain("removeQueueItem");
    expect(social).not.toContain("No queue is being simulated.");

    // Rules tab and the still out-of-scope calendar/bot controls stay coming soon.
    expect(social).toContain("Words to avoid");
    expect(social).toContain("Coming soon");
    expect(social).toContain('disabled className={styles.ownPostButton}');
    expect(social).toContain("Add to your channel");
  });

  it("supports real month navigation, today highlighting and year-boundary rollover in the calendar", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("function shiftedMonth(view: MonthView, delta: number): MonthView");
    expect(social).toContain("if (next < 0) return { year: view.year - 1, month: 11 };");
    expect(social).toContain("if (next > 11) return { year: view.year + 1, month: 0 };");
    expect(social).toContain("function buildMonthGrid(year: number, month: number)");
    expect(social).toContain("function jumpToToday()");
    expect(social).toContain("Jump to today");
    expect(social).toContain('aria-label="Previous month"');
    expect(social).toContain('aria-label="Next month"');
    expect(social).toContain("isToday && styles.calendarToday");
    expect(social).toContain("isSelected ? styles.weekSelected : isToday ? styles.weekToday : styles.weekDay");
    expect(social).toContain("TIMEZONES.map((timezone)");
  });

  it("fits under the existing 72px mobile header and above the fixed bottom nav", async () => {
    const socialCss = await source("components", "social-hub.module.css");
    const navCss = await source("components", "app-navigation.module.css");

    expect(navCss).toContain("min-height:72px");
    expect(navCss).toContain("background:rgba(4,8,5,.96)");
    expect(navCss).toContain("backdrop-filter:blur(14px)");
    expect(navCss).toContain("bottom:calc(16px + env(safe-area-inset-bottom))");
    expect(navCss).toContain("height:62px");
    expect(navCss).toContain("backdrop-filter:blur(20px) saturate(145%)");
    expect(navCss).toContain("padding-bottom:calc(96px + env(safe-area-inset-bottom))");
    expect(socialCss).toContain("position: sticky");
    expect(socialCss).toContain("top: 72px");
    expect(socialCss).toContain("z-index: 80");
  });
});
