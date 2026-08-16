import { describe, expect, it } from "vitest";
import {
  MAX_REINFORCEMENT_SAMPLE_LINES,
  MAX_STORED_SAMPLE_LINE_FEEDBACK,
  likedReinforcementLines,
  toggleSampleLineFeedback,
} from "@/lib/social-voice-feedback";
import type { SampleLineFeedback } from "@/lib/social-studio-types";

describe("toggleSampleLineFeedback", () => {
  it("adds a liked entry for a new line", () => {
    const next = toggleSampleLineFeedback([], "First sample line.", "liked", "2026-01-01T00:00:00.000Z");
    expect(next).toEqual([{ text: "First sample line.", sentiment: "liked", updatedAt: "2026-01-01T00:00:00.000Z" }]);
  });

  it("removes the entry when the same sentiment is tapped again (toggle off)", () => {
    const liked = toggleSampleLineFeedback([], "Line one.", "liked", "2026-01-01T00:00:00.000Z");
    const removed = toggleSampleLineFeedback(liked, "Line one.", "liked", "2026-01-01T00:01:00.000Z");
    expect(removed).toEqual([]);
  });

  it("flips a liked line to disliked in one call instead of requiring two taps", () => {
    const liked = toggleSampleLineFeedback([], "Line one.", "liked", "2026-01-01T00:00:00.000Z");
    const flipped = toggleSampleLineFeedback(liked, "Line one.", "disliked", "2026-01-01T00:01:00.000Z");
    expect(flipped).toEqual([{ text: "Line one.", sentiment: "disliked", updatedAt: "2026-01-01T00:01:00.000Z" }]);
  });

  it("keeps feedback for other lines untouched", () => {
    const withOne = toggleSampleLineFeedback([], "Line one.", "liked", "2026-01-01T00:00:00.000Z");
    const withTwo = toggleSampleLineFeedback(withOne, "Line two.", "liked", "2026-01-01T00:01:00.000Z");
    expect(withTwo).toHaveLength(2);
    const untouched = toggleSampleLineFeedback(withTwo, "Line two.", "disliked", "2026-01-01T00:02:00.000Z");
    expect(untouched).toContainEqual({ text: "Line one.", sentiment: "liked", updatedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("ignores a blank line", () => {
    expect(toggleSampleLineFeedback([], "   ", "liked", "2026-01-01T00:00:00.000Z")).toEqual([]);
  });

  it("tolerates undefined/null current feedback (e.g. from a legacy stored record) instead of throwing", () => {
    expect(toggleSampleLineFeedback(undefined, "Line one.", "liked", "2026-01-01T00:00:00.000Z")).toEqual([
      { text: "Line one.", sentiment: "liked", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(toggleSampleLineFeedback(null, "Line one.", "liked", "2026-01-01T00:00:00.000Z")).toEqual([
      { text: "Line one.", sentiment: "liked", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("caps total stored feedback, dropping the oldest entries first", () => {
    let feedback: SampleLineFeedback[] = [];
    for (let index = 0; index < MAX_STORED_SAMPLE_LINE_FEEDBACK + 5; index += 1) {
      feedback = toggleSampleLineFeedback(feedback, `Line ${index}.`, "liked", `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`);
    }
    expect(feedback).toHaveLength(MAX_STORED_SAMPLE_LINE_FEEDBACK);
    expect(feedback[0].text).toBe("Line 5.");
    expect(feedback.at(-1)?.text).toBe(`Line ${MAX_STORED_SAMPLE_LINE_FEEDBACK + 4}.`);
  });
});

describe("likedReinforcementLines", () => {
  it("returns only liked lines, excluding disliked ones", () => {
    const feedback: SampleLineFeedback[] = [
      { text: "Liked line.", sentiment: "liked", updatedAt: "2026-01-01T00:00:00.000Z" },
      { text: "Disliked line.", sentiment: "disliked", updatedAt: "2026-01-01T00:01:00.000Z" },
    ];
    expect(likedReinforcementLines(feedback)).toEqual(["Liked line."]);
  });

  it("orders most-recently-liked first", () => {
    const feedback: SampleLineFeedback[] = [
      { text: "Older like.", sentiment: "liked", updatedAt: "2026-01-01T00:00:00.000Z" },
      { text: "Newer like.", sentiment: "liked", updatedAt: "2026-01-02T00:00:00.000Z" },
    ];
    expect(likedReinforcementLines(feedback)).toEqual(["Newer like.", "Older like."]);
  });

  it(`caps reinforcement lines at ${MAX_REINFORCEMENT_SAMPLE_LINES}, keeping the most recent`, () => {
    const feedback: SampleLineFeedback[] = Array.from({ length: MAX_REINFORCEMENT_SAMPLE_LINES + 3 }, (_, index) => ({
      text: `Line ${index}.`,
      sentiment: "liked" as const,
      updatedAt: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    const result = likedReinforcementLines(feedback);
    expect(result).toHaveLength(MAX_REINFORCEMENT_SAMPLE_LINES);
    expect(result[0]).toBe(`Line ${MAX_REINFORCEMENT_SAMPLE_LINES + 2}.`);
  });

  it("returns an empty array when nothing is liked", () => {
    expect(likedReinforcementLines([])).toEqual([]);
  });

  it("degrades to no likes yet instead of throwing when fed undefined/null (issue #350)", () => {
    expect(likedReinforcementLines(undefined)).toEqual([]);
    expect(likedReinforcementLines(null)).toEqual([]);
  });
});
