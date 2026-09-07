import { DEFAULT_TONE_DIALS, DEFAULT_WORDS_TO_AVOID, WORDS_TO_AVOID_SEED_VERSION } from "@/lib/social-tone-rules";
import { DEFAULT_QUIET_HOURS } from "@/lib/social-quiet-hours";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteSocialStudioRecord, getSocialStudioRecord, putSocialStudioRecord } from "@/lib/social-studio-db";
import {
  DEFAULT_POSTING_CADENCE,
  DEFAULT_QUEUE_TARGET,
  EMPTY_SOCIAL_STUDIO_RECORD,
  MAX_QUEUE_TARGET,
  type SocialStudioProjectRecord,
} from "@/lib/social-studio-types";
import { createFakeIndexedDB } from "./fake-indexeddb-test-helper";

beforeEach(() => {
  vi.stubGlobal("indexedDB", createFakeIndexedDB());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const RECORD: SocialStudioProjectRecord = {
  voiceProfile: {
    tone: "confident",
    vocabulary: "crypto-native",
    cadence: "short",
    emojiHabits: "one emoji",
    sampleLines: ["a", "b", "c"],
    exampleCount: 3,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  voiceExamples: ["example one", "example two"],
  mascotVisualDNA: {
    characterDescription: "a green dog",
    colourPalette: "lime, navy",
    signatureProps: "chain",
    artStyle: "flat vector",
  },
  mascotReferenceImage: "data:image/png;base64,AAAA",
  queue: [
    {
      id: "queue-1",
      xText: "X text",
      telegramText: "Telegram text",
      artwork: "data:image/png;base64,BBBB",
      source: "manual",
      dayLabel: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  sampleLineFeedback: [
    { text: "a", sentiment: "liked", updatedAt: "2026-01-01T00:00:00.000Z" },
    { text: "b", sentiment: "disliked", updatedAt: "2026-01-01T00:01:00.000Z" },
  ],
  queueTarget: 8,
  postingCadence: "conservative",
  directionBrief: "Push the community angle, big announcement coming Friday",
  sortedVoiceSourceKeys: [],
  wordsToAvoid: ["rug", "guaranteed"],
  wordsToAvoidSeed: WORDS_TO_AVOID_SEED_VERSION,
  toneDials: { humour: "dry", emoji: "none", hashtags: "never", postLength: "short" },
  quietHours: { start: "22:00", end: "08:00" },
  timezone: "Europe/London",
  dailyStartTime: "09:00",
};

describe("per-project AI Social Studio IndexedDB store (issue #332)", () => {
  it("returns the empty record for a project that has never been saved", async () => {
    await expect(getSocialStudioRecord("never-saved")).resolves.toEqual(EMPTY_SOCIAL_STUDIO_RECORD);
  });

  it("round-trips a full record through put and get", async () => {
    await putSocialStudioRecord("project-1", RECORD);
    await expect(getSocialStudioRecord("project-1")).resolves.toEqual(RECORD);
  });

  it("overwrites an existing record for the same project id", async () => {
    await putSocialStudioRecord("project-2", RECORD);
    const updated: SocialStudioProjectRecord = { ...RECORD, queue: [] };
    await putSocialStudioRecord("project-2", updated);
    await expect(getSocialStudioRecord("project-2")).resolves.toEqual(updated);
  });

  it("deletes a stored record", async () => {
    await putSocialStudioRecord("project-3", RECORD);
    await deleteSocialStudioRecord("project-3");
    await expect(getSocialStudioRecord("project-3")).resolves.toEqual(EMPTY_SOCIAL_STUDIO_RECORD);
  });

  it("keeps records for different projects independent", async () => {
    await putSocialStudioRecord("project-a", RECORD);
    await putSocialStudioRecord("project-b", { ...RECORD, voiceExamples: [] });
    await expect(getSocialStudioRecord("project-a")).resolves.toEqual(RECORD);
    await expect(getSocialStudioRecord("project-b")).resolves.toEqual({ ...RECORD, voiceExamples: [] });
  });

  describe("migrating legacy-shaped records on read (issue #350)", () => {
    it("fills in sampleLineFeedback with the default when a pre-#348 record has no such key", async () => {
      const legacy = {
        voiceProfile: RECORD.voiceProfile,
        voiceExamples: RECORD.voiceExamples,
        mascotVisualDNA: RECORD.mascotVisualDNA,
        mascotReferenceImage: RECORD.mascotReferenceImage,
        queue: RECORD.queue,
        // sampleLineFeedback intentionally omitted, as in records saved before issue #348.
      };
      await putSocialStudioRecord("legacy-project", legacy as unknown as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("legacy-project")).resolves.toEqual({
        ...legacy,
        sampleLineFeedback: [],
        queueTarget: DEFAULT_QUEUE_TARGET,
        postingCadence: DEFAULT_POSTING_CADENCE,
        directionBrief: "",
        sortedVoiceSourceKeys: [],
        wordsToAvoid: [...DEFAULT_WORDS_TO_AVOID],
        wordsToAvoidSeed: WORDS_TO_AVOID_SEED_VERSION,
        toneDials: DEFAULT_TONE_DIALS,
        quietHours: DEFAULT_QUIET_HOURS,
        timezone: null,
        dailyStartTime: null,
      });
    });

    it("fills in queueTarget with the default when a pre-#352 record has no such key (issue #352)", async () => {
      const legacy = {
        voiceProfile: RECORD.voiceProfile,
        voiceExamples: RECORD.voiceExamples,
        mascotVisualDNA: RECORD.mascotVisualDNA,
        mascotReferenceImage: RECORD.mascotReferenceImage,
        queue: RECORD.queue,
        sampleLineFeedback: RECORD.sampleLineFeedback,
        // queueTarget intentionally omitted, as in records saved before issue #352.
      };
      await putSocialStudioRecord("legacy-project-3", legacy as unknown as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("legacy-project-3")).resolves.toEqual({
        ...legacy,
        queueTarget: DEFAULT_QUEUE_TARGET,
        postingCadence: DEFAULT_POSTING_CADENCE,
        directionBrief: "",
        sortedVoiceSourceKeys: [],
        wordsToAvoid: [...DEFAULT_WORDS_TO_AVOID],
        wordsToAvoidSeed: WORDS_TO_AVOID_SEED_VERSION,
        toneDials: DEFAULT_TONE_DIALS,
        quietHours: DEFAULT_QUIET_HOURS,
        timezone: null,
        dailyStartTime: null,
      });
    });

    it("fills in postingCadence and directionBrief with their defaults when a pre-#358 record has neither key", async () => {
      const legacy = {
        voiceProfile: RECORD.voiceProfile,
        voiceExamples: RECORD.voiceExamples,
        mascotVisualDNA: RECORD.mascotVisualDNA,
        mascotReferenceImage: RECORD.mascotReferenceImage,
        queue: RECORD.queue,
        sampleLineFeedback: RECORD.sampleLineFeedback,
        queueTarget: RECORD.queueTarget,
        // postingCadence and directionBrief intentionally omitted, as in records saved before issue #358.
      };
      await putSocialStudioRecord("legacy-project-4", legacy as unknown as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("legacy-project-4")).resolves.toEqual({
        ...legacy,
        postingCadence: DEFAULT_POSTING_CADENCE,
        directionBrief: "",
        sortedVoiceSourceKeys: [],
        wordsToAvoid: [...DEFAULT_WORDS_TO_AVOID],
        wordsToAvoidSeed: WORDS_TO_AVOID_SEED_VERSION,
        toneDials: DEFAULT_TONE_DIALS,
        quietHours: DEFAULT_QUIET_HOURS,
        timezone: null,
        dailyStartTime: null,
      });
    });

    it("falls back to the default cadence for an unrecognised stored postingCadence instead of throwing", async () => {
      await putSocialStudioRecord("bad-cadence-1", { ...RECORD, postingCadence: "aggressive" } as unknown as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("bad-cadence-1")).resolves.toMatchObject({ postingCadence: DEFAULT_POSTING_CADENCE });
    });

    it("coerces a non-string directionBrief to empty instead of throwing", async () => {
      await putSocialStudioRecord("bad-brief-1", { ...RECORD, directionBrief: 42 } as unknown as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("bad-brief-1")).resolves.toMatchObject({ directionBrief: "" });
    });

    it("clamps a non-numeric, fractional or out-of-range stored queueTarget instead of throwing", async () => {
      await putSocialStudioRecord("bad-target-1", { ...RECORD, queueTarget: Number.NaN } as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("bad-target-1")).resolves.toMatchObject({ queueTarget: DEFAULT_QUEUE_TARGET });

      await putSocialStudioRecord("bad-target-2", { ...RECORD, queueTarget: 3.6 } as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("bad-target-2")).resolves.toMatchObject({ queueTarget: 4 });

      await putSocialStudioRecord("bad-target-3", { ...RECORD, queueTarget: 0 } as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("bad-target-3")).resolves.toMatchObject({ queueTarget: 1 });

      await putSocialStudioRecord("bad-target-4", { ...RECORD, queueTarget: 999 } as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("bad-target-4")).resolves.toMatchObject({ queueTarget: MAX_QUEUE_TARGET });
    });

    it("fills in voiceExamples and queue with defaults when a legacy record has neither key", async () => {
      const legacy = {
        voiceProfile: null,
        mascotVisualDNA: null,
        mascotReferenceImage: null,
        sampleLineFeedback: [],
      };
      await putSocialStudioRecord("legacy-project-2", legacy as unknown as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("legacy-project-2")).resolves.toEqual(EMPTY_SOCIAL_STUDIO_RECORD);
    });

    it("fills in wordsToAvoid (the design's five words) and the middle tone dials when a pre-Rules-wiring record has neither key, and repairs a corrupt dial", async () => {
      const legacy = { ...RECORD } as Record<string, unknown>;
      delete legacy.wordsToAvoid;
      delete legacy.toneDials;
      await putSocialStudioRecord("legacy-project-rules", legacy as unknown as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("legacy-project-rules")).resolves.toEqual({
        ...RECORD,
        wordsToAvoid: [...DEFAULT_WORDS_TO_AVOID],
        wordsToAvoidSeed: WORDS_TO_AVOID_SEED_VERSION,
        toneDials: DEFAULT_TONE_DIALS,
      });

      await putSocialStudioRecord("corrupt-dials", {
        ...RECORD,
        wordsToAvoid: ["ok", 7, "", "ok", "  spaced   out  "],
        toneDials: { humour: "loud", emoji: "plenty" },
      } as unknown as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("corrupt-dials")).resolves.toMatchObject({
        wordsToAvoid: ["ok", "spaced out"],
        toneDials: { ...DEFAULT_TONE_DIALS, emoji: "plenty" },
      });
    });

    it("adds the four subject words once to a record that saved its own list before they existed, and not again after the user removes one (7 Sep 2026)", async () => {
      const legacy = { ...RECORD, wordsToAvoid: ["rug", "guaranteed"] } as Record<string, unknown>;
      delete legacy.wordsToAvoidSeed;
      await putSocialStudioRecord("legacy-topics", legacy as unknown as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("legacy-topics")).resolves.toMatchObject({
        wordsToAvoid: ["rug", "guaranteed", "racism", "homophobia", "religion", "politics"],
        wordsToAvoidSeed: WORDS_TO_AVOID_SEED_VERSION,
      });

      // Saved with the version after removing "religion": it stays removed.
      await putSocialStudioRecord("seeded-removed", { ...RECORD, wordsToAvoid: ["rug", "racism", "homophobia", "politics"], wordsToAvoidSeed: WORDS_TO_AVOID_SEED_VERSION });
      await expect(getSocialStudioRecord("seeded-removed")).resolves.toMatchObject({ wordsToAvoid: ["rug", "racism", "homophobia", "politics"] });
    });

    it("fills in the design's 23:00 → 07:00 quiet hours when a pre-Calendar-wiring record has no such key, keeps an explicit off, and repairs a corrupt window (7 Sep 2026)", async () => {
      const legacy = { ...RECORD } as Record<string, unknown>;
      delete legacy.quietHours;
      await putSocialStudioRecord("legacy-quiet", legacy as unknown as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("legacy-quiet")).resolves.toEqual({ ...RECORD, quietHours: DEFAULT_QUIET_HOURS });

      await putSocialStudioRecord("quiet-off", { ...RECORD, quietHours: null });
      await expect(getSocialStudioRecord("quiet-off")).resolves.toMatchObject({ quietHours: null });

      await putSocialStudioRecord("quiet-corrupt", { ...RECORD, quietHours: { start: "25:00", end: 7 } } as unknown as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("quiet-corrupt")).resolves.toMatchObject({ quietHours: DEFAULT_QUIET_HOURS });

      await putSocialStudioRecord("quiet-empty-window", { ...RECORD, quietHours: { start: "09:00", end: "09:00" } });
      await expect(getSocialStudioRecord("quiet-empty-window")).resolves.toMatchObject({ quietHours: null });

      // Saved between the two Calendar PRs on 7 Sep 2026: whole hours, read as clock strings.
      await putSocialStudioRecord("quiet-whole-hours", { ...RECORD, quietHours: { startHour: 22, endHour: 8 } } as unknown as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("quiet-whole-hours")).resolves.toMatchObject({ quietHours: { start: "22:00", end: "08:00" } });
    });

    it("follows the device when a record has no zone, or names one this runtime does not know (7 Sep 2026)", async () => {
      const legacy = { ...RECORD } as Partial<SocialStudioProjectRecord>;
      delete legacy.timezone;
      await putSocialStudioRecord("legacy-zone", legacy as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("legacy-zone")).resolves.toMatchObject({ timezone: null });

      await putSocialStudioRecord("bad-zone", { ...RECORD, timezone: "Not/AZone" });
      await expect(getSocialStudioRecord("bad-zone")).resolves.toMatchObject({ timezone: null });

      await putSocialStudioRecord("good-zone", { ...RECORD, timezone: "Asia/Tokyo" });
      await expect(getSocialStudioRecord("good-zone")).resolves.toMatchObject({ timezone: "Asia/Tokyo" });
    });

    it("coerces non-array sampleLineFeedback, voiceExamples and queue to empty arrays instead of throwing", async () => {
      const corrupted = {
        ...RECORD,
        sampleLineFeedback: "not-an-array",
        voiceExamples: null,
        queue: 42,
      };
      await putSocialStudioRecord("corrupted-project", corrupted as unknown as SocialStudioProjectRecord);
      await expect(getSocialStudioRecord("corrupted-project")).resolves.toEqual({
        ...RECORD,
        sampleLineFeedback: [],
        voiceExamples: [],
        queue: [],
      });
    });
  });
});
