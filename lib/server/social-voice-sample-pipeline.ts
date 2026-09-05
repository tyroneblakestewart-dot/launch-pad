// The sorting station's supply (owner spec, 5 Sep 2026): one of the user's own
// pasted posts goes in, and one line comes out that keeps its voice — rhythm,
// humour, sentence length, punctuation, emoji habits — with every trace of
// the original's identity strained out and the user's project poured in.
// Pure request/response shaping for app/api/social/voice-sample/route.ts.

import { MAX_REINFORCEMENT_SAMPLE_LINES } from "@/lib/social-voice-feedback";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import { MAX_REINFORCEMENT_SAMPLE_LINE_LENGTH } from "@/lib/server/social-reinforcement";
import { X_DRAFT_CHARACTER_LIMIT } from "@/lib/server/social-draft-pipeline";

export const MAX_VOICE_SAMPLE_SOURCE_LENGTH = 1_000;
export const MIN_VOICE_SAMPLE_SOURCE_LENGTH = 15;

export type VoiceSampleProject = {
  name: string;
  ticker: string;
  description?: string;
};

const VOICE_SAMPLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sample: { type: "string", description: "One post about the user's project in the source post's voice, 280 characters or fewer." },
  },
  required: ["sample"],
} as const;

export type NormalisedSourcePostResult = { ok: true; sourcePost: string } | { ok: false; error: string };

/** The one pasted post being reshaped: a string, trimmed, whitespace-collapsed, within length floors and caps. */
export function normaliseSourcePost(raw: unknown): NormalisedSourcePostResult {
  if (typeof raw !== "string") return { ok: false, error: "A source post is required." };
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length < MIN_VOICE_SAMPLE_SOURCE_LENGTH) {
    return { ok: false, error: `The source post must be at least ${MIN_VOICE_SAMPLE_SOURCE_LENGTH} characters.` };
  }
  if (collapsed.length > MAX_VOICE_SAMPLE_SOURCE_LENGTH) {
    return { ok: false, error: `The source post must be ${MAX_VOICE_SAMPLE_SOURCE_LENGTH} characters or fewer.` };
  }
  return { ok: true, sourcePost: collapsed };
}

/** Persona lines already in the bank: strings only, trimmed, length- and count-capped, order preserved (caller sends Fire first). */
export function normalisePersonaLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length <= MAX_REINFORCEMENT_SAMPLE_LINE_LENGTH)
    .slice(0, MAX_REINFORCEMENT_SAMPLE_LINES);
}

export function buildVoiceSampleRequestBody(
  input: { project: VoiceSampleProject; sourcePost: string; personaLines?: string[] },
  model: string,
) {
  const personaLines = input.personaLines ?? [];
  const description = input.project.description?.trim() || "No description supplied.";
  return {
    model,
    store: false,
    reasoning: { effort: "minimal" },
    max_output_tokens: 400,
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: [
              "You are the voice-reshaping assistant for the Hoodlums AI Social Studio.",
              "You will be given ONE post written by someone else. Your job is a strainer: keep its voice and throw away everything else.",
              "KEEP: the rhythm, sentence length, humour, punctuation habits, capitalisation habits, emoji habits and overall energy of the source.",
              "THROW AWAY: every trace of the source's identity — people, accounts, handles, brands, tickers, places, events, dates, numbers and its actual subject. None of it may survive, reworded or otherwise.",
              `WRITE: exactly one new post about the user's own project, "${input.project.name}" ($${input.project.ticker}), in that voice. It must read as if this account wrote it about its own project.`,
              `The post MUST be ${X_DRAFT_CHARACTER_LIMIT} characters or fewer, counting every character including spaces and emoji.`,
              "The only facts you may use are the project name, ticker and the project story below. Never invent holder counts, prices, market caps, listings, partnerships, dates, milestones, price predictions, guarantees or financial advice. Never include a link, URL or hashtag.",
              "Never copy any sentence from the source or from the persona lines verbatim.",
              personaLines.length > 0
                ? `The user has also kept ${personaLines.length} earlier reshaped line(s) as their persona (listed below, most important first). Use them as secondary reference for consistency only — the source post is the primary voice reference for this sample.`
                : "",
              "Return only the strict voice_sample JSON object.",
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
              `Project story: ${description}`,
              "Source post (voice reference only — strip its identity and subject entirely):",
              input.sourcePost,
              personaLines.length > 0 ? "Persona lines already kept (secondary reference only):" : "",
              ...personaLines.map((line, index) => `${index + 1}. ${line}`),
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
        name: "voice_sample",
        strict: true,
        schema: VOICE_SAMPLE_SCHEMA,
      },
    },
  };
}

export type VoiceSampleParseResult =
  | { ok: true; sample: string }
  | { ok: false; reason: "empty_output" | "json_parse_error" | "invalid_sample" };

function enforceLimit(text: string): string {
  if (text.length <= X_DRAFT_CHARACTER_LIMIT) return text;
  const truncated = text.slice(0, X_DRAFT_CHARACTER_LIMIT);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 200 ? truncated.slice(0, lastSpace) : truncated).trimEnd();
}

export function parseVoiceSampleResponse(response: OpenAIResponse): VoiceSampleParseResult {
  const text = response.output
    ?.flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text ?? "")
    .join("")
    .trim();
  if (!text) return { ok: false, reason: "empty_output" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "json_parse_error" };
  }
  const sampleRaw = parsed && typeof parsed === "object" ? (parsed as { sample?: unknown }).sample : undefined;
  if (typeof sampleRaw !== "string") return { ok: false, reason: "invalid_sample" };
  const collapsed = sampleRaw.replace(/\s+/g, " ").trim();
  if (collapsed.length < 8) return { ok: false, reason: "invalid_sample" };
  return { ok: true, sample: enforceLimit(collapsed) };
}
