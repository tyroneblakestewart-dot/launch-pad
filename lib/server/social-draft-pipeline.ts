import { extractOutputText, type OpenAIResponse } from "@/lib/server/generate-site-style";
import { MAX_REINFORCEMENT_SAMPLE_LINES } from "@/lib/social-voice-feedback";
import type { SocialDraft, VoiceProfile } from "@/lib/social-studio-types";

export const X_DRAFT_CHARACTER_LIMIT = 280;

export type DraftProject = {
  name: string;
  ticker: string;
  description: string;
  chain: "solana" | "robinhood";
  contractAddress: string;
};

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    xText: { type: "string", minLength: 5, maxLength: 320 },
    telegramText: { type: "string", minLength: 5, maxLength: 800 },
  },
  required: ["xText", "telegramText"],
  additionalProperties: false,
} as const;

function voiceInstruction(voiceProfile: VoiceProfile | null): string {
  if (!voiceProfile) {
    return "No taught voice is available yet — write in a confident, community-friendly crypto-native tone.";
  }
  return [
    "Write in the project's taught voice, described below. Match it closely without copying any sample line verbatim.",
    `Tone: ${voiceProfile.tone}`,
    `Vocabulary: ${voiceProfile.vocabulary}`,
    `Cadence: ${voiceProfile.cadence}`,
    `Emoji habits: ${voiceProfile.emojiHabits}`,
  ].join("\n");
}

/** How many of the user's real pasted posts ride along on any one draft request (issue #360). */
const VOICE_EXAMPLES_PER_DRAFT = 5;
const VOICE_EXAMPLE_TRUNCATE_LENGTH = 400;
const MAX_RECENT_DRAFTS_CONTEXT = 5;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/**
 * Deterministic circular window over `items`, sized to `count`. Advancing
 * `offset` by `count` between calls walks a full rotation through every
 * example roughly once before repeating, instead of the same handful landing
 * in every draft request (issue #360 cause 1).
 */
function rotatingSample(items: string[], count: number, offset: number): string[] {
  if (items.length === 0) return [];
  const size = Math.min(count, items.length);
  const start = ((offset % items.length) + items.length) % items.length;
  return Array.from({ length: size }, (_, index) => items[(start + index) % items.length]);
}

/**
 * Strips leading punctuation/emoji/whitespace (but never a leading `$`, which
 * is part of a ticker opener) so identity matching only cares about the first
 * real word, not what decorates it (issue #366).
 */
function stripLeadingDecoration(text: string): string {
  return text.replace(/^[^\p{L}\p{N}$]+/u, "");
}

/**
 * True when `text` opens with the project's name or ticker (with or without
 * a leading `$`), case-insensitively and token-aware — a short ticker like
 * "DOOM" must not falsely match a longer word like "doomsday" (issue #366).
 */
