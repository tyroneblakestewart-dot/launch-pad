import { describe, expect, it } from "vitest";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import {
  MAX_VOICE_EXAMPLES,
  buildVoiceProfileRequestBody,
  normaliseVoiceExamples,
  parseVoiceProfileResponse,
} from "@/lib/server/social-voice-profile-pipeline";

function responseWith(payload: unknown): OpenAIResponse {
  return { output: [{ content: [{ type: "output_text", text: JSON.stringify(payload) }] }] };
}

const VALID_PROFILE = {
  tone: "confident and playful, never salesy",
  vocabulary: "short crypto-native slang, plain English otherwise",
  cadence: "short punchy sentences, one idea per line",
  emojiHabits: "one or two emoji per post, never more",
  sampleLines: ["First sample line about the project.", "Second sample line about the project.", "Third sample line about the project."],
};

describe("normaliseVoiceExamples", () => {
  it("rejects fewer than two examples", () => {
    const result = normaliseVoiceExamples(["only one"]);
    expect(result.ok).toBe(false);
  });

  it("rejects more than the maximum", () => {
    const many = Array.from({ length: MAX_VOICE_EXAMPLES + 1 }, (_, index) => `example ${index}`);
    const result = normaliseVoiceExamples(many);
    expect(result.ok).toBe(false);
  });

  it("rejects an example over the per-line length cap", () => {
    const result = normaliseVoiceExamples(["short one", "x".repeat(501)]);
    expect(result.ok).toBe(false);
  });

  it("trims and drops blank lines, keeping valid examples", () => {
    const result = normaliseVoiceExamples(["  first post  ", "", "second post", "   "]);
    expect(result).toEqual({ ok: true, examples: ["first post", "second post"] });
  });

  it("rejects non-array input", () => {
    expect(normaliseVoiceExamples("not an array").ok).toBe(false);
    expect(normaliseVoiceExamples(undefined).ok).toBe(false);
  });
});

describe("buildVoiceProfileRequestBody", () => {
  it("includes the project identity, examples and a strict json_schema format", () => {
    const body = buildVoiceProfileRequestBody({ name: "Test Coin", ticker: "TEST" }, ["example one", "example two"], "gpt-5-mini");
    expect(body.model).toBe("gpt-5-mini");
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.strict).toBe(true);
    const userText = body.input[1]?.content[0];
    expect(userText?.text).toContain("Test Coin");
    expect(userText?.text).toContain("TEST");
    expect(userText?.text).toContain("example one");
  });
});

describe("parseVoiceProfileResponse", () => {
  it("parses a valid voice profile and stamps exampleCount/updatedAt", () => {
    const result = parseVoiceProfileResponse(responseWith(VALID_PROFILE), 5);
    expect(result).not.toBeNull();
    expect(result?.tone).toBe(VALID_PROFILE.tone);
    expect(result?.sampleLines).toHaveLength(3);
    expect(result?.exampleCount).toBe(5);
    expect(typeof result?.updatedAt).toBe("string");
  });

  it("returns null when a required field is missing", () => {
    const { emojiHabits: _omit, ...incomplete } = VALID_PROFILE;
    void _omit;
    expect(parseVoiceProfileResponse(responseWith(incomplete), 5)).toBeNull();
  });

  it("returns null when sampleLines does not have exactly three entries", () => {
    const invalid = { ...VALID_PROFILE, sampleLines: ["only one line"] };
    expect(parseVoiceProfileResponse(responseWith(invalid), 5)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const response: OpenAIResponse = { output: [{ content: [{ type: "output_text", text: "not json" }] }] };
    expect(parseVoiceProfileResponse(response, 5)).toBeNull();
  });

  it("returns null when the response has no output text", () => {
    expect(parseVoiceProfileResponse({ output: [] }, 5)).toBeNull();
  });
});
