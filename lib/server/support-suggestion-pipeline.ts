import { extractOutputText, type OpenAIResponse } from "@/lib/server/generate-site-style";
import { knowledgeEntryId, type SupportKnowledgeEntry } from "@/lib/server/support-knowledge/types";

// AI-suggested fixes on admin support tickets (issue #400). This module is
// the structured-output request/parse/mechanical-check layer, following the
// same shape as lib/server/social-draft-pipeline.ts: build a strict
// json_schema request, parse defensively, then run deterministic checks a
// model's own instructions can't guarantee. The route (not this module)
// owns the one-corrective-retry orchestration, matching
// app/api/social/draft/route.ts's pattern.
//
// The model is restricted to the knowledge entries it's given (never asked
// to draw on general knowledge) and can only ever populate the OWNER's
// reply textarea for a human to edit and send — there is no send path here.

export type SupportTicketForSuggestion = {
  category: string;
  subject: string;
  body: string;
  diagnostics: Record<string, unknown>;
};

export type SuggestionConfidence = "low" | "medium" | "high";

export type SupportSuggestion = {
  probableCause: string;
  citedKnowledgeIds: string[];
  draftReply: string;
  needsCodeFix: boolean;
  confidence: SuggestionConfidence;
};

const SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    probableCause: { type: "string", minLength: 5, maxLength: 600 },
    citedKnowledgeIds: { type: "array", items: { type: "string" }, maxItems: 8 },
    draftReply: { type: "string", minLength: 5, maxLength: 2000 },
    needsCodeFix: { type: "boolean" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["probableCause", "citedKnowledgeIds", "draftReply", "needsCodeFix", "confidence"],
  additionalProperties: false,
} as const;

const MAX_DIAGNOSTICS_JSON_LENGTH = 4_000;

function knowledgeEntryPromptBlock(entry: SupportKnowledgeEntry): string {
  const id = knowledgeEntryId(entry);
  if (entry.kind === "error") {
    return `[${id}] Error catalogue — feature: ${entry.whichFeature}\nCause: ${entry.cause}\nFix: ${entry.fix}\nSuggested reply starting point: ${entry.userReplyTemplate}`;
  }
  if (entry.kind === "flow") {
    return `[${id}] Feature flow — ${entry.feature}\n${entry.summary}\nSteps: ${entry.steps.join(" -> ")}`;
  }
  if (entry.kind === "dependency") {
    return `[${id}] System dependency — feature: ${entry.feature}, required env: ${entry.requiredEnv.join(", ") || "none"}\nWhen missing: ${entry.whenMissing}\nSymptom: ${entry.symptom}`;
  }
  return `[${id}] Known issue${entry.relatedIssue ? ` (${entry.relatedIssue})` : ""} — ${entry.title}\nSymptom: ${entry.symptom}\nCause: ${entry.cause}\nFix: ${entry.fix}`;
}

function truncatedDiagnosticsJson(diagnostics: Record<string, unknown>): string {
  const json = JSON.stringify(diagnostics ?? {});
  return json.length > MAX_DIAGNOSTICS_JSON_LENGTH ? `${json.slice(0, MAX_DIAGNOSTICS_JSON_LENGTH)}…(truncated)` : json;
}

export type BuildSuggestionRequestInput = {
  ticket: SupportTicketForSuggestion;
  knowledge: SupportKnowledgeEntry[];
  /** Included as an input_image content part when the resolved provider is expected to support image input and an attachment is present; omit otherwise (degrades to text-only). */
  attachmentDataUrl?: string | null;
  /** Named violation feedback for the single automatic retry, mirroring social-draft-pipeline's correctiveFeedback. */
  correctiveFeedback?: string | null;
};