function textStartsWithIdentity(text: string, project: { name: string; ticker: string }): boolean {
  const stripped = stripLeadingDecoration(text.trim()).toLowerCase();
  if (!stripped) return false;
  const identities = [project.ticker, project.name].map((value) => value.trim().toLowerCase()).filter(Boolean);
  return identities.some((identity) => {
    const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^\\$?${escaped}(?![\\p{L}\\p{N}])`, "u");
    return pattern.test(stripped);
  });
}

/** Real posts supplement, never replace, the flattened voice-profile summary above (issue #360 cause 1). */
function voiceExamplesInstruction(examples: string[]): string {
  if (examples.length === 0) return "";
  return [
    `Here are ${examples.length} real posts written by the user, for style reference only — never copy, quote or lightly reword any line from these:`,
    ...examples.map((example, index) => `${index + 1}. ${example}`),
  ].join("\n");
}

/** Half the X character limit — the hard ceiling for the one-liner angle (issue #362 cause 2). */
const ONE_LINER_MAX_LENGTH = Math.floor(X_DRAFT_CHARACTER_LIMIT / 2);

/**
 * Angles a draft can be asked to take when no explicit theme was supplied,
 * rotated deterministically across a batch by angleIndex so five drafts in a
 * row get five different structural jobs instead of five rolls of the same
 * die (issue #360 cause 2). Each angle now carries a hard, unmistakable
 * negative constraint on the post's *form* rather than a mild suggestion
 * (issue #362 cause 2) — only `community-question` may end in a question
 * mark; every other angle explicitly forbids it.
 */
export type DraftAngle = {
  key: string;
  instruction: string;
  constraint: string;
  allowsQuestion: boolean;
  maxLength?: number;
};

export const DRAFT_ANGLES: DraftAngle[] = [
  {
    key: "community-question",
    instruction: "Ask the community a genuine, open-ended question about the project or their experience with it.",
    constraint: "This post must end in a genuine, open-ended question to the community — this is the only angle allowed to end with a question mark.",
    allowsQuestion: true,
  },
  {
    key: "culture-observation",
    instruction: "Make an observation about the culture or energy building around the project — don't just restate a tagline.",
    constraint: "This post must be a statement, not a question — do not end it with a question mark or invite a response.",
    allowsQuestion: false,
  },
  {
    key: "milestone",
    instruction: "Share a concrete milestone or progress note, even a small one.",
    constraint: "This post must report something concrete that happened — not a question, not a vibe statement. Do not end it with a question mark.",
    allowsQuestion: false,
  },
  {
    key: "one-liner",
    instruction: "Write a short, punchy one-liner — well under the character limit, no elaboration needed.",
    constraint: `This post must be a single short statement — no question mark, no call to respond, well under half the character limit (at most ${ONE_LINER_MAX_LENGTH} characters).`,
    allowsQuestion: false,
    maxLength: ONE_LINER_MAX_LENGTH,
  },
  {
    key: "holder-shoutout",
    instruction: "Speak directly to holders: a shout-out, a thank-you, or a call to action just for them.",
    constraint: "This post must be a direct shout-out, thank-you, or call to action to holders — not a question. Do not end it with a question mark.",
    allowsQuestion: false,
  },
  {
    key: "behind-the-scenes",
    instruction: "Share a behind-the-scenes note about how the project is being built or run.",
    constraint: "This post must be a behind-the-scenes statement about how the project is being built or run — not a question. Do not end it with a question mark.",
    allowsQuestion: false,
  },
];

function resolveAngleIndex(angleIndex: number | undefined): number {
  return (((angleIndex ?? 0) % DRAFT_ANGLES.length) + DRAFT_ANGLES.length) % DRAFT_ANGLES.length;
}

/**
 * Angles whose instruction asks for a specific fact (a milestone, a holder
 * detail, a behind-the-scenes note) the model has no grounding for unless a
 * direction brief was supplied — asking for one anyway is what produced the
 * invented "10k holders" / "first liquidity pool" claims (issue #364).
 */
export const FACT_DEPENDENT_ANGLE_KEYS: readonly string[] = ["milestone", "holder-shoutout", "behind-the-scenes"];

function isFactDependentAngle(angle: DraftAngle): boolean {
  return FACT_DEPENDENT_ANGLE_KEYS.includes(angle.key);
}

/**
 * Resolves the angle that applies to this draft request, or null when an
 * explicit theme was supplied — a theme always fully overrides the rotating
 * angle, so no form requirement is emitted at all in that case.
 *
 * Without a direction brief, fact-dependent angles are skipped entirely by
 * scanning forward from the rotated index to the next safe angle — the
 * rotation still walks every *reachable* angle deterministically, it just
 * never lands on one the model has nothing real to say for (issue #364).
 */
export function resolveDraftAngle(
  theme: string | null | undefined,
  angleIndex: number | undefined,
  hasDirectionBrief: boolean,
): DraftAngle | null {
  if (theme?.trim()) return null;
  const start = resolveAngleIndex(angleIndex);
  if (hasDirectionBrief) return DRAFT_ANGLES[start];
  for (let offset = 0; offset < DRAFT_ANGLES.length; offset += 1) {
    const candidate = DRAFT_ANGLES[(start + offset) % DRAFT_ANGLES.length];
    if (!isFactDependentAngle(candidate)) return candidate;
  }
  return DRAFT_ANGLES[start];
}

/**
 * The angle's required post *form* as a hard, non-negotiable developer-prompt
 * requirement (issue #362 cause 2) — moved out of a mild suggestion at the
 * end of the user block into a constraint near the top of the developer
 * prompt, ahead of the character-limit rule and all content-steering
 * instructions.
 */
function requiredPostFormLine(angle: DraftAngle | null): string {
  if (!angle) return "";
  return `REQUIRED POST FORM (non-negotiable, applies to the X draft): ${angle.instruction} ${angle.constraint}`;
}

function classifyDraftForm(draft: string): "question" | "statement" {
  return draft.trim().endsWith("?") ? "question" : "statement";
}

function openingWords(draft: string, wordCount = 6): string {
  return draft.trim().split(/\s+/).slice(0, wordCount).join(" ");
}

/**
 * Avoid-context so a draft doesn't just reword what's already sitting
 * unreviewed (issue #360 cause 3). Originally passed the full text of every
 * recent draft, which reliably anchors an LLM toward the shown examples
 * instead of deterring repetition of them (issue #362 cause 3). Now passes
 * only a structural summary — the form each recent draft took — plus each
 * draft's opening few words so a new draft can dodge repeated openings,
 * never the full body.
 */
function recentDraftsInstruction(recentDrafts: string[]): string {
  if (recentDrafts.length === 0) return "";
  const forms = recentDrafts.map(classifyDraftForm);
  const openings = recentDrafts.map((draft, index) => `${index + 1}. "${openingWords(draft)}…"`);
  return [
    `Recent posts already sitting in Ready to review used these forms, oldest first: ${forms.join(", ")}. Avoid repeating those forms — vary the structure from what's already queued.`,
    `Recent post openings (do not reuse or closely echo any of these):`,
    ...openings,
  ].join("\n");
}

/**
 * Explicit, non-negotiable ban on opening with the project name/ticker, only
 * emitted when the rolling recent-draft window shows it's already happened —
 * prompt wording alone ("vary how each post opens") did not stop nearly
 * every post in a real batch from starting with "Doom" (issue #366). One
 * identity-led opener is still allowed when the window has none.
 */
function identityOpenerWarningInstruction(project: DraftProject, recentDrafts: string[]): string {
  if (!recentDrafts.some((draft) => textStartsWithIdentity(draft, project))) return "";
  return `A recent post already opened with "${project.name}" or "${project.ticker}". This post's X draft must NOT begin with the project name or ticker, with or without a "$", punctuation, or an emoji before it — open from a different human perspective (a holder's voice, an observation, a moment, a question) instead of moving the project name later in the same sentence.`;
}

/**
 * Telegram counterpart of identityOpenerWarningInstruction above (issue
 * #382): the X-side draft pipeline already caught repeated identity
 * openers, but the rolling context feeding that check was built from
 * xText only, so the Telegram variant could — and in production did —
 * open with the project name every single time without ever tripping it.
 */
function telegramIdentityOpenerWarningInstruction(project: DraftProject, recentTelegramDrafts: string[]): string {
  if (!recentTelegramDrafts.some((draft) => textStartsWithIdentity(draft, project))) return "";
  return `A recent Telegram post already opened with "${project.name}" or "${project.ticker}". This post's Telegram draft must NOT begin with the project name or ticker, with or without a "$", punctuation, or an emoji before it — open from a different human perspective instead of moving the project name later in the same sentence.`;
}

/** Telegram counterpart of the X-only opening-words avoid-context above (issue #382) — same shape, Telegram history only. */
function telegramOpeningsInstruction(recentTelegramDrafts: string[]): string {
  if (recentTelegramDrafts.length === 0) return "";
  const openings = recentTelegramDrafts.map((draft, index) => `${index + 1}. "${openingWords(draft)}…"`);
  return [
    "Recent Telegram post openings already sitting in Ready to review (do not reuse or closely echo any of these):",
    ...openings,
  ].join("\n");
}

/**
 * Standing rule (issue #382): the Telegram variant was converging on a
 * generic project-summary opening regardless of what angle the X draft
 * took, since nothing told the model the two drafts should share a subject.
 */
const TELEGRAM_ANGLE_MATCH_RULE =
  "The Telegram draft must follow the same angle, subject and moment as the X draft for this post — it may be longer and more conversational, but it must not fall back to a generic project summary while the X draft takes a specific angle.";

/** Static rules guarding against the formulaic pattern this issue was filed about — same construction, same phrase, hashtags every time. */
const ANTI_FORMULA_RULES = [
  "Avoid falling into a formula across posts: do not always open with the project name, ticker, or a 'X is not ... it's ...' construction — vary how each post opens.",
  "Never use the \"isn't just X, it's Y\" / \"not X, it's Y\" construction anywhere in either draft, not only as an opening line.",
  "Vary post length meaningfully rather than always landing near the same length.",
  "Do not reuse the same signature phrase (a specific catchphrase, slogan or metaphor) in consecutive posts.",
  "Do not append hashtags to every post — only include them when they genuinely add value, never as a reflexive sign-off.",
].join("\n");

function normaliseForPhraseMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordNgrams(words: string[], n: number): string[] {
  const grams: string[] = [];
  for (let index = 0; index + n <= words.length; index += 1) {
    grams.push(words.slice(index, index + n).join(" "));
  }
  return grams;
}

const REPEATED_PHRASE_MIN_WORDS = 2;
const REPEATED_PHRASE_MAX_WORDS = 6;
/** A phrase only counts as "distinctive" (worth banning) if it contains at least one word this long — filters out generic filler like "the doom" or "what s". */
const REPEATED_PHRASE_MIN_DISTINCTIVE_WORD_LENGTH = 5;
const MAX_BANNED_PHRASES = 8;

function isDistinctivePhrase(phrase: string): boolean {
  return phrase.split(" ").some((word) => word.length >= REPEATED_PHRASE_MIN_DISTINCTIVE_WORD_LENGTH);
}

/**
 * Distinctive multi-word phrases that recur across 2+ of the recent drafts
 * already sitting in Ready to review — real output kept reusing phrases
 * like "bold humor" and "a crew that actually shows up" even though the
 * existing avoid-context is structural only (issue #364). Flagging the
 * actual repeated phrases lets the next prompt ban them by name.
 */
export function extractRepeatedPhrases(recentDrafts: string[]): string[] {
  const counts = new Map<string, number>();
  recentDrafts.forEach((draft) => {
    const words = normaliseForPhraseMatch(draft).split(" ").filter(Boolean);
    const seenInThisDraft = new Set<string>();
    for (let n = REPEATED_PHRASE_MIN_WORDS; n <= REPEATED_PHRASE_MAX_WORDS; n += 1) {
      wordNgrams(words, n).forEach((phrase) => {
        if (isDistinctivePhrase(phrase)) seenInThisDraft.add(phrase);
      });
    }
    seenInThisDraft.forEach((phrase) => counts.set(phrase, (counts.get(phrase) ?? 0) + 1));
  });

  const repeated = Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .map(([phrase]) => phrase)
    .sort((a, b) => b.length - a.length);

  const kept: string[] = [];
  repeated.forEach((phrase) => {
    if (!kept.some((existing) => existing.includes(phrase))) kept.push(phrase);
  });
  return kept.slice(0, MAX_BANNED_PHRASES);
}

function bannedPhrasesInstruction(phrases: string[]): string {
  if (phrases.length === 0) return "";
  return [
    "These exact phrases already appeared in 2 or more recent posts and must not be reused in any form:",
    ...phrases.map((phrase, index) => `${index + 1}. "${phrase}"`),
  ].join("\n");
}

/**
 * Function words filtered out of the immediate short-signature-phrase check
 * below — a two/three-word gram containing any of these reads as ordinary
 * grammar, not a memorable catchphrase, so it must never trigger a ban after
 * a single occurrence (issue #366 follow-up: "do not ban ... every ordinary
 * use of words such as 'community'"). Deliberately short and mechanical, not
 * a general-purpose stopword list — it only needs to keep this one check
 * conservative.
 */
const SIGNATURE_PHRASE_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "at", "for", "with", "from", "as", "it", "it's", "its", "this", "that",
  "these", "those", "we", "our", "you", "your", "they", "their", "i", "my", "me", "us",
  "not", "no", "so", "if", "then", "than", "more", "most", "some", "all", "every", "any",
  "into", "out", "up", "down", "over", "under", "again", "just", "only", "also", "still",
  "will", "would", "can", "could", "should", "do", "does", "did", "has", "have", "had",
  "here", "there", "when", "what", "who", "why", "how", "each", "own", "one", "let",
]);

