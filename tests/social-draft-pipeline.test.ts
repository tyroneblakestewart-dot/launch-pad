import { describe, expect, it } from "vitest";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import {
  X_DRAFT_CHARACTER_LIMIT,
  buildDraftRequestBody,
  parseDraftResponse,
  parseDraftResponseDetailed,
  type DraftProject,
} from "@/lib/server/social-draft-pipeline";
import type { VoiceProfile } from "@/lib/social-studio-types";

function responseWith(payload: unknown): OpenAIResponse {
  return { output: [{ content: [{ type: "output_text", text: JSON.stringify(payload) }] }] };
}

const PROJECT: DraftProject = {
  name: "Test Coin",
  ticker: "TEST",
  description: "A community-driven meme token.",
  chain: "solana",
  contractAddress: "",
};

const VOICE: VoiceProfile = {
  tone: "confident and playful",
  vocabulary: "crypto-native slang",
  cadence: "short punchy sentences",
  emojiHabits: "one emoji max",
  sampleLines: ["a", "b", "c"],
  exampleCount: 4,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("buildDraftRequestBody", () => {
  it("includes the 280-character instruction and project details", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain(`${X_DRAFT_CHARACTER_LIMIT} characters or fewer`);
    expect(developerText).toContain("No taught voice is available yet");
    const userText = body.input[1]?.content[0]?.text ?? "";
    expect(userText).toContain("Test Coin");
    expect(userText).toContain("TEST");
  });

  it("instructs the model to never include a link, assuming the bio carries it (issue #342 cost control)", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("Never include a link or URL");
    expect(developerText).toContain("profile bio");
  });

  it("threads the voice profile into the developer instructions when supplied", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: VOICE }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("confident and playful");
    expect(developerText).not.toContain("No taught voice is available yet");
  });

  it("includes the day label and theme when supplied for the calendar flow", () => {
    const body = buildDraftRequestBody(
      { project: PROJECT, voiceProfile: null, dayLabel: "15 August 2026", theme: "milestone" },
      "gpt-5-mini",
    );
    const userText = body.input[1]?.content[0]?.text ?? "";
    expect(userText).toContain("15 August 2026");
    expect(userText).toContain("milestone");
  });

  it("sets minimal reasoning effort and a raised output budget so hidden reasoning cannot truncate the JSON (issue #346)", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    expect(body.reasoning).toEqual({ effort: "minimal" });
    expect(body.max_output_tokens).toBe(1_200);
  });

  it("omits reinforcement material when no liked sample lines are supplied (issue #348)", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: VOICE }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).not.toContain("previously approved");
  });

  it("includes liked sample lines as capped, ordered secondary reinforcement behind the taught voice (issue #348)", () => {
    const body = buildDraftRequestBody(
      { project: PROJECT, voiceProfile: VOICE, likedSampleLines: ["most recent liked line", "older liked line"] },
      "gpt-5-mini",
    );
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("1. most recent liked line");
    expect(developerText).toContain("2. older liked line");
    expect(developerText.indexOf("most recent liked line")).toBeLessThan(developerText.indexOf("older liked line"));

    // Guard against voice drift: the taught-voice description (built from real posts) is stated as primary.
    expect(developerText).toContain("secondary reinforcement only");
    expect(developerText).toContain("primary and authoritative reference");
    expect(developerText.indexOf("confident and playful")).toBeLessThan(developerText.indexOf("most recent liked line"));
  });
});

describe("parseDraftResponse", () => {
  it("parses a valid draft", () => {
    const result = parseDraftResponse(responseWith({ xText: "Short X post about Test Coin.", telegramText: "A longer Telegram post about Test Coin with more detail." }));
    expect(result).toEqual({
      xText: "Short X post about Test Coin.",
      telegramText: "A longer Telegram post about Test Coin with more detail.",
    });
  });

  it("truncates an X draft over the 280-character limit at a word boundary", () => {
    const longXText = `${"word ".repeat(60)}tail`;
    expect(longXText.length).toBeGreaterThan(X_DRAFT_CHARACTER_LIMIT);
    const result = parseDraftResponse(responseWith({ xText: longXText, telegramText: "Telegram text is fine." }));
    expect(result?.xText.length).toBeLessThanOrEqual(X_DRAFT_CHARACTER_LIMIT);
    expect(longXText.startsWith(result?.xText ?? "***")).toBe(true);
  });

  it("returns null when a required field is missing", () => {
    expect(parseDraftResponse(responseWith({ xText: "Only the X text." }))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const response: OpenAIResponse = { output: [{ content: [{ type: "output_text", text: "not json" }] }] };
    expect(parseDraftResponse(response)).toBeNull();
  });
});

describe("parseDraftResponseDetailed", () => {
  it("reports empty_output for an empty response", () => {
    expect(parseDraftResponseDetailed({ output: [] })).toEqual({ ok: false, reason: "empty_output" });
  });

  it("reports json_parse_error with a detail message for malformed JSON", () => {
    const response: OpenAIResponse = { output: [{ content: [{ type: "output_text", text: "not json" }] }] };
    const result = parseDraftResponseDetailed(response);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("json_parse_error");
      expect(typeof result.detail).toBe("string");
    }
  });

  it("reports invalid_field with the field name and received length when xText is rejected", () => {
    const result = parseDraftResponseDetailed(responseWith({ xText: "hi", telegramText: "Telegram text is fine." }));
    expect(result).toEqual({ ok: false, reason: "invalid_field", field: "xText", receivedLength: 2 });
  });

  it("reports invalid_field for telegramText when xText passes but telegramText is rejected", () => {
    const result = parseDraftResponseDetailed(responseWith({ xText: "A fine X post.", telegramText: "no" }));
    expect(result).toEqual({ ok: false, reason: "invalid_field", field: "telegramText", receivedLength: 2 });
  });

  it("returns ok:true with the draft on success", () => {
    const result = parseDraftResponseDetailed(
      responseWith({ xText: "A fine X post.", telegramText: "A fine Telegram post." }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.xText).toBe("A fine X post.");
    }
  });
});