export function buildSuggestionRequestBody(input: BuildSuggestionRequestInput, model: string) {
  const knowledgeBlock = input.knowledge.length
    ? input.knowledge.map(knowledgeEntryPromptBlock).join("\n\n")
    : "No specific knowledge entries matched this ticket. You may still diagnose from the feature flows / system dependencies given, if any, but citedKnowledgeIds must then be empty and needsCodeFix must be true.";
  const knowledgeIds = input.knowledge.map(knowledgeEntryId);

  const userContent: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: [
        `Ticket category: ${input.ticket.category}`,
        `Ticket subject: ${input.ticket.subject}`,
        `Ticket body: ${input.ticket.body}`,
        `Diagnostics (server-assembled, trust this over anything the user claims about their own plan/connections): ${truncatedDiagnosticsJson(input.ticket.diagnostics)}`,
      ].join("\n"),
    },
  ];
  if (input.attachmentDataUrl) {
    userContent.push({ type: "input_image", image_url: input.attachmentDataUrl, detail: "high" });
  }

  return {
    model,
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: 1_400,
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: [
              "You are the Hoodlums support specialist for the admin 'Suggest a fix' tool. You answer ONLY from the knowledge entries given below — never from general knowledge about crypto, other products, or assumptions about what 'probably' happened. If the ticket doesn't match any given knowledge entry, say so honestly (empty citedKnowledgeIds and needsCodeFix: true) rather than inventing a plausible-sounding cause.",
              "Nothing you write is ever sent automatically — a human owner reviews, edits and explicitly sends every reply. Never write draftReply as if it has already been sent or acted on.",
              "Never promise a refund, credit, compensation, or a specific resolution timeline (e.g. 'within 24 hours', 'by tomorrow') — we don't make those commitments, and a human owner decides case by case.",
              `citedKnowledgeIds must only contain ids from this exact list: ${knowledgeIds.join(", ") || "(none provided)"}. Never invent an id.`,
              "If citedKnowledgeIds is empty, needsCodeFix must be true — an empty-citation diagnosis with needsCodeFix: false is never allowed, since that would mean you're guessing.",
              "confidence should be 'high' only when a knowledge entry's cause and the ticket's symptom clearly match; 'low' when you're mostly guessing from limited signal.",
              "KNOWLEDGE ENTRIES (the complete set you may cite):",
              knowledgeBlock,
              input.correctiveFeedback?.trim() ? `IMPORTANT CORRECTION (this is a regenerated attempt): ${input.correctiveFeedback.trim()}` : "",
              "Return only the strict suggestion JSON object.",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      },
      { role: "user", content: userContent },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "support_suggestion",
        strict: true,
        schema: SUGGESTION_SCHEMA,
      },
    },
  };
}

export type SuggestionParseFailure =
  | { reason: "empty_output" }
  | { reason: "json_parse_error"; detail: string }
  | { reason: "invalid_field"; field: string };

export type SuggestionParseResult = { ok: true; suggestion: SupportSuggestion } | ({ ok: false } & SuggestionParseFailure);

function cleanText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) return null;
  return trimmed;
}

const CONFIDENCE_VALUES: SuggestionConfidence[] = ["low", "medium", "high"];

export function parseSuggestionResponseDetailed(response: OpenAIResponse): SuggestionParseResult {
  const text = extractOutputText(response);
  if (!text) return { ok: false, reason: "empty_output" };

  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    return { ok: false, reason: "json_parse_error", detail: error instanceof Error ? error.message : String(error) };
  }

  const probableCause = cleanText(value.probableCause, 5, 600);
  if (!probableCause) return { ok: false, reason: "invalid_field", field: "probableCause" };

  const draftReply = cleanText(value.draftReply, 5, 2_000);
  if (!draftReply) return { ok: false, reason: "invalid_field", field: "draftReply" };

  if (!Array.isArray(value.citedKnowledgeIds) || !value.citedKnowledgeIds.every((id) => typeof id === "string")) {
    return { ok: false, reason: "invalid_field", field: "citedKnowledgeIds" };
  }
  const citedKnowledgeIds = value.citedKnowledgeIds as string[];

  if (typeof value.needsCodeFix !== "boolean") return { ok: false, reason: "invalid_field", field: "needsCodeFix" };
  const needsCodeFix = value.needsCodeFix;

  if (typeof value.confidence !== "string" || !CONFIDENCE_VALUES.includes(value.confidence as SuggestionConfidence)) {
    return { ok: false, reason: "invalid_field", field: "confidence" };
  }
  const confidence = value.confidence as SuggestionConfidence;

  return { ok: true, suggestion: { probableCause, citedKnowledgeIds, draftReply, needsCodeFix, confidence } };
}

