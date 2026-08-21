// Shared types for the Hoodlums support knowledge base (issue #400). This is
// the grounding corpus the admin "Suggest a fix" AI is restricted to — it
// answers only from these entries, never general knowledge, so a suggestion
// can always be traced back to a specific, code-sourced fact. Server-only:
// never imported by client code.

/** Matches either a literal error string, or a family of near-duplicate error strings that share one cause/fix (e.g. every "wallet challenge expired" variant). */
export type ErrorCatalogueMatch = { type: "exact"; value: string } | { type: "pattern"; value: RegExp };

export type ErrorCatalogueEntry = {
  id: string;
  match: ErrorCatalogueMatch;
  /** Free-form feature label (not the support-ticket category enum) — several entries are cross-cutting ("shared"). */
  whichFeature: string;
  cause: string;
  fix: string;
  /** Starting point for a reply to the reporting wallet — always edited by the owner before sending, never auto-sent. */
  userReplyTemplate: string;
};

export type FeatureFlowStatusMeaning = { status: string; meaning: string };

export type FeatureFlowEntry = {
  id: string;
  feature: string;
  summary: string;
  steps: string[];
  statuses?: FeatureFlowStatusMeaning[];
};

export type SystemDependencyEntry = {
  id: string;
  feature: string;
  requiredEnv: string[];
  /** What actually happens when requiredEnv is missing/misconfigured — a graceful fallback, a 503, a dormant feature, etc. */
  whenMissing: string;
  /** What the reporting user or the owner actually sees/experiences when this dependency is missing. */
  symptom: string;
};

export type KnownIssueEntry = {
  id: string;
  title: string;
  relatedIssue: string | null;
  symptom: string;
  cause: string;
  fix: string;
  /** Lowercase keywords used by deterministic selection to match this entry against a ticket's category/body. */
  keywords: string[];
};

export type SupportKnowledgeEntry =
  | ({ kind: "error" } & ErrorCatalogueEntry)
  | ({ kind: "flow" } & FeatureFlowEntry)
  | ({ kind: "dependency" } & SystemDependencyEntry)
  | ({ kind: "known-issue" } & KnownIssueEntry);

export function knowledgeEntryId(entry: SupportKnowledgeEntry): string {
  return `${entry.kind}:${entry.id}`;
}