const SIGNATURE_PHRASE_MIN_WORDS = 2;
const SIGNATURE_PHRASE_MAX_WORDS = 3;
const SIGNATURE_PHRASE_MIN_WORD_LENGTH = 4;
/** Deliberately smaller than MAX_BANNED_PHRASES — this list is meant to name a handful of the most recent signature phrases, not exhaustively catalogue every recent draft. */
const MAX_SIGNATURE_PHRASES = 10;

function isSignaturePhrase(phrase: string): boolean {
  return phrase
    .split(" ")
    .every((word) => word.length >= SIGNATURE_PHRASE_MIN_WORD_LENGTH && !SIGNATURE_PHRASE_STOPWORDS.has(word));
}

/** A phrase overlapping the project's own name, ticker or chain label is never bannable — this check must never end up prohibiting the project's own identity. */
function isProtectedFactPhrase(phrase: string, project: { name: string; ticker: string }, chainLabel: string): boolean {
  return [project.name, project.ticker, chainLabel]
    .map((value) => normaliseForPhraseMatch(value))
    .filter(Boolean)
    .some((value) => phrase.includes(value) || value.includes(phrase));
}

/**
 * Distinctive 2-3 word phrases pulled from each recent X draft individually —
 * banned after a single prior occurrence, unlike extractRepeatedPhrases's 2+
 * recurrence threshold. A short signature phrase like "bold humor" was
 * slipping straight into a second draft because that 2+ threshold only trips
 * on the phrase's *third* appearance (issue #366 follow-up point 1).
 * Deliberately conservative to keep false positives low: every word in the
 * phrase must be a real content word (no stopwords, at least
 * SIGNATURE_PHRASE_MIN_WORD_LENGTH letters), and any phrase overlapping the
 * project's own name, ticker or chain label is always excluded (point 2).
 *
 * Unlike extractRepeatedPhrases, this deliberately does NOT collapse a short
 * phrase into a longer phrase that contains it — a reuse might repeat only
 * the short core ("bold humor") without the surrounding words ("brings bold
 * humor"), and checkDraftRepetition matches banned phrases by exact
 * substring, so dropping the short form in favour of the long one would let
 * that reuse straight through.
 */