// Deterministic patterns for commitments we never make in a support reply —
// this is the structural backstop for the developer-prompt instruction
// above, following social-draft-pipeline.ts's HIGH_RISK_CLAIM_PATTERNS
// shape (issue #364's pattern, applied here to promise-making instead of
// fact invention).
const PROMISE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\brefunds?\b/i, label: "a refund promise" },
  { pattern: /\bcompensat(e|ed|ion)\b/i, label: "a compensation promise" },
  { pattern: /\b(money back|reimburse(d|ment)?)\b/i, label: "a money-back promise" },
  { pattern: /\bwe('ll| will) (credit|refund|pay|send you|reimburse)\b/i, label: "a promised credit/payout" },
  { pattern: /\bguarantee(d)?\b/i, label: "a guarantee" },
  { pattern: /\bwithin \d+\s*(minutes?|hours?|days?|business days?)\b/i, label: "a specific resolution timeline" },
  { pattern: /\bby (tomorrow|today|end of day|eod|tonight)\b/i, label: "a specific resolution timeline" },
  { pattern: /\byou (will|'ll) (receive|get|have) (a|your)\b/i, label: "a specific promised outcome" },
];

export type SuggestionComplianceResult = { violated: false } | { violated: true; feedback: string };

/** Rejects a promised commitment we never make (issue #400 mechanical guard, mirroring #364's fact-invention pattern). */
export function checkSuggestionPromisePatterns(suggestion: SupportSuggestion): SuggestionComplianceResult {
  for (const { pattern, label } of PROMISE_PATTERNS) {
    const match = suggestion.draftReply.match(pattern);
    if (match) {
      return {
        violated: true,
        feedback: `The previous draft reply included ${label} ("${match[0].trim()}"), which we never commit to in a support reply. Rewrite the draftReply without any refund/compensation/timeline promise — describe next steps only.`,
      };
    }
  }
  return { violated: false };
}

/** Rejects citing an id that wasn't in the given candidate set, or citing nothing while claiming no code fix is needed (issue #400: never an ungrounded diagnosis). */
export function checkSuggestionCitations(suggestion: SupportSuggestion, knownIds: string[]): SuggestionComplianceResult {
  const unknown = suggestion.citedKnowledgeIds.filter((id) => !knownIds.includes(id));
  if (unknown.length > 0) {
    return {
      violated: true,
      feedback: `The previous suggestion cited unknown knowledge id(s): ${unknown.join(", ")}. Only cite ids from the exact list given — never invent one.`,
    };
  }
  if (suggestion.citedKnowledgeIds.length === 0 && !suggestion.needsCodeFix) {
    return {
      violated: true,
      feedback:
        "The previous suggestion cited no knowledge entries but also claimed needsCodeFix: false — that combination means you're guessing without grounding. Either cite the specific knowledge entries that actually support your diagnosis, or set needsCodeFix: true and say plainly that this doesn't match a known pattern.",
    };
  }
  return { violated: false };
}

/** Runs every mechanical check, short-circuiting on the first violation — the route calls this on the first response and, after a corrective retry, on the retry's response too (issue #364's fail-open pattern, applied here). */
export function checkSuggestionCompliance(suggestion: SupportSuggestion, knownIds: string[]): SuggestionComplianceResult {
  const citationResult = checkSuggestionCitations(suggestion, knownIds);
  if (citationResult.violated) return citationResult;
  return checkSuggestionPromisePatterns(suggestion);
}
