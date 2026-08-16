import { describe, expect, it } from "vitest";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import {
  DRAFT_ANGLES,
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

  it("omits any direction-brief instruction when none is supplied, leaving the body identical to the no-brief case (issue #358)", () => {
    const withoutBriefField = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    const withNullBrief = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, directionBrief: null }, "gpt-5-mini");
    const withEmptyBrief = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, directionBrief: "   " }, "gpt-5-mini");
    expect(withoutBriefField).toEqual(withNullBrief);
    expect(withoutBriefField).toEqual(withEmptyBrief);

    const developerText = withoutBriefField.input[0]?.content[0]?.text ?? "";
    expect(developerText).not.toContain("current focus");
  });

  it("includes the direction brief as secondary, non-verbatim steering when supplied (issue #358)", () => {
    const body = buildDraftRequestBody(
      { project: PROJECT, voiceProfile: VOICE, directionBrief: "Push the community angle, big announcement coming Friday" },
      "gpt-5-mini",
    );
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("Push the community angle, big announcement coming Friday");
    expect(developerText).toContain("current focus for this week");
    expect(developerText).toContain("do not quote it verbatim");

    // Secondary to the taught voice, which is listed earlier in the instructions.
    expect(developerText.indexOf("confident and playful")).toBeLessThan(developerText.indexOf("Push the community angle"));
  });

  it("always includes the anti-formula rules against repeating openings, length, signature phrases and hashtags (issue #360)", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("do not always open with the project name");
    expect(developerText).toContain("Vary post length meaningfully");
    expect(developerText).toContain("Do not reuse the same signature phrase");
    expect(developerText).toContain("Do not append hashtags to every post");
  });

  it("omits the example-post block when no voice examples are supplied, degrading cleanly to today's behaviour (issue #360)", () => {
    const withoutExamples = buildDraftRequestBody({ project: PROJECT, voiceProfile: VOICE }, "gpt-5-mini");
    const withEmptyExamples = buildDraftRequestBody({ project: PROJECT, voiceProfile: VOICE, voiceExamples: [] }, "gpt-5-mini");
    expect(withoutExamples).toEqual(withEmptyExamples);
    const developerText = withoutExamples.input[0]?.content[0]?.text ?? "";
    expect(developerText).not.toContain("real posts written by the user");
  });

  it("passes a rotating sample of real voice examples labelled as style reference only, never to be copied (issue #360 cause 1)", () => {
    const examples = Array.from({ length: 12 }, (_, index) => `Example post number ${index + 1}`);
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: VOICE, voiceExamples: examples, angleIndex: 0 }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("real posts written by the user");
    expect(developerText).toContain("style reference only");
    expect(developerText).toContain("never copy, quote or lightly reword");
    expect(developerText).toContain("Example post number 1");

    // Supplements, never replaces, the flattened profile summary.
    expect(developerText.indexOf("confident and playful")).toBeLessThan(developerText.indexOf("Example post number 1"));

    const nextBatchBody = buildDraftRequestBody(
      { project: PROJECT, voiceProfile: VOICE, voiceExamples: examples, angleIndex: 1 },
      "gpt-5-mini",
    );
    const nextDeveloperText = nextBatchBody.input[0]?.content[0]?.text ?? "";
    // A different angleIndex shifts the rotating window so a different set of examples is sampled.
    expect(nextDeveloperText).not.toMatch(/Example post number 1\b/);
    expect(nextDeveloperText).toContain("Example post number 6");
  });

  it("caps the sampled voice examples at 5 per request even when far more are supplied (issue #360 cost note)", () => {
    const examples = Array.from({ length: 20 }, (_, index) => `Example post number ${index + 1}`);
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: VOICE, voiceExamples: examples, angleIndex: 0 }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    const matches = developerText.match(/Example post number \d+/g) ?? [];
    expect(matches.length).toBe(5);
  });

  it("rotates the fallback angle deterministically across a batch when no theme is given (issue #360 cause 2)", () => {
    const seenAngles = new Set<string>();
    for (let angleIndex = 0; angleIndex < DRAFT_ANGLES.length; angleIndex += 1) {
      const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, angleIndex }, "gpt-5-mini");
      const userText = body.input[1]?.content[0]?.text ?? "";
      const matchingAngle = DRAFT_ANGLES.find((angle) => userText.includes(angle));
      expect(matchingAngle).toBeDefined();
      seenAngles.add(matchingAngle as string);
    }
    // Every angle in the set is reachable across a full rotation, not just one repeated die roll.
    expect(seenAngles.size).toBe(DRAFT_ANGLES.length);

    // Rotation wraps back to the same angle after a full cycle.
    const first = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, angleIndex: 0 }, "gpt-5-mini");
    const wrapped = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, angleIndex: DRAFT_ANGLES.length }, "gpt-5-mini");
    expect(first.input[1]?.content[0]?.text).toEqual(wrapped.input[1]?.content[0]?.text);
  });

  it("an explicit theme always overrides the rotating angle", () => {
    const body = buildDraftRequestBody(
      { project: PROJECT, voiceProfile: null, theme: "community AMA recap", angleIndex: 3 },
      "gpt-5-mini",
    );
    const userText = body.input[1]?.content[0]?.text ?? "";
    expect(userText).toContain("Theme for this post: community AMA recap.");
    DRAFT_ANGLES.forEach((angle) => expect(userText).not.toContain(angle));
  });

  it("omits recent-draft avoid-context when none are supplied, degrading cleanly to today's behaviour (issue #360 cause 3)", () => {
    const withoutRecent = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    const withEmptyRecent = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, recentDrafts: [] }, "gpt-5-mini");
    expect(withoutRecent).toEqual(withEmptyRecent);
    const developerText = withoutRecent.input[0]?.content[0]?.text ?? "";
    expect(developerText).not.toContain("Ready to review");
  });

  it("passes the most recent Ready-to-review drafts as avoid-context, capped at 5 and truncated (issue #360 cause 3)", () => {
    const recentDrafts = Array.from({ length: 8 }, (_, index) => `Recent draft number ${index + 1}`);
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, recentDrafts }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("clearly different in structure, opening and phrasing");
    expect(developerText).toContain("Recent draft number 1");
    expect(developerText).toContain("Recent draft number 5");
    expect(developerText).not.toContain("Recent draft number 6");

    const longDraft = "x".repeat(500);
    const truncatedBody = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, recentDrafts: [longDraft] }, "gpt-5-mini");
    const truncatedText = truncatedBody.input[0]?.content[0]?.text ?? "";
    expect(truncatedText).not.toContain(longDraft);
    expect(truncatedText).toContain(`${"x".repeat(200)}…`);
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
