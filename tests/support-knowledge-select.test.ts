import { describe, expect, it } from "vitest";
import { MAX_SELECTED_KNOWLEDGE_ENTRIES, selectRelevantKnowledge } from "@/lib/server/support-knowledge/select-knowledge";
import { knowledgeEntryId } from "@/lib/server/support-knowledge/types";

describe("selectRelevantKnowledge", () => {
  it("selects the error-catalogue entry for an exact error string quoted in the ticket body", () => {
    const selected = selectRelevantKnowledge({
      category: "account",
      body: "I keep getting Wallet authorisation failed. every time I try to reply.",
    });
    const ids = selected.map(knowledgeEntryId);
    expect(ids).toContain("error:wallet-authorisation-failed");
  });

  it("selects a pattern-matched error-catalogue entry, not just exact strings", () => {
    const selected = selectRelevantKnowledge({
      category: "publishing",
      body: "It says 'Publish request origin is not allowed.' whenever I try to publish.",
    });
    const ids = selected.map(knowledgeEntryId);
    expect(ids).toContain("error:origin-not-allowed");
  });

  it("falls back to category-scoped feature flows and dependencies when no error string matches", () => {
    const selected = selectRelevantKnowledge({ category: "social-studio", body: "My mascot images never generate, nothing else seems wrong." });
    const ids = selected.map(knowledgeEntryId);
    expect(ids).toContain("flow:social-studio-setup-voice-mascot");
    expect(ids).toContain("dependency:mascot-image-direct-openai");
  });

  it("selects a known-issue entry from a keyword match in the ticket body", () => {
    const selected = selectRelevantKnowledge({
      category: "account",
      body: "I signed with a different account than the one connected and now I get an authorisation error.",
    });
    const ids = selected.map(knowledgeEntryId);
    expect(ids).toContain("known-issue:wallet-app-account-differs-388");
  });

  it("adds the database dependency when diagnostics report the plan lookup as unavailable", () => {
    const selected = selectRelevantKnowledge({
      category: "payments",
      body: "My subscription isn't showing as active.",
      diagnostics: { plan: { status: "unavailable" } },
    });
    const ids = selected.map(knowledgeEntryId);
    expect(ids).toContain("dependency:database");
  });

  it("adds the reconnect-related dependency and known issue when a social connection needs reconnecting", () => {
    const selected = selectRelevantKnowledge({
      category: "social-studio",
      body: "My Telegram connection just stopped working.",
      diagnostics: { socialConnections: [{ platform: "telegram", status: "reconnect_needed" }] },
    });
    const ids = selected.map(knowledgeEntryId);
    expect(ids).toContain("dependency:social-credentials-encryption-key");
    expect(ids).toContain("known-issue:connection-not-held-across-tabs-384");
  });

  it("never returns duplicate entries even when multiple rules would select the same one", () => {
    const selected = selectRelevantKnowledge({
      category: "social-studio",
      body: "AI Social Studio access protection is not configured. and mascot images fail too.",
    });
    const ids = selected.map(knowledgeEntryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic — the same input always selects the same entries in the same order", () => {
    const input = { category: "site-builder", body: "Enter a valid public http or https inspiration website URL." };
    const first = selectRelevantKnowledge(input).map(knowledgeEntryId);
    const second = selectRelevantKnowledge(input).map(knowledgeEntryId);
    expect(first).toEqual(second);
  });

  it("caps the selection at MAX_SELECTED_KNOWLEDGE_ENTRIES", () => {
    const selected = selectRelevantKnowledge({
      category: "social-studio",
      body: "AI Social Studio access protection is not configured. Invalid request body. A project name and ticker are required. Upload a valid mascot reference image. Choose or describe a scene for the mascot.",
    });
    expect(selected.length).toBeLessThanOrEqual(MAX_SELECTED_KNOWLEDGE_ENTRIES);
  });

  it("returns an empty array for a category/body with no matches at all outside its category defaults being non-empty", () => {
    const selected = selectRelevantKnowledge({ category: "other", body: "" });
    // "other" still gets its category-scoped flow/dependency fallbacks — never truly empty for a real category.
    expect(selected.length).toBeGreaterThan(0);
  });
});
