// Sorting-station feedback on Voice preview sample lines (issue #348, reworked
// for the owner's sorting station). Pure logic shared by the studio UI
// (components/social-hub.tsx, persisted via lib/social-studio-db.ts alongside
// the voice profile) and the server-side voice-profile/draft pipelines that
// turn kept lines into the persona the model writes from.
//
// Three verdicts per sample: "fire" (kept, protected), "liked" ("Sounds
// right" — kept), "disliked" ("Bin" — discarded, remembered only so the same
// text is never re-served or reinforced). Fire and liked together form the
// persona bank of PERSONA_BANK_SIZE lines; every one of them is read on every
// draft, ranked below the user's real pasted posts.

import type { SampleLineFeedback } from "@/lib/social-studio-types";

/** How many kept lines (fire + liked) the persona bank holds. Owner decision: 30. */
export const PERSONA_BANK_SIZE = 30;

/**
 * How many kept lines reach a prompt. Owner decision (5 Sep 2026): the whole
 * bank — every sample in it started life as one of the user's own pasted
 * posts reshaped to their project, so the old 5-line drift guard is no
 * longer needed; the pasted posts still always outrank these.
 */
export const MAX_REINFORCEMENT_SAMPLE_LINES = PERSONA_BANK_SIZE;

/** How many binned lines are remembered so they are never re-served. Kept separate from the bank so a Bin can never evict a kept line. */
export const MAX_STORED_DISLIKED_LINES = 60;

/** Total stored entries: the full bank plus the bin memory. */
export const MAX_STORED_SAMPLE_LINE_FEEDBACK = PERSONA_BANK_SIZE + MAX_STORED_DISLIKED_LINES;

export type KeptSentiment = Extract<SampleLineFeedback["sentiment"], "fire" | "liked">;

export function isKeptSentiment(sentiment: SampleLineFeedback["sentiment"]): sentiment is KeptSentiment {
  return sentiment === "fire" || sentiment === "liked";
}

function safeList(current: readonly SampleLineFeedback[] | null | undefined): SampleLineFeedback[] {
  return Array.isArray(current) ? [...current] : [];
}

function byNewestFirst(a: SampleLineFeedback, b: SampleLineFeedback): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

/** The kept lines (fire + liked), newest first. */
export function keptSampleLines(feedback: readonly SampleLineFeedback[] | null | undefined): SampleLineFeedback[] {
  return safeList(feedback).filter((entry) => isKeptSentiment(entry.sentiment)).sort(byNewestFirst);
}

/** Whether the bank is full — Fire and Sounds right must be blocked until the user clears. */
export function isPersonaBankFull(feedback: readonly SampleLineFeedback[] | null | undefined): boolean {
  return keptSampleLines(feedback).length >= PERSONA_BANK_SIZE;
}

/**
 * Records one verdict on one sample line. Marking a line with the sentiment
 * it already has removes the entry (tap-to-undo); marking it with another
 * sentiment replaces any existing entry for that exact text. A kept verdict
 * on a full bank is refused and the input returned unchanged — the caller
 * shows the clear controls instead. Bin memory is capped separately at
 * MAX_STORED_DISLIKED_LINES, oldest first, so a Bin can never push a kept
 * line out of the bank.
 */
export function toggleSampleLineFeedback(
  current: readonly SampleLineFeedback[] | null | undefined,
  text: string,
  sentiment: SampleLineFeedback["sentiment"],
  updatedAt: string,
): SampleLineFeedback[] {
  const safeCurrent = safeList(current);
  const trimmed = text.trim();
  if (!trimmed) return safeCurrent;

  const existing = safeCurrent.find((entry) => entry.text === trimmed);
  const withoutExisting = safeCurrent.filter((entry) => entry.text !== trimmed);

  if (existing && existing.sentiment === sentiment) {
    return withoutExisting;
  }

  if (isKeptSentiment(sentiment) && !(existing && isKeptSentiment(existing.sentiment)) && isPersonaBankFull(withoutExisting)) {
    return safeCurrent;
  }

  const next = [...withoutExisting, { text: trimmed, sentiment, updatedAt }];
  const kept = next.filter((entry) => isKeptSentiment(entry.sentiment));
  const disliked = next.filter((entry) => !isKeptSentiment(entry.sentiment)).slice(-MAX_STORED_DISLIKED_LINES);
  const survivors = new Set([...kept, ...disliked]);
  return next.filter((entry) => survivors.has(entry));
}

/**
 * "Clear 50%": drops the oldest half of the Sounds-right lines. Fire lines are
 * never touched, and the user does not choose which half goes. Returns the
 * input unchanged when there is nothing eligible (e.g. a bank of only Fire).
 */
export function clearHalfOfPersonaBank(current: readonly SampleLineFeedback[] | null | undefined): SampleLineFeedback[] {
  const safeCurrent = safeList(current);
  const liked = safeCurrent.filter((entry) => entry.sentiment === "liked").sort(byNewestFirst);
  const keptTotal = safeCurrent.filter((entry) => isKeptSentiment(entry.sentiment)).length;
  const toRemove = Math.min(liked.length, Math.ceil(keptTotal / 2));
  if (toRemove === 0) return safeCurrent;
  const removed = new Set(liked.slice(liked.length - toRemove));
  return safeCurrent.filter((entry) => !removed.has(entry));
}

/** "Clear all": empties the bank — Fire included — and keeps only the bin memory. */
export function clearPersonaBank(current: readonly SampleLineFeedback[] | null | undefined): SampleLineFeedback[] {
  return safeList(current).filter((entry) => !isKeptSentiment(entry.sentiment));
}

/**
 * The persona lines fed to a prompt: Fire lines first (newest first within
 * the tier), then Sounds-right lines newest first, capped at
 * MAX_REINFORCEMENT_SAMPLE_LINES. Binned lines are excluded entirely —
 * a Bin is a "don't reinforce this" signal, never negative training material.
 */
export function likedReinforcementLines(feedback: readonly SampleLineFeedback[] | null | undefined): string[] {
  const kept = keptSampleLines(feedback);
  const fire = kept.filter((entry) => entry.sentiment === "fire");
  const liked = kept.filter((entry) => entry.sentiment === "liked");
  return [...fire, ...liked].slice(0, MAX_REINFORCEMENT_SAMPLE_LINES).map((entry) => entry.text);
}
