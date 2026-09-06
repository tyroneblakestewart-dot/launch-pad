import { describe, expect, it } from "vitest";
import {
  DEFAULT_TONE_DIALS,
  DEFAULT_WORDS_TO_AVOID,
  MAX_WORDS_TO_AVOID,
  TONE_DIAL_OPTIONS,
  X_LENGTH_CEILING,
  addWordToAvoid,
  containsEmoji,
  containsHashtag,
  findAvoidedWords,
  normaliseToneDials,
  normaliseWordsToAvoid,
  toneDialInstructions,
  wordsToAvoidInstruction,
} from "@/lib/social-tone-rules";

describe("tone dials (Settings & Rules, 6 Sep 2026)", () => {
  it("offers the design's four dials with three options each, defaulting to the middle option — what the disabled mock-up always showed", () => {
    expect(TONE_DIAL_OPTIONS.map((dial) => dial.label)).toEqual(["Humour", "Emoji", "Hashtags", "Post length"]);
    for (const dial of TONE_DIAL_OPTIONS) {
      expect(dial.options).toHaveLength(3);
      expect(dial.options[1].value).toBe(DEFAULT_TONE_DIALS[dial.key]);
    }
    expect(TONE_DIAL_OPTIONS.map((dial) => dial.options.map((option) => option.label))).toEqual([
      ["Dry", "Playful", "Full degen"],
      ["None", "A little", "Plenty"],
      ["Never", "One or two", "Lots"],
      ["Short", "Medium", "Long"],
    ]);
  });

  it("normalises a missing, partial or corrupt record to defaults without throwing", () => {
    expect(normaliseToneDials(undefined)).toEqual(DEFAULT_TONE_DIALS);
    expect(normaliseToneDials("nope")).toEqual(DEFAULT_TONE_DIALS);
    expect(normaliseToneDials({ humour: "full-degen", emoji: "loud", hashtags: 3 })).toEqual({ ...DEFAULT_TONE_DIALS, humour: "full-degen" });
  });

  it("turns every dial into one plain imperative line, with the length line naming the X ceiling", () => {
    const lines = toneDialInstructions({ humour: "dry", emoji: "none", hashtags: "never", postLength: "short" });
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Humour: dry/);
    expect(lines[1]).toBe("Emoji: none — do not use a single emoji in either draft.");
    expect(lines[2]).toBe("Hashtags: never — no hashtags anywhere in either draft.");
    expect(lines[3]).toContain(`${X_LENGTH_CEILING.short} characters or fewer`);
    expect(toneDialInstructions({ ...DEFAULT_TONE_DIALS, hashtags: "lots" })[2]).toContain("the user WANTS hashtags");
    expect(X_LENGTH_CEILING.long).toBe(280);
  });
});

describe("words to avoid", () => {
  it("defaults a record without the field to the design's five words, and cleans a real list (trim, collapse, case-insensitive dedupe, cap)", () => {
    expect(normaliseWordsToAvoid(undefined)).toEqual([...DEFAULT_WORDS_TO_AVOID]);
    expect(DEFAULT_WORDS_TO_AVOID).toEqual(["guaranteed", "financial advice", "to the moon", "rug", "100x"]);
    expect(normaliseWordsToAvoid(["  Rug ", "rug", "RUG", 4, "", "to   the  moon"])).toEqual(["Rug", "to the moon"]);
    expect(normaliseWordsToAvoid([])).toEqual([]);
    expect(normaliseWordsToAvoid(Array.from({ length: 50 }, (_, index) => `w${index}`))).toHaveLength(MAX_WORDS_TO_AVOID);
    expect(normaliseWordsToAvoid(["x".repeat(100)])[0]).toHaveLength(40);
  });

  it("adds a word with every failure mode named rather than silently ignored", () => {
    expect(addWordToAvoid(["rug"], "  ")).toEqual({ status: "empty" });
    expect(addWordToAvoid(["rug"], "RUG")).toEqual({ status: "duplicate" });
    expect(addWordToAvoid(Array.from({ length: MAX_WORDS_TO_AVOID }, (_, index) => `w${index}`), "new")).toEqual({ status: "limit" });
    expect(addWordToAvoid(["rug"], " moon mission ")).toEqual({ status: "added", words: ["rug", "moon mission"] });
  });

  it("matches on word boundaries, case-insensitively, across whitespace — never inside another word", () => {
    const words = ["rug", "100x", "to the moon", "financial advice"];
    expect(findAvoidedWords("Rugby season and a 1100x multiplier", words)).toEqual([]);
    expect(findAvoidedWords("No RUG here, just vibes", words)).toEqual(["rug"]);
    expect(findAvoidedWords("straight to   the\nmoon, 100x soon", words)).toEqual(["100x", "to the moon"]);
    expect(findAvoidedWords("not financial-advice", words)).toEqual([]);
    expect(findAvoidedWords("anything", [])).toEqual([]);
  });

  it("writes the prompt ban line only when there is something to ban", () => {
    expect(wordsToAvoidInstruction([])).toBe("");
    expect(wordsToAvoidInstruction(["rug", "100x"])).toContain('never use any of them, in any form, in either draft: "rug", "100x".');
  });
});

describe("emoji and hashtag detection", () => {
  it("detects emoji and hashtags, ignoring cashtags, ampersand-escapes and bare # signs", () => {
    expect(containsEmoji("gm 🚀")).toBe(true);
    expect(containsEmoji("gm frens")).toBe(false);
    expect(containsHashtag("we ride #HOODS")).toBe(true);
    expect(containsHashtag("$HOODS is live, # 1 in our hearts")).toBe(false);
    expect(containsHashtag("H&#39;s")).toBe(false);
  });
});
