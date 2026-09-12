// Settings & Rules, wired (owner direction, 6 Sep 2026): the "Words to
// avoid" list and the four "How it should sound" dials the design has always
// drawn are now real per-project settings that every AI draft obeys. Shared
// by the client (chips, selects, IndexedDB record) and the server (prompt
// instructions and the deterministic post-generation check), so both sides
// agree on exactly what each option means.

export type HumourLevel = "dry" | "playful" | "full-degen";
export type EmojiLevel = "none" | "a-little" | "plenty";
export type HashtagLevel = "never" | "one-or-two" | "lots";
export type PostLengthLevel = "short" | "medium" | "long";

export type ToneDials = {
  humour: HumourLevel;
  emoji: EmojiLevel;
  hashtags: HashtagLevel;
  postLength: PostLengthLevel;
};

/** The design's middle option on every dial — what the disabled mock-up always showed. */
export const DEFAULT_TONE_DIALS: ToneDials = {
  humour: "playful",
  emoji: "a-little",
  hashtags: "one-or-two",
  postLength: "medium",
};

export type ToneDialKey = keyof ToneDials;

export const TONE_DIAL_OPTIONS: ReadonlyArray<{
  key: ToneDialKey;
  label: string;
  options: ReadonlyArray<{ value: ToneDials[ToneDialKey]; label: string }>;
}> = [
  {
    key: "humour",
    label: "Humour",
    options: [
      { value: "dry", label: "Dry" },
      { value: "playful", label: "Playful" },
      { value: "full-degen", label: "Full degen" },
    ],
  },
  {
    key: "emoji",
    label: "Emoji",
    options: [
      { value: "none", label: "None" },
      { value: "a-little", label: "A little" },
      { value: "plenty", label: "Plenty" },
    ],
  },
  {
    key: "hashtags",
    label: "Hashtags",
    options: [
      { value: "never", label: "Never" },
      { value: "one-or-two", label: "One or two" },
      { value: "lots", label: "Lots" },
    ],
  },
  {
    key: "postLength",
    label: "Post length",
    options: [
      { value: "short", label: "Short" },
      { value: "medium", label: "Medium" },
      { value: "long", label: "Long" },
    ],
  },
];

function isOption(key: ToneDialKey, value: unknown): boolean {
  const dial = TONE_DIAL_OPTIONS.find((item) => item.key === key);
  return Boolean(dial && dial.options.some((option) => option.value === value));
}

/** Migrate-on-read: any missing or unrecognised dial falls back to its default rather than rejecting the record. */
export function normaliseToneDials(raw: unknown): ToneDials {
  const candidate = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<ToneDialKey, unknown>>;
  return {
    humour: isOption("humour", candidate.humour) ? (candidate.humour as HumourLevel) : DEFAULT_TONE_DIALS.humour,
    emoji: isOption("emoji", candidate.emoji) ? (candidate.emoji as EmojiLevel) : DEFAULT_TONE_DIALS.emoji,
    hashtags: isOption("hashtags", candidate.hashtags) ? (candidate.hashtags as HashtagLevel) : DEFAULT_TONE_DIALS.hashtags,
    postLength: isOption("postLength", candidate.postLength) ? (candidate.postLength as PostLengthLevel) : DEFAULT_TONE_DIALS.postLength,
  };
}

/**
 * Subjects the AI must steer clear of entirely (owner direction, 7 Sep
 * 2026: "add a few crucial words — racism, homophobia, religion — the user
 * can remove them, but at least we set the tone; make sure these words and
 * anything around them are avoided"). Listing one of these words bans the
 * whole family — "racism" also catches "racist" and "racial", "religion"
 * catches "religious" — and the prompt tells the model to avoid the subject,
 * not just the word. A user who removes one removes the whole family.
 */
export const TOPIC_WORDS_TO_AVOID: readonly string[] = ["racism", "homophobia", "religion", "politics"];

const TOPIC_WORD_FAMILIES: ReadonlyArray<{ keys: readonly string[]; pattern: RegExp }> = [
  { keys: ["racism", "racist", "racial"], pattern: /(?<![a-z0-9])(?:racism|racists?|racial(?:ly)?|race[- ]?bait\w*)(?![a-z0-9])/iu },
  { keys: ["homophobia", "homophobic", "homophobe"], pattern: /(?<![a-z0-9])(?:homophob\w*|anti-?gay)(?![a-z0-9])/iu },
  { keys: ["religion", "religious"], pattern: /(?<![a-z0-9])(?:religio\w*)(?![a-z0-9])/iu },
  { keys: ["politics", "political", "politician"], pattern: /(?<![a-z0-9])(?:politic\w*)(?![a-z0-9])/iu },
  { keys: ["sexism", "sexist"], pattern: /(?<![a-z0-9])(?:sexis[mt]s?)(?![a-z0-9])/iu },
  { keys: ["transphobia", "transphobic"], pattern: /(?<![a-z0-9])(?:transphob\w*)(?![a-z0-9])/iu },
];

/** The family regex for a listed word, when it names one of the subjects above; null for an ordinary banned word. */
export function topicWordFamily(word: string): RegExp | null {
  const key = word.trim().toLowerCase();
  return TOPIC_WORD_FAMILIES.find((family) => family.keys.includes(key))?.pattern ?? null;
}

/** The design's five example chips plus the four subject words — the real defaults for a new project. */
export const DEFAULT_WORDS_TO_AVOID: readonly string[] = ["guaranteed", "financial advice", "to the moon", "rug", "100x", ...TOPIC_WORDS_TO_AVOID];

/**
 * Bumped whenever the default list gains words every existing project
 * should also get once (7 Sep 2026: the four subject words). A record
 * below this version has the new defaults added on read; a user who then
 * removes one is not re-seeded, because the record saves the version.
 */
