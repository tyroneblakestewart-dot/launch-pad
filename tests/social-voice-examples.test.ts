import { describe, expect, it } from "vitest";
import { MIN_VOICE_EXAMPLE_LENGTH, filterUsableVoiceExamples } from "@/lib/social-voice-examples";
import { VOICE_EXAMPLE_TARGET, cleanPastedPosts, stripPostChrome, voiceTrainingHint } from "@/lib/social-voice-examples";

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

describe("cleanPastedPosts", () => {
  it("keeps only what the person wrote from a copied X post (the owner's own example)", () => {
    const pasted = [
      "Michaelis Renvicus",
      "@michaelisrenvic",
      "Macron and his wife leaving Downing Street yesterday…",
      "Apparently she just wanted to phone home.",
      "",
      "#Macron #France #UKPolitics #PoliticalSatire",
    ].join("\n");
    expect(cleanPastedPosts(pasted)).toEqual([
      "Macron and his wife leaving Downing Street yesterday… Apparently she just wanted to phone home.",
    ]);
  });

  it("drops handle-and-time lines, engagement counts and Show more, and splits back-to-back posts at the next name/handle pair", () => {
    const pasted = [
      "Someone Else",
      "@else · 2h",
      "GM to everyone still refreshing the chart.",
      "1.2K likes 40 reposts",
      "Show more",
      "Another Name",
      "@another",
      "No roadmap, no promises.",
      "#gm",
    ].join("\n");
    expect(cleanPastedPosts(pasted)).toEqual(["GM to everyone still refreshing the chart.", "No roadmap, no promises."]);
  });

  it("leaves plain pasted lines exactly as they are, one post per blank-line-separated block", () => {
    expect(cleanPastedPosts("Just a plain line of text with no chrome at all.\n\nSecond plain post.")).toEqual([
      "Just a plain line of text with no chrome at all.",
      "Second plain post.",
    ]);
    expect(cleanPastedPosts("one\ntwo")).toEqual(["one two"]);
  });

  it("returns nothing for a paste that was only chrome, and handles Windows line endings", () => {
    expect(cleanPastedPosts("Name\r\n@handle\r\n#tag #tag2\r\n3:14 PM · Sep 4, 2026\r\n")).toEqual([]);
    expect(cleanPastedPosts("")).toEqual([]);
  });

  it("keeps hashtags that sit inside a sentence — only hashtag-only trailing lines are tags", () => {
    expect(stripPostChrome(["Loving the #Hoodlums energy today", "#gm #wagmi"])).toBe("Loving the #Hoodlums energy today");
  });

  it("does not treat an ordinary first line as a display name unless an @handle follows it", () => {
    expect(stripPostChrome(["Short punchy opener.", "Then the rest of the thought."])).toBe(
      "Short punchy opener. Then the rest of the thought.",
    );
  });
});
