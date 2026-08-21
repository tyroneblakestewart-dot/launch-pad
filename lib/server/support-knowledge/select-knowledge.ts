import { matchErrorCatalogueEntries } from "@/lib/server/support-knowledge/error-catalogue";
import { FEATURE_FLOWS } from "@/lib/server/support-knowledge/feature-flows";
import { SYSTEM_DEPENDENCIES } from "@/lib/server/support-knowledge/system-dependencies";
import { KNOWN_ISSUES } from "@/lib/server/support-knowledge/known-issues";
import type { SupportKnowledgeEntry } from "@/lib/server/support-knowledge/types";

// Deterministic pre-selection (issue #400): picks the RELEVANT slice of the
// knowledge base for one ticket — never the whole corpus — so the model
// gets a small, precise grounding set instead of an expensive, noisy dump.
// Selection is entirely rule-based (category + exact error-string matches +
// diagnostics-driven rules + keyword matches), no AI call involved, which is
// what keeps this accurate and cheap.

/** Caps the prompt size — the most useful, most specific entries (error matches, then known issues) are added first, so the cap trims the least specific tail. */
export const MAX_SELECTED_KNOWLEDGE_ENTRIES = 14;

const CATEGORY_TO_FLOW_FEATURES: Record<string, string[]> = {
  account: ["account"],
  payments: ["payments"],
  "site-builder": ["site-builder", "publishing"],
  "social-studio": ["social-studio"],
  publishing: ["publishing", "site-builder"],
  other: ["support-tickets"],
};

const CATEGORY_TO_DEPENDENCY_IDS: Record<string, string[]> = {
  account: ["database"],
  payments: ["database"],
  "site-builder": ["ai-provider", "generate-site-style-shared-secret", "database"],
  "social-studio": [
    "ai-provider",
    "mascot-image-direct-openai",
    "telegram-bot",
    "x-social-credentials",
    "social-credentials-encryption-key",
    "x-monthly-cost-cap",
    "generate-site-style-shared-secret",
  ],
  publishing: ["database"],
  other: ["database"],
};

export type SelectKnowledgeInput = {
  category: string;
  body: string;
  subject?: string;
  diagnostics?: Record<string, unknown>;
};

function hasReconnectNeededConnection(diagnostics: Record<string, unknown> | undefined): boolean {
  const connections = diagnostics?.socialConnections;
  if (!Array.isArray(connections)) return false;
  return connections.some((connection) => (connection as { status?: unknown })?.status === "reconnect_needed");
}

function planLookupUnavailable(diagnostics: Record<string, unknown> | undefined): boolean {
  const plan = diagnostics?.plan as { status?: unknown } | undefined;
  return plan?.status === "unavailable";
}

/** Selects the relevant knowledge slice for one ticket. Deterministic and pure — same input always selects the same entries, and entries are ordered most-specific first so a downstream cap keeps the highest-value entries. */
export function selectRelevantKnowledge(input: SelectKnowledgeInput): SupportKnowledgeEntry[] {
  const bodyText = `${input.subject ?? ""}\n${input.body}`;
  const bodyLower = bodyText.toLowerCase();
  const selected: SupportKnowledgeEntry[] = [];
  const seen = new Set<string>();

  function add(entry: SupportKnowledgeEntry): void {
    const id = `${entry.kind}:${entry.id}`;
    if (seen.has(id)) return;
    seen.add(id);
    selected.push(entry);
  }

  // 1. Exact/pattern error-string matches in the ticket body — the most
  // precise possible signal, since the user is quoting the actual error.
  for (const entry of matchErrorCatalogueEntries(bodyText)) {
    add({ kind: "error", ...entry });
  }

  // 2. Known-issue playbook keyword matches.
  for (const entry of KNOWN_ISSUES) {
    if (entry.keywords.some((keyword) => bodyLower.includes(keyword))) {
      add({ kind: "known-issue", ...entry });
    }
  }

  // 3. Diagnostics-driven rules.
  if (planLookupUnavailable(input.diagnostics)) {
    const dependency = SYSTEM_DEPENDENCIES.find((entry) => entry.id === "database");
    if (dependency) add({ kind: "dependency", ...dependency });
  }
  if (hasReconnectNeededConnection(input.diagnostics)) {
    const dependency = SYSTEM_DEPENDENCIES.find((entry) => entry.id === "social-credentials-encryption-key");
    if (dependency) add({ kind: "dependency", ...dependency });
    const known = KNOWN_ISSUES.find((entry) => entry.id === "connection-not-held-across-tabs-384");
    if (known) add({ kind: "known-issue", ...known });
  }

  // 4. Category-scoped feature flows.
  const flowFeatures = CATEGORY_TO_FLOW_FEATURES[input.category] ?? [];
  for (const flow of FEATURE_FLOWS) {
    if (flowFeatures.includes(flow.feature)) add({ kind: "flow", ...flow });
  }

  // 5. Category-scoped system dependencies.
  const dependencyIds = CATEGORY_TO_DEPENDENCY_IDS[input.category] ?? ["database"];
  for (const dependency of SYSTEM_DEPENDENCIES) {
    if (dependencyIds.includes(dependency.id)) add({ kind: "dependency", ...dependency });
  }

  return selected.slice(0, MAX_SELECTED_KNOWLEDGE_ENTRIES);
}
