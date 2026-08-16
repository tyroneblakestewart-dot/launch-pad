import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteSocialStudioRecord, getSocialStudioRecord, putSocialStudioRecord } from "@/lib/social-studio-db";
import { EMPTY_SOCIAL_STUDIO_RECORD, type SocialStudioProjectRecord } from "@/lib/social-studio-types";
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
});