export function extractImmediateSignaturePhrases(
  recentDrafts: string[],
  project: { name: string; ticker: string },
  chainLabel: string,
): string[] {
  const found = new Set<string>();
  recentDrafts.forEach((draft) => {
    const words = normaliseForPhraseMatch(draft).split(" ").filter(Boolean);
    for (let n = SIGNATURE_PHRASE_MIN_WORDS; n <= SIGNATURE_PHRASE_MAX_WORDS; n += 1) {
      wordNgrams(words, n).forEach((phrase) => {
        if (isSignaturePhrase(phrase) && !isProtectedFactPhrase(phrase, project, chainLabel)) {
          found.add(phrase);
        }
      });
    }
  });

  // Shorter phrases first so a compact catchphrase like "bold humor" survives
  // the cap ahead of longer, less-reusable variants built around it.
  return Array.from(found)
    .sort((a, b) => a.split(" ").length - b.split(" ").length || a.length - b.length)
    .slice(0, MAX_SIGNATURE_PHRASES);
}

function immediateSignaturePhrasesInstruction(phrases: string[]): string {
  if (phrases.length === 0) return "";
  return [
    "These short signature phrases already appeared in a recent post in this batch and must not be reused, even once, in either draft — pick genuinely different wording, not just a reordering:",
    ...phrases.map((phrase, index) => `${index + 1}. "${phrase}"`),
  ].join("\n");
}

/**
 * A narrow, explicit list of standalone AI-cliché filler words that read as
 * bot-like when they recur across a batch, even though each word alone is
 * far too common/generic to ever ban outright (issue #366 follow-up point
 * 4 — the user's screenshot named "vibe" specifically). Rolling-window rule,
 * the same shape as checkDraftIdentityOpener: one use is always allowed, a
 * second use within the window is not. Kept deliberately short rather than a
 * broad style-policing list — this targets the specific filler flagged, not
 * a user's genuine vocabulary.
 */
export const WATCHED_FILLER_TERMS: readonly string[] = ["vibe", "vibes"];

function textContainsWatchedTerm(text: string, term: string): boolean {
  return new RegExp(`\\b${term}\\b`, "iu").test(text);
}

/**
 * Mechanical guard, run after parsing (issue #366 follow-up point 4): rejects
 * a watched filler term's second appearance within the rolling recent-draft
 * window. A single use is always allowed — this only fires once the same
 * term already showed up in a recent draft too.
 */
export function checkDraftWatchedFillerTerms(xText: string, recentDrafts: string[]): DraftAngleComplianceResult {
  for (const term of WATCHED_FILLER_TERMS) {
    const alreadyUsed = recentDrafts.some((draft) => textContainsWatchedTerm(draft, term));
    if (alreadyUsed && textContainsWatchedTerm(xText, term)) {
      return {
        violated: true,
        feedback: `The word "${term}" already appeared in a recent post in this batch. Rewrite without it — pick different, more specific wording instead of that filler.`,
      };
    }
  }
  return { violated: false };
}

function watchedFillerTermsInstruction(recentDrafts: string[]): string {
  const used = WATCHED_FILLER_TERMS.filter((term) => recentDrafts.some((draft) => textContainsWatchedTerm(draft, term)));
  if (used.length === 0) return "";
  return `The word(s) ${used.map((term) => `"${term}"`).join(", ")} already appeared in a recent post in this batch — avoid reusing ${used.length > 1 ? "them" : "it"} here.`;
}

/** Guard against voice drift: liked lines are secondary reinforcement, capped and ordered, never the primary voice reference (issue #348). */
function likedLinesInstruction(likedSampleLines: string[]): string {
  if (likedSampleLines.length === 0) return "";
  return [
    `The user previously approved these ${likedSampleLines.length} AI-written sample line(s) as sounding authentically like their voice (most recent first, capped at ${MAX_REINFORCEMENT_SAMPLE_LINES}).`,
    "Treat them as secondary reinforcement only — the taught-voice description above, built from the user's own real posts, is always the primary and authoritative reference.",
    ...likedSampleLines.map((line, index) => `${index + 1}. ${line}`),
  ].join("\n");
}

