import { describe, expect, it } from "vitest";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import {
  MAX_VOICE_EXAMPLES,
  buildVoiceProfileRequestBody,
  normaliseVoiceExamples,
  parseVoiceProfileResponse,
  parseVoiceProfileResponseDetailed,
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

  it("sets minimal reasoning effort and a raised output budget so hidden reasoning cannot truncate the JSON (issue #346)", () => {
    const body = buildVoiceProfileRequestBody({ name: "Test Coin", ticker: "TEST" }, ["example one", "example two"], "gpt-5-mini");
    expect(body.reasoning).toEqual({ effort: "minimal" });
    expect(body.max_output_tokens).toBe(1_500);
  });

  it("states the exactly-three-sample-lines requirement explicitly in the prompt, since strict mode does not enforce minItems/maxItems", () => {
    const body = buildVoiceProfileRequestBody({ name: "Test Coin", ticker: "TEST" }, ["example one", "example two"], "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("exactly three");
  });

  it("omits reinforcement material entirely when no liked sample lines are supplied (issue #348)", () => {
    const body = buildVoiceProfileRequestBody({ name: "Test Coin", ticker: "TEST" }, ["example one", "example two"], "gpt-5-mini");
    const userText = body.input[1]?.content[0]?.text ?? "";
    expect(userText).not.toContain("previously approved");
  });

  it("includes liked sample lines as secondary reinforcement, ordered as given, alongside the pasted examples (issue #348)", () => {
    const body = buildVoiceProfileRequestBody(
      { name: "Test Coin", ticker: "TEST" },
      ["example one", "example two"],
      "gpt-5-mini",
      ["most recent liked line", "older liked line"],
    );
    const userText = body.input[1]?.content[0]?.text ?? "";
    expect(userText).toContain("example one");
    expect(userText).toContain("1. most recent liked line");
    expect(userText).toContain("2. older liked line");
    expect(userText.indexOf("most recent liked line")).toBeLessThan(userText.indexOf("older liked line"));

    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("secondary reinforcement only");
  });

  it("states in the prompt that pasted examples always take precedence over liked lines, guarding against voice drift", () => {
    const body = buildVoiceProfileRequestBody(
      { name: "Test Coin", ticker: "TEST" },
      ["example one", "example two"],
      "gpt-5-mini",
      ["liked line"],
    );
    const userText = body.input[1]?.content[0]?.text ?? "";
    expect(userText).toContain("Treat them as secondary reinforcement only");
    expect(userText).toContain("always take precedence over these approved lines");
    // The pasted examples appear before the liked-lines block in the same message.
    expect(userText.indexOf("Example posts")).toBeLessThan(userText.indexOf("previously approved"));
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

  it("accepts a short-but-valid emojiHabits value the model can legitimately return (issue #346)", () => {
    const shortEmoji = { ...VALID_PROFILE, emojiHabits: "None" };
    const result = parseVoiceProfileResponse(responseWith(shortEmoji), 5);
    expect(result?.emojiHabits).toBe("None");
  });

  it("accepts short-but-valid tone/vocabulary/cadence values below the old 10-char floor", () => {
    const short = { ...VALID_PROFILE, tone: "Warm", vocabulary: "Plain", cadence: "Short" };
    const result = parseVoiceProfileResponse(responseWith(short), 5);
    expect(result?.tone).toBe("Warm");
  });
});

describe("parseVoiceProfileResponseDetailed", () => {
  it("reports empty_output for an empty response", () => {
    expect(parseVoiceProfileResponseDetailed({ output: [] }, 5)).toEqual({ ok: false, reason: "empty_output" });
  });

  it("reports json_parse_error with a detail message for truncated/malformed JSON", () => {
    const response = { output: [{ content: [{ type: "output_text", text: '{"tone": "confident and playf' }] }] };
    const result = parseVoiceProfileResponseDetailed(response, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("json_parse_error");
      expect(typeof result.detail).toBe("string");
    }
  });

  it("reports invalid_field with the field name and received length when a field fails cleaning", () => {
    const invalid = { ...VALID_PROFILE, tone: "" };
    const result = parseVoiceProfileResponseDetailed(responseWith(invalid), 5);
    expect(result).toEqual({ ok: false, reason: "invalid_field", field: "tone", receivedLength: 0 });
  });

  it("reports sample_lines_count with the received count when not exactly three", () => {
    const invalid = { ...VALID_PROFILE, sampleLines: ["only one line"] };
    const result = parseVoiceProfileResponseDetailed(responseWith(invalid), 5);
    expect(result).toEqual({ ok: false, reason: "sample_lines_count", count: 1 });
  });

  it("returns ok:true with the profile on success", () => {
    const result = parseVoiceProfileResponseDetailed(responseWith(VALID_PROFILE), 5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.tone).toBe(VALID_PROFILE.tone);
    }
  });
});
