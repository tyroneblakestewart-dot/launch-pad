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
