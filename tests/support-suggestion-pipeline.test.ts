import { describe, expect, it } from "vitest";
import {
  buildSuggestionRequestBody,
  checkSuggestionCitations,
  checkSuggestionCompliance,
  checkSuggestionPromisePatterns,
  parseSuggestionResponseDetailed,
} from "@/lib/server/support-suggestion-pipeline";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import type { SupportKnowledgeEntry } from "@/lib/server/support-knowledge/types";

const KNOWLEDGE: SupportKnowledgeEntry[] = [
  {
    kind: "error",
    id: "wallet-authorisation-failed",
    match: { type: "pattern", value: /Wallet authorisation failed\./ },
    whichFeature: "shared",
    cause: "Wrong wallet signed.",
    fix: "Ask which wallet signed.",
    userReplyTemplate: "Please confirm your wallet account.",
  },
];

function textResponse(value: Record<string, unknown>): OpenAIResponse {
  return { output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] };
}

describe("buildSuggestionRequestBody", () => {
  it("includes every given knowledge entry id in the developer prompt's allow-list", () => {
    const body = buildSuggestionRequestBody(
      { ticket: { category: "account", subject: "s", body: "b", diagnostics: {} }, knowledge: KNOWLEDGE },
      "gpt-5-mini",
    );
    const developerText = body.input[0].content[0].text as string;
    expect(developerText).toContain("error:wallet-authorisation-failed");
  });

  it("omits the image content part when no attachment is supplied", () => {
    const body = buildSuggestionRequestBody(
      { ticket: { category: "account", subject: "s", body: "b", diagnostics: {} }, knowledge: KNOWLEDGE },
      "gpt-5-mini",
    );
    const userContent = body.input[1].content as Array<{ type: string }>;
    expect(userContent.some((part) => part.type === "input_image")).toBe(false);
  });

  it("includes an input_image part when an attachment is supplied", () => {
    const body = buildSuggestionRequestBody(
      {
        ticket: { category: "account", subject: "s", body: "b", diagnostics: {} },
        knowledge: KNOWLEDGE,
        attachmentDataUrl: "data:image/png;base64,aGVsbG8=",
      },
      "gpt-5-mini",
    );
    const userContent = body.input[1].content as Array<{ type: string; image_url?: string }>;
    const image = userContent.find((part) => part.type === "input_image");
    expect(image?.image_url).toBe("data:image/png;base64,aGVsbG8=");
  });

  it("threads corrective feedback into the developer prompt", () => {
    const body = buildSuggestionRequestBody(
      {
        ticket: { category: "account", subject: "s", body: "b", diagnostics: {} },
        knowledge: KNOWLEDGE,
        correctiveFeedback: "Do not cite unknown ids.",
      },
      "gpt-5-mini",
    );
    const developerText = body.input[0].content[0].text as string;
    expect(developerText).toContain("IMPORTANT CORRECTION");
    expect(developerText).toContain("Do not cite unknown ids.");
  });
});

