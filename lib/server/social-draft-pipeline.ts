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
 * Resolves the angle that applies to this draft request, or null when an
 * explicit theme was supplied — a theme always fully overrides the rotating
 * angle, so no form requirement is emitted at all in that case.
 */
export function resolveDraftAngle(theme: string | null | undefined, angleIndex: number | undefined): DraftAngle | null {
  if (theme?.trim()) return null;
  return DRAFT_ANGLES[resolveAngleIndex(angleIndex)];
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

/** Static rules guarding against the formulaic pattern this issue was filed about — same construction, same phrase, hashtags every time. */
const ANTI_FORMULA_RULES = [
  "Avoid falling into a formula across posts: do not always open with the project name, ticker, or a 'X is not ... it's ...' construction — vary how each post opens.",
  "Vary post length meaningfully rather than always landing near the same length.",
  "Do not reuse the same signature phrase (a specific catchphrase, slogan or metaphor) in consecutive posts.",
  "Do not append hashtags to every post — only include them when they genuinely add value, never as a reflexive sign-off.",
].join("\n");

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
  const chain = input.project.chain === "robinhood" ? "Robinhood Chain" : "Solana";
  const angle = resolveDraftAngle(input.theme, input.angleIndex);
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
              recentDraftsInstruction(recentDrafts),
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
  input: { theme?: string | null; angleIndex?: number },
): DraftAngleComplianceResult {
  const angle = resolveDraftAngle(input.theme, input.angleIndex);
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
