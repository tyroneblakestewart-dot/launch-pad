// Pick-from-three (owner decisions, 6 Sep 2026): a bespoke purchase buys three
// generations, so the studio keeps the last three generated pages per project
// and lets the buyer choose which one is "the site". Pure, client-safe, tested
// in Node. The pages themselves live in IndexedDB with the other heavy blobs
// (lib/token-project-db.ts), never in the localStorage index.

import type { BespokeAttempts } from "@/lib/bespoke-site-access";

export const MAX_GENERATED_SITE_CANDIDATES = 3;

export type GeneratedSiteCandidate = {
  id: string;
  html: string;
  createdAt: string;
};

/**
 * Adds a freshly generated page to the front of the list, dropping an identical
 * page already present (a regenerate that produced the same HTML is one
 * design, not two) and anything past the cap — the oldest goes first.
 */
export function addGeneratedSiteCandidate(
  existing: readonly GeneratedSiteCandidate[] | null | undefined,
  html: string,
  now: Date = new Date(),
  id: string = `design-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
): GeneratedSiteCandidate[] {
  const kept = (existing ?? []).filter((candidate) => candidate.html !== html);
  return [{ id, html, createdAt: now.toISOString() }, ...kept].slice(0, MAX_GENERATED_SITE_CANDIDATES);
}

/** Oldest first, so "Design 1" is the first one made and the label never renumbers when a newer design arrives. */
export function orderGeneratedSiteCandidates(candidates: readonly GeneratedSiteCandidate[]): GeneratedSiteCandidate[] {
  return [...candidates].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** "2 of 3 designs left for this purchase" / "All 3 designs used — pick the one you want, or buy 3 more." */
export function describeBespokeAttempts(attempts: BespokeAttempts | null | undefined): string | null {
  if (!attempts) return null;
  if (attempts.remaining <= 0) {
    return `All ${attempts.allowance} designs for this purchase are used — pick the one you want, or buy 3 more.`;
  }
  return `${attempts.remaining} of ${attempts.allowance} design${attempts.allowance === 1 ? "" : "s"} left for this purchase.`;
}
