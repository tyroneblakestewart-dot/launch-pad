// "Sounds like me" / "not me" feedback on Voice preview sample lines (issue
// #348). Pure logic shared by the studio UI (components/social-hub.tsx,
// persisted via lib/social-studio-db.ts alongside the voice profile) and the
// server-side voice-profile/draft pipelines that turn liked lines into
// reinforcement examples.

import type { SampleLineFeedback } from "@/lib/social-studio-types";

// How many feedback entries survive in storage. Generous compared to
// MAX_REINFORCEMENT_SAMPLE_LINES below so a user's dislike history isn't
// lost the moment they like a few more lines than the reinforcement cap.
export const MAX_STORED_SAMPLE_LINE_FEEDBACK = 30;

// Guard against voice drift: only the most recent handful of liked lines
// ever reach a prompt, and the real pasted examples always take precedence
// over them (enforced in lib/server/social-voice-profile-pipeline.ts and
// lib/server/social-draft-pipeline.ts, not here).
export const MAX_REINFORCEMENT_SAMPLE_LINES = 5;

/**
 * Toggles one line's feedback. Marking a line with the sentiment it already
 * has removes the entry (tap-to-undo); marking it with the other sentiment
 * replaces any existing entry for that exact line text. Storage is capped
 * at MAX_STORED_SAMPLE_LINE_FEEDBACK, dropping the oldest entries first.
 */
export function toggleSampleLineFeedback(
  current: readonly SampleLineFeedback[] | null | undefined,
  text: string,
  sentiment: SampleLineFeedback["sentiment"],
  updatedAt: string,
): SampleLineFeedback[] {
  const safeCurrent = Array.isArray(current) ? current : [];
  const trimmed = text.trim();
  if (!trimmed) return [...safeCurrent];

  const existing = safeCurrent.find((entry) => entry.text === trimmed);
  const withoutExisting = safeCurrent.filter((entry) => entry.text !== trimmed);

  if (existing && existing.sentiment === sentiment) {
    return withoutExisting;
  }

  const next = [...withoutExisting, { text: trimmed, sentiment, updatedAt }];
  return next.slice(-MAX_STORED_SAMPLE_LINE_FEEDBACK);
}

/**
 * The liked lines eligible for prompt reinforcement: most-recently-liked
 * first, capped at MAX_REINFORCEMENT_SAMPLE_LINES. "Not me" lines are
 * excluded entirely — disliking is purely a client-side "don't reinforce
 * this" signal, not negative training material sent to the model.
 */
export function likedReinforcementLines(feedback: readonly SampleLineFeedback[] | null | undefined): string[] {
  if (!Array.isArray(feedback)) return [];
  return feedback
    .filter((entry) => entry.sentiment === "liked")
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, MAX_REINFORCEMENT_SAMPLE_LINES)
    .map((entry) => entry.text);
}
