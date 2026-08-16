import { describe, expect, it } from "vitest";
import { MAX_REINFORCEMENT_SAMPLE_LINES } from "@/lib/social-voice-feedback";
import { MAX_REINFORCEMENT_SAMPLE_LINE_LENGTH, normaliseLikedSampleLines } from "@/lib/server/social-reinforcement";

describe("normaliseLikedSampleLines", () => {
  it("returns an empty array for non-array input", () => {
    expect(normaliseLikedSampleLines(undefined)).toEqual([]);
    expect(normaliseLikedSampleLines("not an array")).toEqual([]);
  });

  it("keeps only non-empty strings, trimmed", () => {
    expect(normaliseLikedSampleLines(["  liked one  ", "", 42, null, "liked two"])).toEqual([
      "liked one",
      "liked two",
    ]);
  });

  it("drops a line over the per-line length cap", () => {
    const tooLong = "x".repeat(MAX_REINFORCEMENT_SAMPLE_LINE_LENGTH + 1);
    expect(normaliseLikedSampleLines([tooLong, "short line"])).toEqual(["short line"]);
  });

  it(`caps the count at ${MAX_REINFORCEMENT_SAMPLE_LINES}, preserving the given order (client sends most-recent-first)`, () => {
    const many = Array.from({ length: MAX_REINFORCEMENT_SAMPLE_LINES + 5 }, (_, index) => `line ${index}`);
    const result = normaliseLikedSampleLines(many);
    expect(result).toHaveLength(MAX_REINFORCEMENT_SAMPLE_LINES);
    expect(result).toEqual(many.slice(0, MAX_REINFORCEMENT_SAMPLE_LINES));
  });
});
