import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { POST } from "@/app/api/social/draft/route";
import { AI_FEATURE_KEYS, featureGroupLabel } from "@/lib/ai-feature-keys";
import { resetGenerateSiteStyleRateLimitForTests } from "@/lib/server/api-protection";
import {
  MAX_ANNOUNCEMENT_LENGTH,
  buildDraftRequestBody,
  checkDraftCompliance,
  type DraftProject,
} from "@/lib/server/social-draft-pipeline";
import { describeDraftSource } from "@/lib/social-calendar-days";
import { calendarDayAtTime, defaultCalendarClockTime } from "@/lib/social-studio-queue";

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...parts), "utf8");
}

const PROJECT: DraftProject = { name: "Test Coin", ticker: "TEST", description: "A community-driven meme token.", chain: "robinhood", contractAddress: "" };
const ANNOUNCEMENT = "Liquidity pool goes live Friday 6pm UK. 40% of supply locked for 12 months. Listed on Dexscreener the same day.";

/**
 * Owner direction, 7 Sep 2026: "I'll post my own" becomes an Announcement
 * post — the user writes the announcement, posts it as written or lets the
 * AI jazz it up — and the date at the top gets a time.
 */
describe("Announcement mode in the draft pipeline", () => {
  it("rewrites the user's announcement in the taught voice with every fact kept, and emits no angle form", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, announcement: ANNOUNCEMENT, angleIndex: 3, theme: "milestone" }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    const userText = body.input[1]?.content[0]?.text ?? "";
    expect(developerText).toContain("ANNOUNCEMENT MODE");
    expect(developerText).toContain("Keep every fact exactly as the user stated it");
    expect(developerText).toContain("The user's announcement (their own words; every fact in it is true and must be kept)");
    expect(developerText).toContain("Every specific factual detail in either draft must come from the user's announcement above");
    expect(developerText).not.toContain("Required post form");
    expect(userText).toContain(`Announcement to rewrite (the user's own words):\n${ANNOUNCEMENT}`);
    // A theme never competes with an announcement.
    expect(userText).not.toContain("Theme for this post");
  });

  it("changes nothing about ordinary drafting when no announcement is supplied", () => {
    const withEmpty = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, announcement: "  ", angleIndex: 1 }, "gpt-5-mini");
    const without = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, angleIndex: 1 }, "gpt-5-mini");
    expect(withEmpty).toEqual(without);
    expect(without.input[0]?.content[0]?.text ?? "").not.toContain("ANNOUNCEMENT MODE");
  });

  it("skips the angle and invented-fact checks in announcement mode (the user's facts are the truth) but keeps banned words and tone", () => {
    const draft = { xText: "Liquidity pool live Friday 6pm UK — 40% of supply locked 12 months. Listed on Dexscreener same day.", telegramText: "Pool live Friday 6pm UK. 40% locked for 12 months. Dexscreener listing the same day." };
    expect(checkDraftCompliance(draft, { angleIndex: 1, announcement: ANNOUNCEMENT })).toEqual({ violated: false });
    // Without the announcement the same text is (rightly) an invented liquidity event.
    expect(checkDraftCompliance(draft, { angleIndex: 1, theme: "x" }).violated).toBe(true);
    const banned = checkDraftCompliance(draft, { angleIndex: 1, announcement: ANNOUNCEMENT, wordsToAvoid: ["locked"] });
    expect(banned.violated).toBe(true);
    const emoji = checkDraftCompliance({ ...draft, xText: `${draft.xText} 🚀` }, { angleIndex: 1, announcement: ANNOUNCEMENT, toneDials: { humour: "dry", emoji: "none", hashtags: "never", postLength: "short" } });
    expect(emoji.violated).toBe(true);
  });

  it("meters jazz-ups under their own Operations line so the owner can measure them", () => {
    expect(AI_FEATURE_KEYS.SOCIAL_ANNOUNCEMENT).toBe("social.announcement");
    expect(AI_FEATURE_KEYS.SOCIAL_ANNOUNCEMENT_RETRY).toBe("social.announcement-retry");
    expect(featureGroupLabel(AI_FEATURE_KEYS.SOCIAL_ANNOUNCEMENT)).toBe("Announcement jazz-up");
    expect(featureGroupLabel(AI_FEATURE_KEYS.SOCIAL_ANNOUNCEMENT_RETRY)).toBe("Announcement jazz-up");
    expect(featureGroupLabel(AI_FEATURE_KEYS.SOCIAL_DRAFT)).toBe("Social draft");
  });
});

describe("POST /api/social/draft with an announcement", () => {
  function request(body: unknown): Request {
    return new Request("http://localhost/api/social/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  function providerResponse(draft: { xText: string; telegramText: string }): Response {
    return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(draft) }] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
    resetGenerateSiteStyleRateLimitForTests();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("passes a bounded, printable announcement to the model, accepts the user's own factual claims back, and reports no angle", async () => {
    const draft = { xText: "Pool live Friday 6pm UK. 40% of supply locked 12 months.", telegramText: "Liquidity pool live Friday 6pm UK; 40% of supply locked for 12 months." };
    const fetchMock = vi.fn().mockResolvedValueOnce(providerResponse(draft));
    vi.stubGlobal("fetch", fetchMock);
    const noisy = `${ANNOUNCEMENT}\u0007\u0000${"x".repeat(MAX_ANNOUNCEMENT_LENGTH)}`;
    const response = await POST(request({ walletAddress: "0x1111111111111111111111111111111111111111", project: { name: "Test Coin", ticker: "TEST", description: "" }, angleIndex: 1, announcement: noisy }));
    const body = (await response.json()) as { draft?: { xText: string }; angleKey?: string | null; error?: string };
    expect(response.status).toBe(200);
    expect(body.draft?.xText).toBe(draft.xText);
    expect(body.angleKey).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body) as { input: Array<{ content: Array<{ text: string }> }> };
    const userText = sent.input[1]?.content[0]?.text ?? "";
    expect(userText).toContain("Announcement to rewrite");
    expect(userText).toContain(ANNOUNCEMENT);
    expect(userText).not.toContain("\u0007");
    const announcementSent = userText.slice(userText.indexOf("Announcement to rewrite (the user's own words):\n") + "Announcement to rewrite (the user's own words):\n".length);
    expect(announcementSent.length).toBeLessThanOrEqual(MAX_ANNOUNCEMENT_LENGTH);
  });
});