describe("parseSuggestionResponseDetailed", () => {
  it("parses a well-formed structured response", () => {
    const result = parseSuggestionResponseDetailed(
      textResponse({
        probableCause: "Wrong wallet signed the challenge.",
        citedKnowledgeIds: ["error:wallet-authorisation-failed"],
        draftReply: "Please confirm you're on the same connected wallet.",
        needsCodeFix: false,
        confidence: "high",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suggestion.confidence).toBe("high");
      expect(result.suggestion.citedKnowledgeIds).toEqual(["error:wallet-authorisation-failed"]);
    }
  });

  it("fails on empty output", () => {
    const result = parseSuggestionResponseDetailed({ output: [] });
    expect(result.ok).toBe(false);
  });

  it("fails on an invalid confidence value", () => {
    const result = parseSuggestionResponseDetailed(
      textResponse({
        probableCause: "Wrong wallet signed the challenge.",
        citedKnowledgeIds: [],
        draftReply: "Please confirm your wallet.",
        needsCodeFix: true,
        confidence: "extremely-high",
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("fails when citedKnowledgeIds contains a non-string", () => {
    const result = parseSuggestionResponseDetailed(
      textResponse({
        probableCause: "Wrong wallet signed the challenge.",
        citedKnowledgeIds: [123],
        draftReply: "Please confirm your wallet.",
        needsCodeFix: false,
        confidence: "low",
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("checkSuggestionCitations", () => {
  it("rejects an id outside the known set", () => {
    const result = checkSuggestionCitations(
      {
        probableCause: "x",
        citedKnowledgeIds: ["error:made-up-id"],
        draftReply: "y",
        needsCodeFix: false,
        confidence: "low",
      },
      ["error:wallet-authorisation-failed"],
    );
    expect(result.violated).toBe(true);
  });

  it("rejects empty citations paired with needsCodeFix: false", () => {
    const result = checkSuggestionCitations(
      { probableCause: "x", citedKnowledgeIds: [], draftReply: "y", needsCodeFix: false, confidence: "low" },
      ["error:wallet-authorisation-failed"],
    );
    expect(result.violated).toBe(true);
  });

  it("allows empty citations when needsCodeFix is true", () => {
    const result = checkSuggestionCitations(
      { probableCause: "x", citedKnowledgeIds: [], draftReply: "y", needsCodeFix: true, confidence: "low" },
      ["error:wallet-authorisation-failed"],
    );
    expect(result.violated).toBe(false);
  });

  it("allows a cited id present in the known set", () => {
    const result = checkSuggestionCitations(
      {
        probableCause: "x",
        citedKnowledgeIds: ["error:wallet-authorisation-failed"],
        draftReply: "y",
        needsCodeFix: false,
        confidence: "high",
      },
      ["error:wallet-authorisation-failed"],
    );
    expect(result.violated).toBe(false);
  });
});

describe("checkSuggestionPromisePatterns", () => {
  const base = {
    probableCause: "x",
    citedKnowledgeIds: ["error:wallet-authorisation-failed"],
    needsCodeFix: false,
    confidence: "high" as const,
  };

  it("rejects a refund promise", () => {
    const result = checkSuggestionPromisePatterns({ ...base, draftReply: "We will refund your payment." });
    expect(result.violated).toBe(true);
  });

  it("rejects a specific resolution timeline", () => {
    const result = checkSuggestionPromisePatterns({ ...base, draftReply: "This will be fixed within 24 hours." });
    expect(result.violated).toBe(true);
  });

  it("rejects a guarantee", () => {
    const result = checkSuggestionPromisePatterns({ ...base, draftReply: "We guarantee this will work next time." });
    expect(result.violated).toBe(true);
  });

  it("allows an ordinary reply with no promise language", () => {
    const result = checkSuggestionPromisePatterns({
      ...base,
      draftReply: "Please confirm your wallet is on the same connected account and try again.",
    });
    expect(result.violated).toBe(false);
  });
});

describe("checkSuggestionCompliance", () => {
  it("checks citations before promise patterns and returns the first violation", () => {
    const result = checkSuggestionCompliance(
      {
        probableCause: "x",
        citedKnowledgeIds: ["error:unknown"],
        draftReply: "We will refund you.",
        needsCodeFix: false,
        confidence: "low",
      },
      ["error:wallet-authorisation-failed"],
    );
    expect(result.violated).toBe(true);
    if (result.violated) expect(result.feedback).toContain("unknown knowledge id");
  });

  it("passes a fully compliant suggestion", () => {
    const result = checkSuggestionCompliance(
      {
        probableCause: "x",
        citedKnowledgeIds: ["error:wallet-authorisation-failed"],
        draftReply: "Please confirm your wallet account and try again.",
        needsCodeFix: false,
        confidence: "high",
      },
      ["error:wallet-authorisation-failed"],
    );
    expect(result.violated).toBe(false);
  });
});