export const WORDS_TO_AVOID_SEED_VERSION = 2;

/** Adds the subject words a record saved before the current seed version never had, respecting the cap; the list is otherwise untouched. */
export function seedWordsToAvoid(words: readonly string[], seedVersion: unknown): { words: string[]; seedVersion: number } {
  const current = typeof seedVersion === "number" && Number.isFinite(seedVersion) ? seedVersion : 1;
  if (current >= WORDS_TO_AVOID_SEED_VERSION) return { words: [...words], seedVersion: current };
  const seen = new Set(words.map((word) => word.toLowerCase()));
  const next = [...words];
  for (const word of TOPIC_WORDS_TO_AVOID) {
    if (seen.has(word) || next.length >= MAX_WORDS_TO_AVOID) continue;
    next.push(word);
    seen.add(word);
  }
  return { words: next, seedVersion: WORDS_TO_AVOID_SEED_VERSION };
}
export const MAX_WORDS_TO_AVOID = 30;
export const MAX_WORD_TO_AVOID_LENGTH = 40;

function cleanWord(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_WORD_TO_AVOID_LENGTH) : "";
}

/** Trims, de-duplicates case-insensitively, drops empties and caps the list. A non-array (records saved before this field existed) yields the defaults. */
export function normaliseWordsToAvoid(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_WORDS_TO_AVOID];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const item of raw) {
    const word = cleanWord(item);
    const key = word.toLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    words.push(word);
    if (words.length >= MAX_WORDS_TO_AVOID) break;
  }
  return words;
}

export type AddWordToAvoidResult =
  | { status: "added"; words: string[] }
  | { status: "empty" }
  | { status: "duplicate" }
  | { status: "limit" };

export function addWordToAvoid(existing: string[], input: string): AddWordToAvoidResult {
  const word = cleanWord(input);
  if (!word) return { status: "empty" };
  if (existing.some((item) => item.toLowerCase() === word.toLowerCase())) return { status: "duplicate" };
  if (existing.length >= MAX_WORDS_TO_AVOID) return { status: "limit" };
  return { status: "added", words: [...existing, word] };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case-insensitive, boundary-aware match — "rug" never fires on "rugby",
 * "100x" fires on "100x" but not "1100x", and a multi-word phrase matches
 * across any whitespace. Returns the avoided words found, in list order.
 */
export function findAvoidedWords(text: string, words: readonly string[]): string[] {
  const haystack = text.replace(/\s+/g, " ");
  return words.filter((word) => {
    const family = topicWordFamily(word);
    if (family) return family.test(haystack);
    const pattern = escapeRegExp(word.trim()).replace(/ /g, "\\s+");
    if (!pattern) return false;
    return new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`, "iu").test(haystack);
  });
}

/** X hard cap stays 280; the dial only lowers the target the model aims for. */
export const X_LENGTH_CEILING: Record<PostLengthLevel, number> = { short: 120, medium: 200, long: 280 };

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

export function containsEmoji(text: string): boolean {
  return EMOJI_PATTERN.test(text);
}

export function containsHashtag(text: string): boolean {
  return /(^|[^\w&])#[\p{L}\p{N}_]+/u.test(text);
}

/** Prompt lines for the developer message — one per dial, in plain imperative English the model follows literally. */
export function toneDialInstructions(dials: ToneDials): string[] {
  const humour = {
    dry: "Humour: dry — deadpan, understated, no exclamation marks; let the wit sit under the surface.",
    playful: "Humour: playful — light and fun, a wink here and there, never try-hard.",
    "full-degen": "Humour: full degen — loud, chaotic crypto-native energy, unhinged in a good way, still coherent.",
  }[dials.humour];
  const emoji = {
    none: "Emoji: none — do not use a single emoji in either draft.",
    "a-little": "Emoji: a little — at most two emoji in the X draft and at most three in the Telegram draft, only where they add something.",
    plenty: "Emoji: plenty — lean into emoji as part of the voice, several per post, still readable.",
  }[dials.emoji];
  const hashtags = {
    never: "Hashtags: never — no hashtags anywhere in either draft.",
    "one-or-two": "Hashtags: one or two at most on the X draft, only when they genuinely add value, never as a reflexive sign-off; none needed on Telegram.",
    lots: "Hashtags: lots — the user WANTS hashtags: close the X draft with three to five relevant hashtags and add a few to the Telegram draft.",
  }[dials.hashtags];
  const length = {
    short: `Post length: short — keep the X draft to about ${X_LENGTH_CEILING.short} characters or fewer (one or two punchy lines), and the Telegram draft to two or three short sentences.`,
    medium: `Post length: medium — aim for an X draft of roughly 120 to ${X_LENGTH_CEILING.medium} characters, and a Telegram draft of a short paragraph.`,
    long: `Post length: long — use most of the ${X_LENGTH_CEILING.long}-character X limit, and let the Telegram draft run to a fuller two-paragraph post.`,
  }[dials.postLength];
  return [humour, emoji, hashtags, length];
}

/** The hard "never say these" line, or an empty string when the list is empty (the route then adds nothing). */
export function wordsToAvoidInstruction(words: readonly string[]): string {
  if (words.length === 0) return "";
  const topics = words.filter((word) => topicWordFamily(word) !== null);
  return [
    `The user has banned these words and phrases — never use any of them, in any form, in either draft: ${words.map((word) => `"${word}"`).join(", ")}.`,
    topics.length
      ? `Where a banned word names a subject (${topics.map((word) => `"${word}"`).join(", ")}), stay away from the subject itself, not just the word: no jokes, comparisons, nods, slang or coded references around it, and nothing that could be read as a take on it.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