/**
 * Optional per-project steering (issue #358's Direction brief) — the user's
 * stated focus for the week, applied to both X and Telegram. Secondary to
 * the taught voice and liked-line reinforcement above, and never quoted
 * verbatim. Empty/whitespace-only input is a no-op so an unset brief changes
 * nothing about generation.
 *
 * The brief and the angle's required post form are orthogonal — content vs.
 * form — but a brief like "push the community angle" was previously
 * flattening every angle into the same shape (issue #362 cause 1), so the
 * brief is now explicitly scoped to subject matter only and stated as
 * subordinate to the form requirement above it.
 */
function directionBriefInstruction(directionBrief: string | null | undefined): string {
  const trimmed = directionBrief?.trim();
  if (!trimmed) return "";
  return [
    "The user's current focus for this week (secondary to the taught voice and liked-line reinforcement above): this describes what to talk about, not what shape the post should take; the required post form given separately above takes precedence over this brief. Reflect this focus in the post's content only, do not quote it verbatim:",
    trimmed,
  ].join("\n");
}

/**
 * Structurally forecloses fact invention (issue #364): real generated
 * drafts have asserted a holder count and a "first liquidity pool" that
 * were both false. Rather than discourage invention, this states the
 * complete set of facts the model actually has — deliberately excluding
 * token supply, which this route never receives and would itself invite
 * invention if listed here.
 */
function allowedFactsLedgerInstruction(
  project: DraftProject,
  chainLabel: string,
  directionBrief: string | null | undefined,
): string {
  const trimmedBrief = directionBrief?.trim();
  return [
    "ALLOWED FACTS — this is the complete list of facts you may treat as true. Nothing else about this project is known to you:",
    `- Project name: ${project.name}`,
    `- Ticker: ${project.ticker}`,
    `- Chain: ${chainLabel}`,
    `- Description: ${project.description || "No description supplied."}`,
    `- Contract address: ${project.contractAddress || "not yet live."}`,
    `- Direction brief: ${trimmedBrief || "none supplied."}`,
    "The description and direction brief above are source material for tone and subject matter only — they are not permission to infer or invent adjacent facts they don't explicitly state.",
    "Never invent or imply: holder counts, wallet counts, user numbers, prices, percentages, market caps, trading volumes, liquidity events, pool launches, exchange listings, integrations, partnerships, dates, launch events, milestones, or any 'first' claim — unless that exact fact is listed above.",
    trimmedBrief
      ? "Every specific factual detail in either draft must be directly supported by the direction brief above or another allowed fact above — do not add specifics they don't state."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Shared X/prompt chain label for a project — also used to protect the chain name from the short-signature-phrase ban below. */
export function resolveChainLabel(chain: DraftProject["chain"]): string {
  return chain === "robinhood" ? "Robinhood Chain" : "Solana";
}

export function buildDraftRequestBody(
  input: {
    project: DraftProject;
    voiceProfile: VoiceProfile | null;
    dayLabel?: string | null;
    theme?: string | null;
    likedSampleLines?: string[];
    directionBrief?: string | null;
    voiceExamples?: string[];
    recentDrafts?: string[];
    /** Telegram-history counterpart of recentDrafts above (issue #382) — without it, the Telegram variant's opening-repetition and phrase-reuse checks have nothing to compare against. */
    recentTelegramDrafts?: string[];
    angleIndex?: number;
    /** Named violation feedback for the single automatic retry (issue #362). */
    correctiveFeedback?: string | null;
  },
  model: string,
) {
  const likedSampleLines = input.likedSampleLines ?? [];
  const voiceExamples = rotatingSample(
    (input.voiceExamples ?? []).map((example) => truncate(example, VOICE_EXAMPLE_TRUNCATE_LENGTH)),
    VOICE_EXAMPLES_PER_DRAFT,
    (input.angleIndex ?? 0) * VOICE_EXAMPLES_PER_DRAFT,
  );
  const recentDrafts = (input.recentDrafts ?? []).slice(0, MAX_RECENT_DRAFTS_CONTEXT);
  const recentTelegramDrafts = (input.recentTelegramDrafts ?? []).slice(0, MAX_RECENT_DRAFTS_CONTEXT);
  // Phrase reuse is checked against both channels combined (issue #382) —
  // checkDraftRepetition's banned-phrase match already runs against the
  // combined X+Telegram draft text, so the phrases fed into the prompt must
  // be drawn from the same combined history or the prompt and the mechanical
  // check would disagree about what's already been said.
  const allRecentDraftsForPhraseExtraction = [...recentDrafts, ...recentTelegramDrafts];
  const chain = resolveChainLabel(input.project.chain);
  const angle = resolveDraftAngle(input.theme, input.angleIndex, Boolean(input.directionBrief?.trim()));
  const themeLine = input.theme?.trim() ? `Theme for this post: ${input.theme.trim()}.` : "";
  const dayLine = input.dayLabel?.trim() ? `This post is scheduled for ${input.dayLabel.trim()}.` : "";

  return {
    model,
    store: false,
    // This is a short extraction task. Minimal reasoning preserves the output
    // budget for the strict two-field JSON object instead of hidden reasoning.
    reasoning: { effort: "minimal" },
    max_output_tokens: 1_200,
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: [
              "You are the post-drafting assistant for the Hoodlums AI Social Studio.",
              "Draft one X (Twitter) post and one Telegram post about the user's own token project only.",
              requiredPostFormLine(angle),
              `The X post MUST be ${X_DRAFT_CHARACTER_LIMIT} characters or fewer, counting every character including spaces and emoji.`,
              "The Telegram post may be longer and more conversational.",
              "Never include a link or URL of any kind (no http/https, no www., no bare domain like example.com, no shortener) in either draft. Assume the project's link already lives in the X profile bio and Telegram channel description — write copy that stands on its own without one. A link-bearing X post costs far more to publish through the API, so this is a hard rule, not a style preference.",
              "Never invent price predictions, guaranteed returns or financial advice. Never use the words: guaranteed, financial advice, to the moon, rug, 100x.",
              "Both drafts are shown to the user for review and editing before they choose to post — do not claim they have already been posted.",
              voiceInstruction(input.voiceProfile),
              voiceExamplesInstruction(voiceExamples),
              likedLinesInstruction(likedSampleLines),
              directionBriefInstruction(input.directionBrief),
              allowedFactsLedgerInstruction(input.project, chain, input.directionBrief),
              recentDraftsInstruction(recentDrafts),
              identityOpenerWarningInstruction(input.project, recentDrafts),
              telegramOpeningsInstruction(recentTelegramDrafts),
              telegramIdentityOpenerWarningInstruction(input.project, recentTelegramDrafts),
              TELEGRAM_ANGLE_MATCH_RULE,
              bannedPhrasesInstruction(extractRepeatedPhrases(allRecentDraftsForPhraseExtraction)),
              immediateSignaturePhrasesInstruction(
                extractImmediateSignaturePhrases(allRecentDraftsForPhraseExtraction, input.project, chain),
              ),
              watchedFillerTermsInstruction(recentDrafts),
              ANTI_FORMULA_RULES,
              input.correctiveFeedback?.trim() ? `IMPORTANT CORRECTION (this is a regenerated attempt): ${input.correctiveFeedback.trim()}` : "",
              "Return only the strict draft JSON object.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `Project name: ${input.project.name}`,
              `Ticker: ${input.project.ticker}`,
              `Chain: ${chain}`,
              `Project story: ${input.project.description || "No description supplied."}`,
              input.project.contractAddress ? `Contract: ${input.project.contractAddress}` : "Contract not yet live.",
              themeLine,
              dayLine,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "social_draft",
        strict: true,
        schema: DRAFT_SCHEMA,
      },
    },
  };
}

function cleanText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/[ \t]+/g, " ").trim();
  if (collapsed.length < min || collapsed.length > max) return null;
  return collapsed;
}

