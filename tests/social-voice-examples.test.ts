import { describe, expect, it } from "vitest";
import { MIN_VOICE_EXAMPLE_LENGTH, filterUsableVoiceExamples } from "@/lib/social-voice-examples";
import { VOICE_EXAMPLE_TARGET, voiceTrainingHint } from "@/lib/social-voice-examples";

describe("filterUsableVoiceExamples", () => {
  it("keeps real posts that read like voice examples", () => {
    const result = filterUsableVoiceExamples(
      [
        "gm hoodlums, another green candle for the degens today",
        "we are cooking something special for launch week, stay tuned",
      ].join("\n"),
    );
    expect(result.usable).toHaveLength(2);
    expect(result.rejectedCount).toBe(0);
    expect(result.pastedLineCount).toBe(2);
  });

  it("rejects page furniture pasted alongside real posts (issue #340 repro)", () => {
    const result = filterUsableVoiceExamples(
      [
        "Ads Info",
        "More",
        "© 2026 X Corp.",
        "Log in",
        "Sign up",
        "gm hoodlums, another green candle for the degens today",
        "we are cooking something special for launch week, stay tuned",
      ].join("\n"),
    );
    expect(result.pastedLineCount).toBe(7);
    expect(result.usable).toEqual([
      "gm hoodlums, another green candle for the degens today",
      "we are cooking something special for launch week, stay tuned",
    ]);
    expect(result.rejectedCount).toBe(5);
  });

  it(`drops lines shorter than ${MIN_VOICE_EXAMPLE_LENGTH} characters`, () => {
    const result = filterUsableVoiceExamples(["short one", "another real post about the launch of our token"].join("\n"));
    expect(result.usable).toEqual(["another real post about the launch of our token"]);
  });

  it("drops punctuation-only lines and bare numbers", () => {
    const result = filterUsableVoiceExamples(["---", "***", "12345", "a real voice example about our roadmap"].join("\n"));
    expect(result.usable).toEqual(["a real voice example about our roadmap"]);
  });

  it("de-duplicates case-insensitively while keeping first-seen order", () => {
    const result = filterUsableVoiceExamples(
      ["We are launching soon on Robinhood Chain", "we are launching soon on robinhood chain"].join("\n"),
    );
    expect(result.usable).toEqual(["We are launching soon on Robinhood Chain"]);
    expect(result.rejectedCount).toBe(1);
  });

  it("ignores blank lines when counting pasted lines", () => {
    const result = filterUsableVoiceExamples(["", "  ", "a real voice example about our roadmap", ""].join("\n"));
    expect(result.pastedLineCount).toBe(1);
  });

  it("returns an empty result for empty input", () => {
    const result = filterUsableVoiceExamples("");
    expect(result).toEqual({ pastedLines: [], usable: [], pastedLineCount: 0, rejectedCount: 0 });
  });
});

describe("voiceTrainingHint", () => {
  it("counts down to the design's 20-example target, then reports the voice as trained", () => {
    expect(VOICE_EXAMPLE_TARGET).toBe(20);
    expect(voiceTrainingHint(0)).toBe("Nothing added yet — paste your first example above.");
    expect(voiceTrainingHint(17)).toBe("Add 3 more and the voice locks in properly.");
    expect(voiceTrainingHint(19)).toBe("Add 1 more and the voice locks in properly.");
    expect(voiceTrainingHint(20)).toBe("Perfect — the voice is fully trained.");
    expect(voiceTrainingHint(45)).toBe("Perfect — the voice is fully trained.");
  });

  it("never reports a negative or fractional remainder", () => {
    expect(voiceTrainingHint(-3)).toBe("Nothing added yet — paste your first example above.");
    expect(voiceTrainingHint(2.7)).toBe("Add 18 more and the voice locks in properly.");
  });
});
