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
const RECENT_DRAFT_OPENING_WORD_COUNT = 6;

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

/** A single character length allowed for the "one-liner" angle — well under the full X limit. */
export const ONE_LINER_MAX_LENGTH = Math.floor(X_DRAFT_CHARACTER_LIMIT / 2);

/**
 * Angles a draft can be asked to take when no explicit theme was supplied,
 * rotated deterministically across a batch by angleIndex so five drafts in a
 * row get five different structural jobs instead of five rolls of the same
 * die (issue #360 cause 2). Each angle carries its own hard, unmistakable
 * constraint — only `communityQuestion` may end in a question mark, every
 * other angle explicitly forbids it (issue #362 cause 2).
 */
export type DraftAngle = {
  key: string;
  instruction: string;
  constraint: string;
  allowsQuestion: boolean;
  /** Only set for the one-liner angle's hard length cap. */
  maxLength?: number;
};

export const DRAFT_ANGLES: DraftAngle[] = [
  {
    key: "community-question",
    instruction: "Ask the community a genuine, open-ended question about the project or their experience with it.",
    constraint:
      "This post must end with a genuine question mark — it is the only angle allowed to ask the reader to respond.",
    allowsQuestion: true,
  },
  {
    key: "culture-observation",
    instruction: "Make an observation about the culture or energy building around the project — don't just restate a tagline.",
    constraint:
      "This post must be a statement, not a question — do not end it with a question mark or ask the reader to respond.",
    allowsQuestion: false,
  },
  {
    key: "milestone",
    instruction: "Share a concrete milestone or progress note, even a small one.",
    constraint:
      "This post must report something concrete that happened — not a question, not a vibe statement. Do not end it with a question mark.",
    allowsQuestion: false,
  },
  {
    key: "one-liner",
    instruction: "Write a short, punchy one-liner — well under the character limit, no elaboration needed.",
    constraint: `This post must be a single short statement — no question mark, no call to respond, well under half the ${X_DRAFT_CHARACTER_LIMIT}-character limit (stay under ${ONE_LINER_MAX_LENGTH} characters).`,
    allowsQuestion: false,
    maxLength: ONE_LINER_MAX_LENGTH,
  },
  {
    key: "holder-shoutout",
    instruction: "Speak directly to holders: a shout-out, a thank-you, or a call to action just for them.",
    constraint:
      "This post must be a direct statement addressed to holders, not a question. Do not end it with a question mark.",
    allowsQuestion: false,
  },
  {
    key: "behind-the-scenes",
    instruction: "Share a behind-the-scenes note about how the project is being built or run.",
    constraint:
      "This post must be a statement describing what's happening behind the scenes, not a question. Do not end it with a question mark.",
    allowsQuestion: false,
  },
];

function normaliseAngleIndex(angleIndex: number | undefined): number {
  return (((angleIndex ?? 0) % DRAFT_ANGLES.length) + DRAFT_ANGLES.length) % DRAFT_ANGLES.length;
}

function resolveDraftAngle(angleIndex: number | undefined): DraftAngle {
  return DRAFT_ANGLES[normaliseAngleIndex(angleIndex)];
}

/**
 * The angle's form is a hard requirement placed near the top of the
 * developer prompt, ahead of content-steering instructions like the
 * direction brief, so it can't be flattened into a mild suggestion (issue
 * #362 cause 2). An explicit theme overrides the angle entirely, so no
 * angle requirement is emitted when one is supplied.
 */
function angleRequirementInstruction(angleIndex: number | undefined, hasTheme: boolean): string {
  if (hasTheme) return "";
  const angle = resolveDraftAngle(angleIndex);
  return [
    `REQUIRED POST FORM (non-negotiable — this governs the shape of the X post; it takes precedence over any subject-matter steering below): ${angle.instruction}`,
    angle.constraint,
  ].join("\n");
}

function classifyDraftForm(text: string): "question" | "statement" {
  return text.trim().endsWith("?") ? "question" : "statement";
}

function draftOpeningWords(text: string): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, RECENT_DRAFT_OPENING_WORD_COUNT).join(" ");
}

/**
 * Avoid-context as a compact structural summary rather than full draft
 * bodies (issue #362 cause 3). Passing verbatim recent drafts and asking for
 * "something different" reliably anchors an LLM toward the shown examples
 * instead of deterring repetition; a form classification plus opening words
 * gives the model enough to dodge repeated shapes and openings without
 * priming it with full text to riff on.
 */
function recentDraftsInstruction(recentDrafts: string[]): string {
  if (recentDrafts.length === 0) return "";
  const forms = recentDrafts.map(classifyDraftForm);
  const openings = recentDrafts.map((draft) => `"${draftOpeningWords(draft)}…"`);
  return [
    "These posts are already sitting in Ready to review, generated moments ago. Do not repeat their form or their openings:",
    `Recent post forms, oldest first: ${forms.join(", ")}.`,
    `Recent post openings, oldest first (do not reuse any of these openings): ${openings.join("; ")}.`,
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
 */
function directionBriefInstruction(directionBrief: string | null | undefined): string {
  const trimmed = directionBrief?.trim();
  if (!trimmed) return "";
  return [
    "The user's current focus for this week (secondary to the taught voice and liked-line reinforcement above — reflect this focus in the post's content, do not quote it verbatim). This describes what to talk about, not what shape the post should take; the required post form given separately above takes precedence over this brief:",
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
    /** One-shot corrective note appended after a post-parse angle-compliance violation (issue #362). */
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
  const hasTheme = Boolean(input.theme?.trim());
  const themeLine = hasTheme ? `Theme for this post: ${input.theme!.trim()}.` : "";
  const dayLine = input.dayLabel?.trim() ? `This post is scheduled for ${input.dayLabel.trim()}.` : "";
  const correctiveFeedback = input.correctiveFeedback?.trim();

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
              angleRequirementInstruction(input.angleIndex, hasTheme),
              correctiveFeedback
                ? `CORRECTIVE FEEDBACK FROM THE PREVIOUS ATTEMPT (fix this specifically, everything else here still applies): ${correctiveFeedback}`
                : "",
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

/** A parsed draft's X post disagreed with its requested angle's hard form constraint. */
export type DraftAngleViolation = "ends_with_question" | "one_liner_too_long";

/**
 * Mechanical post-parse guard (issue #362): the prompt-level angle
 * constraint is a strong instruction, not a guarantee, so this checks the
 * parsed draft against the angle it was actually asked for. No angle
 * constraint applies when an explicit theme overrode the angle.
 */
export function checkDraftAngleCompliance(
  draft: SocialDraft,
  angleIndex: number | undefined,
  hasTheme: boolean,
): DraftAngleViolation | null {
  if (hasTheme) return null;
  const angle = resolveDraftAngle(angleIndex);
  const endsWithQuestion = draft.xText.trim().endsWith("?");
  if (!angle.allowsQuestion && endsWithQuestion) return "ends_with_question";
  if (angle.maxLength !== undefined && draft.xText.length > angle.maxLength) return "one_liner_too_long";
  return null;
}

/** Corrective feedback text for exactly one angle-compliance retry, naming the violation precisely. */
export function draftAngleViolationFeedback(violation: DraftAngleViolation): string {
  switch (violation) {
    case "ends_with_question":
      return "The X post ended with a question mark, but the requested post form does not allow a question. Rewrite it as a statement that does not end with a question mark and does not ask the reader to respond.";
    case "one_liner_too_long":
      return `The X post was longer than the one-liner form allows. Rewrite it as a single short statement under ${ONE_LINER_MAX_LENGTH} characters.`;
  }
}