/**
 * A model can still return an X draft slightly over the limit despite the
 * instruction. Truncate at a word boundary rather than reject outright — the
 * user reviews and edits every draft before posting (CLAUDE.md rule 8's
 * "no unattended posting" via the existing xCharacterCount/280 UI check is
 * the real enforcement gate; this is a defensive safety net).
 */
function enforceXLimit(text: string): string {
  if (text.length <= X_DRAFT_CHARACTER_LIMIT) return text;
  const truncated = text.slice(0, X_DRAFT_CHARACTER_LIMIT);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 200 ? truncated.slice(0, lastSpace) : truncated).trimEnd();
}

/** Reason a draft parse failed, precise enough to diagnose from server logs alone. */
export type DraftParseFailure =
  | { reason: "empty_output" }
  | { reason: "json_parse_error"; detail: string }
  | { reason: "invalid_field"; field: string; receivedLength: number };

export type DraftParseResult = { ok: true; draft: SocialDraft } | ({ ok: false } & DraftParseFailure);

export function parseDraftResponseDetailed(response: OpenAIResponse): DraftParseResult {
  const text = extractOutputText(response);
  if (!text) return { ok: false, reason: "empty_output" };

  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    return { ok: false, reason: "json_parse_error", detail: error instanceof Error ? error.message : String(error) };
  }

  const xTextRaw = cleanText(value.xText, 5, 320);
  if (!xTextRaw) {
    return {
      ok: false,
      reason: "invalid_field",
      field: "xText",
      receivedLength: typeof value.xText === "string" ? value.xText.length : -1,
    };
  }
  const telegramText = cleanText(value.telegramText, 5, 800);
  if (!telegramText) {
    return {
      ok: false,
      reason: "invalid_field",
      field: "telegramText",
      receivedLength: typeof value.telegramText === "string" ? value.telegramText.length : -1,
    };
  }

  return { ok: true, draft: { xText: enforceXLimit(xTextRaw), telegramText } };
}

export function parseDraftResponse(response: OpenAIResponse): SocialDraft | null {
  const result = parseDraftResponseDetailed(response);
  return result.ok ? result.draft : null;
}

export type DraftAngleComplianceResult = { violated: false } | { violated: true; feedback: string };

/**
 * Mechanical guard, run after parsing (issue #362): the required post form is
 * a prompt instruction, not something the model always honours. Checks the
 * parsed xText against the angle it was asked for — a non-question angle
 * ending in "?", or a one-liner over its length cap — and returns corrective
 * feedback naming the exact violation for a single regeneration retry
 * (mirroring the one-retry pattern in app/api/generate-site-page/route.ts).
 * No theme means no angle requirement was ever emitted, so it can't be
 * violated.
 */
export function checkDraftAngleCompliance(
  xText: string,
  input: { theme?: string | null; angleIndex?: number; directionBrief?: string | null },
): DraftAngleComplianceResult {
  const angle = resolveDraftAngle(input.theme, input.angleIndex, Boolean(input.directionBrief?.trim()));
  if (!angle) return { violated: false };

  const trimmed = xText.trim();
  if (!angle.allowsQuestion && trimmed.endsWith("?")) {
    return {
      violated: true,
      feedback: `The previous draft violated its required post form ("${angle.key}"): it ended in a question mark, but this angle must not. ${angle.constraint}`,
    };
  }
  if (angle.maxLength && trimmed.length > angle.maxLength) {
    return {
      violated: true,
      feedback: `The previous draft violated its required post form ("${angle.key}"): it was ${trimmed.length} characters, over the ${angle.maxLength}-character cap for this angle. ${angle.constraint}`,
    };
  }
  return { violated: false };
}

