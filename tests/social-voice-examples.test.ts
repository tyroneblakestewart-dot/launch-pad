import { describe, expect, it } from "vitest";
import { MIN_VOICE_EXAMPLE_LENGTH, filterUsableVoiceExamples } from "@/lib/social-voice-examples";
import {
  MAX_VOICE_EXAMPLE_LENGTH,
  VOICE_EXAMPLE_TARGET,
  addVoiceExamples,
  cleanPastedPosts,
  describeAddVoiceExamplesResult,
  stripPostChrome,
  voiceTrainingHint,
} from "@/lib/social-voice-examples";

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
    // No chrome anywhere in the paste keeps the original one-example-per-line contract.
    expect(cleanPastedPosts("one\ntwo")).toEqual(["one", "two"]);
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

  it("keeps a multi-paragraph X post as ONE example, dropping the alt text, name, handle, separator, date and tags (the owner's Giggle Academy paste)", () => {
    const pasted = [
      "Square profile picture",
      "Giggle Academy",
      "@GiggleAcademy",
      "·",
      "Sep 4",
      "Aww, we love this resolution! 🎶❤️ Learning Christmas songs in English and then performing them at school is such a fun way to build confidence and practice English!",
      "",
      "Keep singing, keep learning, and keep giggling! ✨🎤",
      "",
      "Maybe Mai and Max can be your English practice buddy along the way! 😉",
      "",
      "#GiggleAcademy #BackToSchool #NewSemesterResolution #LearnEnglish #LearnWithMax",
    ].join("\n");
    const posts = cleanPastedPosts(pasted);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatch(/^Aww, we love this resolution!/);
    expect(posts[0]).toMatch(/along the way! 😉$/);
    expect(posts[0]).not.toContain("Giggle Academy");
    expect(posts[0]).not.toContain("Square profile picture");
    expect(posts[0]).not.toContain("·");
    expect(posts[0]).not.toContain("#GiggleAcademy");
  });

  it("splits two multi-paragraph posts only at the next name/handle pair, never at their paragraph breaks", () => {
    const pasted = [
      "First Person",
      "@first",
      "Paragraph one of the first post.",
      "",
      "Paragraph two of the first post.",
      "Second Person",
      "@second",
      "The second post.",
    ].join("\n");
    expect(cleanPastedPosts(pasted)).toEqual([
      "Paragraph one of the first post. Paragraph two of the first post.",
      "The second post.",
    ]);
  });
});

describe("addVoiceExamples (the Add example step)", () => {
  const GIGGLE = [
    "Square profile picture",
    "Giggle Academy",
    "@GiggleAcademy",
    "·",
    "Sep 4",
    "Aww, we love this resolution! 🎶❤️ Learning Christmas songs in English is such a fun way to build confidence!",
    "",
    "Keep singing, keep learning, and keep giggling! ✨🎤",
    "",
    "#GiggleAcademy #BackToSchool",
  ].join("\n");

  it("adds one cleaned post as one example, reporting the chrome it dropped, and leaves existing examples untouched", () => {
    const result = addVoiceExamples(["An earlier example that stays exactly where it was."], GIGGLE);
    expect(result.added).toHaveLength(1);
    expect(result.examples).toHaveLength(2);
    expect(result.examples[0]).toBe("An earlier example that stays exactly where it was.");
    expect(result.examples[1]).toMatch(/^Aww, we love this resolution!/);
    expect(result.examples[1]).not.toContain("#GiggleAcademy");
    expect(result.rejected).toEqual([]);
    expect(result.chromeLinesRemoved).toBe(6);
    expect(describeAddVoiceExamplesResult(result)).toBe("Added 1 example · 6 lines of names, handles, dates or hashtags removed.");
  });

  it("refuses a post over the server's 500-character cap by name, at Add time, without touching the list", () => {
    const long = "x".repeat(MAX_VOICE_EXAMPLE_LENGTH + 12);
    const result = addVoiceExamples(["kept example post here"], long);
    expect(result.added).toEqual([]);
    expect(result.examples).toEqual(["kept example post here"]);
    expect(result.rejected).toEqual([{ text: long, reason: "too_long" }]);
    expect(describeAddVoiceExamplesResult(result)).toContain(`one post is ${MAX_VOICE_EXAMPLE_LENGTH + 12} characters — ${MAX_VOICE_EXAMPLE_LENGTH} is the max`);
  });

  it("refuses duplicates case-insensitively and too-short posts, and stops at the 20 cap", () => {
    const existing = Array.from({ length: VOICE_EXAMPLE_TARGET - 1 }, (_, index) => `Existing example number ${index} here.`);
    const result = addVoiceExamples(existing, "EXISTING EXAMPLE NUMBER 3 HERE.\n\ntiny\n\nA brand new post that fits in the last slot.\n\nOne more that no longer fits anywhere.");
    expect(result.added).toEqual(["A brand new post that fits in the last slot."]);
    expect(result.examples).toHaveLength(VOICE_EXAMPLE_TARGET);
    expect(result.rejected.map((entry) => entry.reason)).toEqual(["duplicate", "too_short", "limit"]);
    const summary = describeAddVoiceExamplesResult(result);
    expect(summary).toContain("Added 1 example");
    expect(summary).toContain("1 already in your examples");
    expect(summary).toContain("1 too short to teach anything");
    expect(summary).toContain(`1 not added — ${VOICE_EXAMPLE_TARGET} is the most the AI reads`);
  });

  it("says so plainly when the box had nothing usable", () => {
    const result = addVoiceExamples([], "   \n\n");
    expect(result.added).toEqual([]);
    expect(describeAddVoiceExamplesResult(result)).toBe("Nothing to add — paste a post first.");
  });
});
