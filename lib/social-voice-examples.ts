// Client-side hygiene for "Teach the AI your voice" (issue #340). Pasting
// copied web page content (nav labels, copyright lines, ad slots) used to be
// counted and sent to /api/social/voice-profile as if it were real voice
// examples. This filters that furniture out before counting/sending, while
// leaving the user's raw pasted text untouched in the textarea itself.

export const MIN_VOICE_EXAMPLE_LENGTH = 15;
export const MIN_USABLE_VOICE_EXAMPLES = 2;

const BOILERPLATE_LINE_PATTERNS: RegExp[] = [
  /^[\W_]+$/u, // punctuation/symbols only, no letters or digits
  /^©/, // copyright line
  /\(c\)\s*\d{4}/i,
  /all rights reserved/i,
  /^(ads?|advertisement|sponsored)\b/i,
  /^\d+$/, // a bare number (e.g. a stray page count)
  /^(more|menu|home|log ?in|log ?out|sign ?up|sign ?in|subscribe|share|follow|reply|retweet|repost|like|comment|comments|skip to content|cookie policy|privacy policy|terms of service|back to top)$/i,
];

export type VoiceExampleFilterResult = {
  /** Non-empty pasted lines, before hygiene filtering. */
  pastedLines: string[];
  /** Lines that pass the hygiene filter, de-duplicated, in original order. */
  usable: string[];
  /** How many non-empty lines were pasted in total. */
  pastedLineCount: number;
  /** How many of the pasted lines were rejected (too short, boilerplate, or duplicate). */
  rejectedCount: number;
};

function isBoilerplateLine(line: string): boolean {
  return BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

/** Separates real voice examples from page furniture: short lines, boilerplate, and case-insensitive duplicates are excluded from `usable`. */
export function filterUsableVoiceExamples(rawText: string): VoiceExampleFilterResult {
  const pastedLines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const usable: string[] = [];
  for (const line of pastedLines) {
    if (line.length < MIN_VOICE_EXAMPLE_LENGTH) continue;
    if (isBoilerplateLine(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    usable.push(line);
  }

  return {
    pastedLines,
    usable,
    pastedLineCount: pastedLines.length,
    rejectedCount: pastedLines.length - usable.length,
  };
}

/** The design's ideal example count — the "/ 20" in the trainer, and the target the hint line counts down to. */
export const VOICE_EXAMPLE_TARGET = 20;

/**
 * The one-line hint under the EXAMPLES ADDED bar, from the design's own
 * copy: nothing yet / how many more until the voice "locks in" / trained.
 */
export function voiceTrainingHint(usableCount: number, target: number = VOICE_EXAMPLE_TARGET): string {
  const count = Math.max(0, Math.floor(usableCount));
  if (count === 0) return "Nothing added yet — paste your first example above.";
  if (count < target) {
    const remaining = target - count;
    return `Add ${remaining} more and the voice locks in properly.`;
  }
  return "Perfect — the voice is fully trained.";
}