/**
 * Deterministic patterns for claims this endpoint has no data to verify —
 * a specific holder/wallet count, a dollar figure, a percentage move, or an
 * event claim (pool live, listed, partnered, "first"). These ban the
 * *shape* of the claim regardless of whether it happens to be true, since
 * nothing passed to this route can confirm it either way (issue #364).
 */
const HIGH_RISK_CLAIM_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /\b\d[\d,]*\.?\d*\s?[kKmM]?\+?\s+(holders?|wallets?|users?|members?|buyers?)\b/,
    label: "a specific holder/wallet/user count",
  },
  {
    pattern: /\$\s?\d[\d,]*\.?\d*\s?[kKmMbB]?/,
    label: "a specific dollar figure",
  },
  {
    pattern: /\b\d[\d,]*\.?\d*\s?[kKmMbB]?\s*(market\s?cap|mcap|volume|liquidity)\b/i,
    label: "a specific market cap/volume/liquidity figure",
  },
  {
    pattern:
      /\b(up|down|gained?|dropped?|rose|fell|surged|jumped|soared|climbed|increased?|decreased?)\b[^.!?\n]{0,25}\d+(\.\d+)?%|\d+(\.\d+)?%[^.!?\n]{0,25}\b(up|down|gain|drop|increase|decrease)\b/i,
    label: "a percentage price move",
  },
  {
    pattern: /\bliquidity pool\b[^.!?\n]{0,20}\blive\b|\bpool (?:is|just went) live\b/i,
    label: "an unverified liquidity/pool launch claim",
  },
  {
    pattern: /\blisted on\b/i,
    label: "an unverified exchange listing claim",
  },
  {
    pattern: /\bpartnered?\s+with\b/i,
    label: "an unverified partnership claim",
  },
  {
    pattern: /\bfirst\b[^.!?\n]{0,40}\b(pool|liquidity|listing|launch|mint(?:ed)?)\b/i,
    label: "an unverified 'first' claim",
  },
  {
    pattern: /\bhit\s+(?:a\s+)?(?:new\s+)?milestone\b/i,
    label: "an unverified milestone claim",
  },
];

/**
 * Mechanical guard, run after parsing (issue #364): rejects the deterministic
 * high-risk-claim patterns above in either draft. This is the structural
 * backstop for the allowed-facts ledger — the ledger tells the model not to
 * invent, this catches it if it does anyway.
 */
export function checkDraftFactualRisk(draft: SocialDraft): DraftAngleComplianceResult {
  for (const [field, text] of [
    ["X", draft.xText],
    ["Telegram", draft.telegramText],
  ] as const) {
    for (const { pattern, label } of HIGH_RISK_CLAIM_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return {
          violated: true,
          feedback: `The previous draft's ${field} post included ${label} ("${match[0].trim()}"), which is not in the allowed facts. Remove it entirely — never invent or imply a fact that wasn't explicitly given.`,
        };
      }
    }
  }
  return { violated: false };
}

