import { extractOutputText, type OpenAIResponse } from "@/lib/server/generate-site-style";
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

export function buildDraftRequestBody(
  input: {
    project: DraftProject;
    voiceProfile: VoiceProfile | null;
    dayLabel?: string | null;
    theme?: string | null;
  },
  model: string,
) {
  const chain = input.project.chain === "robinhood" ? "Robinhood Chain" : "Solana";
  const themeLine = input.theme?.trim()
    ? `Theme for this post: ${input.theme.trim()}.`
    : "No specific theme was given — write a general announcement or community post.";
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
              `The X post MUST be ${X_DRAFT_CHARACTER_LIMIT} characters or fewer, counting every character including spaces and emoji.`,
              "The Telegram post may be longer and more conversational.",
              "Never include a link or URL of any kind (no http/https, no www., no bare domain like example.com, no shortener) in either draft. Assume the project's link already lives in the X profile bio and Telegram channel description — write copy that stands on its own without one. A link-bearing X post costs far more to publish through the API, so this is a hard rule, not a style preference.",
              "Never invent price predictions, guaranteed returns or financial advice. Never use the words: guaranteed, financial advice, to the moon, rug, 100x.",
              "Both drafts are shown to the user for review and editing before they choose to post — do not claim they have already been posted.",
              voiceInstruction(input.voiceProfile),
              "Return only the strict draft JSON object.",
            ].join("\n"),
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
