import { describe, expect, it } from "vitest";
import {
  DEFAULT_TONE_DIALS,
  DEFAULT_WORDS_TO_AVOID,
  TOPIC_WORDS_TO_AVOID,
  WORDS_TO_AVOID_SEED_VERSION,
  seedWordsToAvoid,
  topicWordFamily,
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
    // The design's five plus the four subject words (owner direction, 7 Sep 2026).
    expect(DEFAULT_WORDS_TO_AVOID).toEqual(["guaranteed", "financial advice", "to the moon", "rug", "100x", "racism", "homophobia", "religion", "politics"]);
    expect(TOPIC_WORDS_TO_AVOID).toEqual(["racism", "homophobia", "religion", "politics"]);
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

  it("writes the prompt ban line only when there is something to ban, and tells the model to avoid a subject word's whole subject", () => {
    expect(wordsToAvoidInstruction([])).toBe("");
    const plain = wordsToAvoidInstruction(["rug", "100x"]);
    expect(plain).toContain('never use any of them, in any form, in either draft: "rug", "100x".');
    expect(plain).not.toContain("stay away from the subject itself");
    const withTopics = wordsToAvoidInstruction(["rug", "racism", "religion"]);
    expect(withTopics).toContain('Where a banned word names a subject ("racism", "religion"), stay away from the subject itself, not just the word');
    expect(withTopics).toContain("no jokes, comparisons, nods, slang or coded references around it");
  });

  it("a subject word bans its whole family — and anything around it — while ordinary words stay boundary-exact", () => {
    expect(findAvoidedWords("that racist take was bad", ["racism"])).toEqual(["racism"]);
    expect(findAvoidedWords("racial tension, race-baiting again", ["racism"])).toEqual(["racism"]);
    expect(findAvoidedWords("a homophobic comment", ["homophobia"])).toEqual(["homophobia"]);
    expect(findAvoidedWords("deeply religious folks", ["religion"])).toEqual(["religion"]);
    expect(findAvoidedWords("politicians and political takes", ["politics"])).toEqual(["politics"]);
    expect(findAvoidedWords("sexist joke", ["sexism"])).toEqual(["sexism"]);
    expect(findAvoidedWords("transphobic remark", ["transphobia"])).toEqual(["transphobia"]);
    // Listing a family member bans the family too.
    expect(findAvoidedWords("racism is bad", ["racist"])).toEqual(["racist"]);
    // Families never fire inside unrelated words, and never for words that are not subjects.
    expect(findAvoidedWords("a race to the finish, the policy paper, the relic", ["racism", "politics", "religion"])).toEqual([]);
    expect(findAvoidedWords("Rugby season", ["rug"])).toEqual([]);
    expect(topicWordFamily("Racism")).not.toBeNull();
    expect(topicWordFamily("rug")).toBeNull();
  });

  it("seeds the subject words once into a record saved before they existed, and never again once the record carries the version", () => {
    expect(seedWordsToAvoid(["rug", "100x"], undefined)).toEqual({ words: ["rug", "100x", "racism", "homophobia", "religion", "politics"], seedVersion: WORDS_TO_AVOID_SEED_VERSION });
    expect(seedWordsToAvoid(["rug", "Racism"], 1)).toEqual({ words: ["rug", "Racism", "homophobia", "religion", "politics"], seedVersion: WORDS_TO_AVOID_SEED_VERSION });
    // Already seeded: a removed subject word stays removed.
    expect(seedWordsToAvoid(["rug"], WORDS_TO_AVOID_SEED_VERSION)).toEqual({ words: ["rug"], seedVersion: WORDS_TO_AVOID_SEED_VERSION });
    // The cap is respected.
    const full = Array.from({ length: MAX_WORDS_TO_AVOID }, (_, index) => `w${index}`);
    expect(seedWordsToAvoid(full, 1).words).toHaveLength(MAX_WORDS_TO_AVOID);
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