const NOT_JUST_CONSTRUCTION_PATTERN = /\b(?:isn't|is not|ain't)\s+just\b[^.!?\n]{0,60}\b(?:it's|it is)\b/i;

/**
 * Minimum/maximum window for the close-phrase-reuse comparison below (issue
 * #366) — deliberately more conservative than extractRepeatedPhrases's 2+
 * word floor, since this compares against only one prior draft at a time
 * rather than requiring 2+ recurrences, so it needs a longer, more
 * distinctive run to avoid flagging unavoidable short facts like a two-word
 * chain name.
 */
const PHRASE_OVERLAP_MIN_WORDS = 4;
const PHRASE_OVERLAP_MAX_WORDS = 10;

/**
 * The longest exact run of PHRASE_OVERLAP_MIN_WORDS+ normalised words shared
 * between two X drafts that contains at least one meaningfully distinctive
 * word, or null if there's no such overlap. Checking the longest match first
 * surfaces the most useful phrase for corrective feedback.
 */
function longestSharedDistinctivePhrase(candidateXText: string, recentXText: string): string | null {
  const candidateWords = normaliseForPhraseMatch(candidateXText).split(" ").filter(Boolean);
  const recentWords = normaliseForPhraseMatch(recentXText).split(" ").filter(Boolean);
  const recentGrams = new Set<string>();
  for (let n = PHRASE_OVERLAP_MIN_WORDS; n <= PHRASE_OVERLAP_MAX_WORDS; n += 1) {
    wordNgrams(recentWords, n).forEach((gram) => recentGrams.add(gram));
  }
  for (let n = PHRASE_OVERLAP_MAX_WORDS; n >= PHRASE_OVERLAP_MIN_WORDS; n -= 1) {
    const match = wordNgrams(candidateWords, n).find((gram) => recentGrams.has(gram) && isDistinctivePhrase(gram));
    if (match) return match;
  }
  return null;
}

/**
 * Mechanical guard, run after parsing (issue #364, extended #366, #382):
 * checks the parsed draft for the banned "isn't just X, it's Y"
 * construction, reuse of any phrase already flagged by extractRepeatedPhrases
 * (recurring across 2+ recent posts, X and Telegram combined), a close 4+
 * word shared phrase against any *single* recent X draft (#366), and — new
 * for #382 — the same close-phrase-reuse check for the Telegram draft
 * against recent Telegram history, since the original check only ever
 * compared xText against recentDrafts and let Telegram phrasing repeat
 * freely.
 */
export function checkDraftRepetition(
  draft: SocialDraft,
  bannedPhrases: string[],
  recentDrafts: string[] = [],
  recentTelegramDrafts: string[] = [],
): DraftAngleComplianceResult {
  const combined = `${draft.xText} ${draft.telegramText}`;
  if (NOT_JUST_CONSTRUCTION_PATTERN.test(combined)) {
    return {
      violated: true,
      feedback: 'The previous draft used the banned "isn\'t just X, it\'s Y" construction. Rewrite without that pattern anywhere in either post.',
    };
  }
  const normalisedCombined = normaliseForPhraseMatch(combined);
  for (const phrase of bannedPhrases) {
    if (normalisedCombined.includes(phrase)) {
      return {
        violated: true,
        feedback: `The previous draft reused the phrase "${phrase}", which has already appeared in multiple recent posts. Rewrite with different wording.`,
      };
    }
  }
  for (const recentDraft of recentDrafts) {
    const shared = longestSharedDistinctivePhrase(draft.xText, recentDraft);
    if (shared) {
      return {
        violated: true,
        feedback: `The previous draft's X post shares the phrase "${shared}" almost word-for-word with a recent post. Rewrite that part with different wording — this is about copied phrasing, not the taught voice's tone or cadence.`,
      };
    }
  }
  for (const recentTelegramDraft of recentTelegramDrafts) {
    const shared = longestSharedDistinctivePhrase(draft.telegramText, recentTelegramDraft);
    if (shared) {
      return {
        violated: true,
        feedback: `The previous draft's Telegram post shares the phrase "${shared}" almost word-for-word with a recent Telegram post. Rewrite that part with different wording — this is about copied phrasing, not the taught voice's tone or cadence.`,
      };
    }
  }
  return { violated: false };
}

/**
 * Mechanical guard, run after parsing (issue #366, extended #382 with a
 * `field` parameter): prompt wording alone did not stop nearly every post in
 * a real batch from opening with the project name/ticker. This is a
 * rolling-window rule, not a permanent ban — a draft opening with the
 * project identity only violates when a recent draft in the window already
 * did the same, so one identity-led opener is always allowed. `field`
 * defaults to "X" to stay backward compatible with existing callers; the
 * route also calls this with `field: "Telegram"` and `recentDrafts` set to
 * the Telegram-only history so the corrective-retry feedback names the
 * Telegram text specifically instead of the generic "this post".
 */
export function checkDraftIdentityOpener(
  text: string,
  project: { name: string; ticker: string },
  recentDrafts: string[],
  field: "X" | "Telegram" = "X",
): DraftAngleComplianceResult {
  if (!recentDrafts.some((draft) => textStartsWithIdentity(draft, project))) return { violated: false };
  if (!textStartsWithIdentity(text, project)) return { violated: false };
  const contextLabel = field === "Telegram" ? "A recent Telegram post" : "A recent post";
  return {
    violated: true,
    feedback: `${contextLabel} already opened with "${project.name}" or "${project.ticker}". Rewrite this draft's ${field} opening line so it does not start with the project name or ticker (with or without "$", punctuation, or an emoji before it) — open from a different human perspective instead of simply moving the project name later in the sentence.`,
  };
}

export type DraftComplianceCheckInput = {
  theme?: string | null;
  angleIndex?: number;
  directionBrief?: string | null;
  bannedPhrases?: string[];
  project?: { name: string; ticker: string };
  /** Only needed to protect the chain label from the immediate-signature-phrase check below when a project is also supplied. */
  chainLabel?: string;
  recentDrafts?: string[];
  /** Telegram-history counterpart of recentDrafts above (issue #382) — feeds the Telegram-specific identity-opener and phrase-overlap checks below. */
  recentTelegramDrafts?: string[];
};

/**
 * Runs every mechanical safety check — angle form, then factual risk, then
 * the project-identity opener (X, then Telegram — issue #382), then the
 * watched-filler-term rolling window, then repetition/phrase-overlap (which
 * also folds in the immediate short-signature-phrase ban whenever a project
 * is supplied, issue #366 follow-up, drawn from X and Telegram history
 * combined) — short-circuiting on the first violation. The route calls this
 * identically on the first response and, after a corrective retry, on the
 * retry's response too, so a second bad draft can never slip through
 * unchecked the way the first response's compliance check alone did (issue
 * #364, following on from #363).
 */
export function checkDraftCompliance(draft: SocialDraft, input: DraftComplianceCheckInput): DraftAngleComplianceResult {
  const angleResult = checkDraftAngleCompliance(draft.xText, input);
  if (angleResult.violated) return angleResult;
  const factualResult = checkDraftFactualRisk(draft);
  if (factualResult.violated) return factualResult;
  const recentDrafts = input.recentDrafts ?? [];
  const recentTelegramDrafts = input.recentTelegramDrafts ?? [];
  if (input.project) {
    const identityResult = checkDraftIdentityOpener(draft.xText, input.project, recentDrafts, "X");
    if (identityResult.violated) return identityResult;
    const telegramIdentityResult = checkDraftIdentityOpener(draft.telegramText, input.project, recentTelegramDrafts, "Telegram");
    if (telegramIdentityResult.violated) return telegramIdentityResult;
  }
  const fillerResult = checkDraftWatchedFillerTerms(draft.xText, recentDrafts);
  if (fillerResult.violated) return fillerResult;
  const allRecentDraftsForPhrases = [...recentDrafts, ...recentTelegramDrafts];
  const immediatePhrases = input.project
    ? extractImmediateSignaturePhrases(allRecentDraftsForPhrases, input.project, input.chainLabel ?? "")
    : [];
  return checkDraftRepetition(
    draft,
    [...(input.bannedPhrases ?? []), ...immediatePhrases],
    recentDrafts,
    recentTelegramDrafts,
  );
}