describe("Calendar 'at' time helpers", () => {
  it("builds the local Date for a day at a clock time, or null when either is malformed", () => {
    expect(calendarDayAtTime("2026-09-14", "18:30")?.getTime()).toBe(new Date(2026, 8, 14, 18, 30).getTime());
    expect(calendarDayAtTime("2026-09-14", "7:00")).toBeNull();
    expect(calendarDayAtTime("14 September", "18:30")).toBeNull();
  });

  it("defaults to the first waking slot, or the next quarter hour when today's slot has passed", () => {
    expect(defaultCalendarClockTime("2026-09-14", new Date(2026, 8, 7, 11, 22))).toBe("07:00");
    expect(defaultCalendarClockTime("2026-09-07", new Date(2026, 8, 7, 5, 10))).toBe("07:00");
    expect(defaultCalendarClockTime("2026-09-07", new Date(2026, 8, 7, 11, 22))).toBe("11:30");
    expect(defaultCalendarClockTime("2026-09-07", new Date(2026, 8, 7, 11, 30))).toBe("11:45");
    expect(defaultCalendarClockTime("2026-09-07", new Date(2026, 8, 7, 23, 50))).toBe("23:45");
    expect(defaultCalendarClockTime("nonsense", new Date(2026, 8, 7, 11, 22))).toBe("07:00");
  });

  it("names every draft origin plainly", () => {
    expect(describeDraftSource("announcement")).toBe("Announcement");
    expect(describeDraftSource("announcement-ai")).toBe("Announcement (AI)");
    expect(describeDraftSource("calendar-ai")).toBe("Calendar AI");
    expect(describeDraftSource("manual")).toBe("Your own");
    expect(describeDraftSource(undefined)).toBe("AI");
  });
});

describe("Calendar card wiring for announcements and the time field", () => {
  it("adds a time beside the date that every calendar draft and announcement is scheduled for, with a quiet-hours warning", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('<label className={styles.addToTime}>');
    expect(hub).toContain('aria-label="Time on this day"');
    expect(hub).toContain("onChange={(event) => setCalendarTimeFromField(event.target.value)}");
    expect(hub).toContain("if (parseClockTime(value) === null) return;\n    calendarTimeTouchedRef.current = true;");
    expect(hub).toContain("Inside quiet hours — it will go out at ${quietHours.end}.");
    // The picked time is the exact default at approval and in the Queue row.
    expect(hub).toContain("const pinned = item.scheduledTime ? calendarDayAtTime(item.scheduledDay, item.scheduledTime, timezone) : null;");
    expect(hub).toContain("scheduledTime: options.scheduledTime ?? null,");
    const types = await source("lib", "social-studio-types.ts");
    expect(types).toContain("scheduledTime?: string | null;");
    expect(types).toContain('"announcement" | "announcement-ai"');
  });

  it("the composer has My words and AI jazz-up tabs, and both add through the Queue with the day and time", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("<span className={styles.eyebrow}>ANNOUNCEMENT</span>");
    expect(hub).not.toContain("generateDraftForDay");
    expect(hub).toContain('role="tablist" aria-label="Announcement mode"');
    expect(hub).toContain("My words");
    expect(hub).toContain("AI jazz-up");
    const start = hub.indexOf("function addAnnouncementToQueue(mode");
    const fn = hub.slice(start, hub.indexOf("\n  }\n", start));
    expect(fn).toContain('source: mode === "own" ? "announcement" : "announcement-ai",');
    expect(fn).toContain("scheduledDay: selectedDayIso,");
    expect(fn).toContain("scheduledTime: calendarTime,");
    expect(fn).toContain("if (isCalendarDayBeforeToday(selectedDayIso, new Date(), timezone)) {");
    expect(fn).toContain("if (xText.length > X_CHARACTER_LIMIT) {");
    expect(fn).not.toContain("fetch(");
    // The jazz-up is one draft call with the announcement as the source, returned for editing rather than queued.
    const jazz = hub.slice(hub.indexOf("async function jazzUpAnnouncement()"), hub.indexOf("\n  }\n", hub.indexOf("async function jazzUpAnnouncement()")));
    expect(jazz).toContain("await generateDraft({ dayLabel: selectedDayLabel, announcement: text }, setAnnouncementStatus);");
    expect(jazz).toContain("if (draft) setAnnouncementAi(draft);");
    expect(hub).toContain("if (options.announcement) {\n        report({ tone: \"success\"");
    expect(hub).toContain("announcement: options.announcement ?? null,");
    expect(hub).toContain("const ANNOUNCEMENT_MAX_LENGTH = 1_000;");
    expect(MAX_ANNOUNCEMENT_LENGTH).toBe(1_000);
    // Queue and day-list captions name the origin.
    expect(hub).toContain("? `${describeDraftSource(item.source)} · ${item.dayLabel}`");
    expect(hub).toContain("Waiting for your approve tap · {describeDraftSource(entry.source)}");
  });
});
