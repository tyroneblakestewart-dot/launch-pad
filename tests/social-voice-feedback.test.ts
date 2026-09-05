import { describe, expect, it } from "vitest";
import {
  MAX_REINFORCEMENT_SAMPLE_LINES,
  MAX_STORED_DISLIKED_LINES,
  MAX_STORED_SAMPLE_LINE_FEEDBACK,
  PERSONA_BANK_SIZE,
  clearHalfOfPersonaBank,
  clearPersonaBank,
  isPersonaBankFull,
  likedReinforcementLines,
  toggleSampleLineFeedback,
} from "@/lib/social-voice-feedback";
import type { SampleLineFeedback } from "@/lib/social-studio-types";

function stamp(index: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
}

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

  it("refuses a kept verdict once the persona bank is full instead of evicting an older kept line (owner decision: block until cleared)", () => {
    let feedback: SampleLineFeedback[] = [];
    for (let index = 0; index < PERSONA_BANK_SIZE + 5; index += 1) {
      feedback = toggleSampleLineFeedback(feedback, `Line ${index}.`, "liked", stamp(index));
    }
    expect(feedback).toHaveLength(PERSONA_BANK_SIZE);
    expect(feedback[0].text).toBe("Line 0.");
    expect(feedback.at(-1)?.text).toBe(`Line ${PERSONA_BANK_SIZE - 1}.`);
    expect(isPersonaBankFull(feedback)).toBe(true);
    // Fire is refused too when full; Bin is still allowed.
    expect(toggleSampleLineFeedback(feedback, "One more.", "fire", stamp(99))).toEqual(feedback);
    expect(toggleSampleLineFeedback(feedback, "Nope.", "disliked", stamp(99))).toHaveLength(PERSONA_BANK_SIZE + 1);
  });

  it("caps the bin memory separately so a Bin can never push a kept line out of the bank", () => {
    let feedback: SampleLineFeedback[] = [];
    for (let index = 0; index < 5; index += 1) feedback = toggleSampleLineFeedback(feedback, `Keep ${index}.`, "liked", stamp(index));
    for (let index = 0; index < MAX_STORED_DISLIKED_LINES + 10; index += 1) {
      feedback = toggleSampleLineFeedback(feedback, `Bin ${index}.`, "disliked", stamp(100 + index));
    }
    expect(feedback.filter((entry) => entry.sentiment === "liked")).toHaveLength(5);
    expect(feedback.filter((entry) => entry.sentiment === "disliked")).toHaveLength(MAX_STORED_DISLIKED_LINES);
    expect(feedback).toHaveLength(MAX_STORED_SAMPLE_LINE_FEEDBACK - (PERSONA_BANK_SIZE - 5));
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

describe("persona bank tiers and clearing", () => {
  function bank(): SampleLineFeedback[] {
    let feedback: SampleLineFeedback[] = [];
    for (let index = 0; index < 6; index += 1) feedback = toggleSampleLineFeedback(feedback, `Fire ${index}.`, "fire", stamp(index));
    for (let index = 0; index < 10; index += 1) feedback = toggleSampleLineFeedback(feedback, `Keep ${index}.`, "liked", stamp(10 + index));
    feedback = toggleSampleLineFeedback(feedback, "Binned.", "disliked", stamp(50));
    return feedback;
  }

  it("counts Fire and Sounds right together toward the bank, never Bin", () => {
    expect(PERSONA_BANK_SIZE).toBe(30);
    expect(MAX_REINFORCEMENT_SAMPLE_LINES).toBe(PERSONA_BANK_SIZE);
    expect(isPersonaBankFull(bank())).toBe(false);
  });

  it("Clear 50% drops the oldest half of the kept lines from the Sounds-right tier only — Fire is untouched", () => {
    const cleared = clearHalfOfPersonaBank(bank());
    expect(cleared.filter((entry) => entry.sentiment === "fire")).toHaveLength(6);
    // 16 kept -> remove 8, all from the 10 liked, oldest first.
    const liked = cleared.filter((entry) => entry.sentiment === "liked").map((entry) => entry.text);
    expect(liked).toEqual(["Keep 8.", "Keep 9."]);
    expect(cleared.some((entry) => entry.text === "Binned.")).toBe(true);
  });

  it("Clear 50% returns the bank unchanged when every kept line is on Fire", () => {
    let feedback: SampleLineFeedback[] = [];
    for (let index = 0; index < 4; index += 1) feedback = toggleSampleLineFeedback(feedback, `Fire ${index}.`, "fire", stamp(index));
    expect(clearHalfOfPersonaBank(feedback)).toEqual(feedback);
  });

  it("Clear all empties the bank, Fire included, and keeps only the bin memory", () => {
    const cleared = clearPersonaBank(bank());
    expect(cleared).toEqual([{ text: "Binned.", sentiment: "disliked", updatedAt: stamp(50) }]);
  });

  it("feeds Fire lines first, then Sounds right newest-first, the whole bank, never a binned line", () => {
    const lines = likedReinforcementLines(bank());
    expect(lines).toHaveLength(16);
    expect(lines.slice(0, 6)).toEqual(["Fire 5.", "Fire 4.", "Fire 3.", "Fire 2.", "Fire 1.", "Fire 0."]);
    expect(lines[6]).toBe("Keep 9.");
    expect(lines).not.toContain("Binned.");
  });
});
