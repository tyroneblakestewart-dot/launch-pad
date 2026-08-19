import { describe, expect, it } from "vitest";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import {
  DRAFT_ANGLES,
  FACT_DEPENDENT_ANGLE_KEYS,
  WATCHED_FILLER_TERMS,
  X_DRAFT_CHARACTER_LIMIT,
  buildDraftRequestBody,
  checkDraftAngleCompliance,
  checkDraftCompliance,
  checkDraftFactualRisk,
  checkDraftIdentityOpener,
  checkDraftRepetition,
  checkDraftWatchedFillerTerms,
  extractImmediateSignaturePhrases,
  extractRepeatedPhrases,
  parseDraftResponse,
  parseDraftResponseDetailed,
  resolveChainLabel,
  type DraftProject,
} from "@/lib/server/social-draft-pipeline";
import type { SocialDraft, VoiceProfile } from "@/lib/social-studio-types";

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

  it("scopes the direction brief to subject matter only, explicitly subordinate to the required post form (issue #362 cause 1)", () => {
    const body = buildDraftRequestBody(
      { project: PROJECT, voiceProfile: null, directionBrief: "Push the community angle", angleIndex: 3 },
      "gpt-5-mini",
    );
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("this describes what to talk about, not what shape the post should take");
    expect(developerText).toContain("the required post form given separately above takes precedence over this brief");

    // The form requirement (angle 3 = one-liner) is stated ahead of the brief, not overridden by it.
    expect(developerText.indexOf("REQUIRED POST FORM")).toBeLessThan(developerText.indexOf("current focus for this week"));
    expect(developerText).toContain(DRAFT_ANGLES[3].constraint);
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

  it("rotates the fallback angle deterministically across a batch when a direction brief is supplied, reaching every angle including fact-dependent ones (issue #360 cause 2, #362 cause 2, #364)", () => {
    const brief = "Keep everyone posted on this week's progress";
    const seenAngles = new Set<string>();
    for (let angleIndex = 0; angleIndex < DRAFT_ANGLES.length; angleIndex += 1) {
      const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, angleIndex, directionBrief: brief }, "gpt-5-mini");
      const developerText = body.input[0]?.content[0]?.text ?? "";
      const matchingAngle = DRAFT_ANGLES.find((angle) => developerText.includes(angle.instruction) && developerText.includes(angle.constraint));
      expect(matchingAngle).toBeDefined();
      seenAngles.add(matchingAngle?.key as string);
      expect(developerText).toContain("REQUIRED POST FORM (non-negotiable");
    }
    // Every angle in the set is reachable across a full rotation, not just one repeated die roll.
    expect(seenAngles.size).toBe(DRAFT_ANGLES.length);

    // Rotation wraps back to the same angle after a full cycle.
    const first = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, angleIndex: 0, directionBrief: brief }, "gpt-5-mini");
    const wrapped = buildDraftRequestBody(
      { project: PROJECT, voiceProfile: null, angleIndex: DRAFT_ANGLES.length, directionBrief: brief },
      "gpt-5-mini",
    );
    expect(first.input[0]?.content[0]?.text).toEqual(wrapped.input[0]?.content[0]?.text);
  });

  it("excludes fact-dependent angles (milestone, holder-shoutout, behind-the-scenes) from the rotation entirely when no direction brief is supplied, since the model has nothing real to ground them in (issue #364)", () => {
    const seenAngles = new Set<string>();
    for (let angleIndex = 0; angleIndex < DRAFT_ANGLES.length; angleIndex += 1) {
      const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, angleIndex }, "gpt-5-mini");
      const developerText = body.input[0]?.content[0]?.text ?? "";
      const matchingAngle = DRAFT_ANGLES.find((angle) => developerText.includes(angle.instruction) && developerText.includes(angle.constraint));
      expect(matchingAngle).toBeDefined();
      expect(FACT_DEPENDENT_ANGLE_KEYS).not.toContain(matchingAngle?.key);
      seenAngles.add(matchingAngle?.key as string);
    }
    // Only the non-fact-dependent angles are ever reachable without a brief.
    expect(seenAngles.size).toBe(DRAFT_ANGLES.length - FACT_DEPENDENT_ANGLE_KEYS.length);
  });

  it("gives every non-question angle a hard constraint forbidding a question mark, and only the community-question angle allows one (issue #362 cause 2)", () => {
    DRAFT_ANGLES.forEach((angle) => {
      if (angle.allowsQuestion) {
        expect(angle.key).toBe("community-question");
        expect(angle.constraint).toContain("question mark");
      } else {
        expect(angle.constraint.toLowerCase()).toContain("question");
        expect(angle.constraint).toMatch(/not a question|do not end it with a question mark|no question mark/i);
      }
    });
  });

  it("gives the one-liner angle a hard length cap well under half the character limit (issue #362 cause 2)", () => {
    const oneLiner = DRAFT_ANGLES.find((angle) => angle.key === "one-liner");
    expect(oneLiner?.maxLength).toBeLessThan(X_DRAFT_CHARACTER_LIMIT / 2 + 1);
    expect(oneLiner?.constraint).toContain("single short statement");
  });

  it("an explicit theme always overrides the rotating angle and emits no required-post-form line", () => {
    const body = buildDraftRequestBody(
      { project: PROJECT, voiceProfile: null, theme: "community AMA recap", angleIndex: 3 },
      "gpt-5-mini",
    );
    const userText = body.input[1]?.content[0]?.text ?? "";
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(userText).toContain("Theme for this post: community AMA recap.");
    expect(developerText).not.toContain("REQUIRED POST FORM");
    DRAFT_ANGLES.forEach((angle) => {
      expect(developerText).not.toContain(angle.instruction);
      expect(userText).not.toContain(angle.instruction);
    });
  });

  it("threads corrective feedback from a failed compliance check into the developer prompt for the retry (issue #362)", () => {
    const withoutFeedback = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, angleIndex: 3 }, "gpt-5-mini");
    const withFeedback = buildDraftRequestBody(
      { project: PROJECT, voiceProfile: null, angleIndex: 3, correctiveFeedback: "it ended in a question mark" },
      "gpt-5-mini",
    );
    const withoutText = withoutFeedback.input[0]?.content[0]?.text ?? "";
    const withText = withFeedback.input[0]?.content[0]?.text ?? "";
    expect(withoutText).not.toContain("IMPORTANT CORRECTION");
    expect(withText).toContain("IMPORTANT CORRECTION");
    expect(withText).toContain("it ended in a question mark");
  });

  it("omits recent-draft avoid-context when none are supplied, degrading cleanly to today's behaviour (issue #360 cause 3)", () => {
    const withoutRecent = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    const withEmptyRecent = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, recentDrafts: [] }, "gpt-5-mini");
    expect(withoutRecent).toEqual(withEmptyRecent);
    const developerText = withoutRecent.input[0]?.content[0]?.text ?? "";
    expect(developerText).not.toContain("Ready to review");
  });

  it("passes avoid-context as a structural form summary plus opening words only, capped at 5, never the full draft body (issue #362 cause 3)", () => {
    const recentDrafts = [
      "Doom crew, biggest test of the week: what's your real moment with DOOM so far and why does it matter to you?",
      "Doom fans, quick poll: what moment made you believe DOOM could actually stick around for good?",
      "Milestone reached: liquidity locked.",
      "Doom is a vibe, not a hype cycle.",
      "Doom fam, we're chewing through the noise and asking you straight: what's kept you here?",
      "An eighth draft that should be dropped by the cap.",
    ];
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, recentDrafts }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";

    // Structural summary: forms, not full bodies.
    expect(developerText).toContain("Recent posts already sitting in Ready to review used these forms, oldest first: question, question, statement, statement, question.");
    expect(developerText).toContain("Avoid repeating those forms");

    // Only opening words, never the full text of any recent draft.
    expect(developerText).toContain("Doom crew, biggest test of the");
    expect(developerText).not.toContain(recentDrafts[0]);
    expect(developerText).not.toContain("why does it matter to you");

    // Still capped at 5.
    expect(developerText).not.toContain("eighth draft");
  });

  it("omits recent-draft avoid-context entirely when none are supplied", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).not.toContain("Ready to review");
    expect(developerText).not.toContain("Recent post openings");
  });

  it("explicitly bans opening with the project name/ticker once the rolling context shows a recent identity opener (issue #366)", () => {
    const doomProject: DraftProject = { name: "Doom", ticker: "DOOM", description: "A meme token.", chain: "solana", contractAddress: "" };
    const withIdentityOpener = buildDraftRequestBody(
      { project: doomProject, voiceProfile: null, recentDrafts: ["$DOOM is picking up serious steam this week."] },
      "gpt-5-mini",
    );
    const developerText = withIdentityOpener.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("must NOT begin with the project name or ticker");
    expect(developerText).toContain("Doom");
  });

  it("omits the identity-opener ban when no recent draft opened with the project name/ticker (issue #366)", () => {
    const doomProject: DraftProject = { name: "Doom", ticker: "DOOM", description: "A meme token.", chain: "solana", contractAddress: "" };
    const body = buildDraftRequestBody(
      { project: doomProject, voiceProfile: null, recentDrafts: ["Community energy has been building fast."] },
      "gpt-5-mini",
    );
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).not.toContain("must NOT begin with the project name or ticker");
  });

  it("includes an immediate short-signature-phrase exclusion in the developer prompt (issue #366 follow-up)", () => {
    const body = buildDraftRequestBody(
      { project: PROJECT, voiceProfile: null, recentDrafts: ["The crew brings bold humor to everything we build."] },
      "gpt-5-mini",
    );
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("short signature phrases already appeared");
    expect(developerText.toLowerCase()).toContain("bold humor");
  });

  it("includes a watched-filler-term exclusion in the developer prompt once a recent draft used one (issue #366 follow-up)", () => {
    const body = buildDraftRequestBody(
      { project: PROJECT, voiceProfile: null, recentDrafts: ["Loving the vibe from this community lately."] },
      "gpt-5-mini",
    );
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain('"vibe"');
    expect(developerText).toContain("already appeared in a recent post");
  });

  it("omits both new exclusion instructions when no recent drafts are supplied", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).not.toContain("short signature phrases already appeared");
    expect(developerText).not.toContain("already appeared in a recent post in this batch");
  });

  it("always instructs the Telegram draft to follow the X draft's angle instead of falling back to a generic summary (issue #382)", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("The Telegram draft must follow the same angle, subject and moment as the X draft");
    expect(developerText).toContain("must not fall back to a generic project summary");
  });

  it("passes recent Telegram post openings as Telegram-specific avoid-context, separate from the X openings (issue #382)", () => {
    const body = buildDraftRequestBody(
      {
        project: PROJECT,
        voiceProfile: null,
        recentDrafts: ["Test Coin is picking up steam this week."],
        recentTelegramDrafts: ["Test Coin fam, huge week ahead for the whole crew."],
      },
      "gpt-5-mini",
    );
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("Recent Telegram post openings already sitting in Ready to review");
    // openingWords caps at 6 words, matching the X-side opening-context format.
    expect(developerText).toContain("Test Coin fam, huge week ahead");
  });

  it("omits the Telegram-openings avoid-context when no recent Telegram drafts are supplied", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).not.toContain("Recent Telegram post openings");
  });

  it("bans a Telegram identity opener once the rolling Telegram-only context shows a recent one, independent of the X history (issue #382)", () => {
    const doomProject: DraftProject = { name: "Doom", ticker: "DOOM", description: "A meme token.", chain: "solana", contractAddress: "" };
    const body = buildDraftRequestBody(
      {
        project: doomProject,
        voiceProfile: null,
        recentDrafts: ["Community energy has been building fast."],
        recentTelegramDrafts: ["$DOOM crew, big things are coming this week."],
      },
      "gpt-5-mini",
    );
    const developerText = body.input[0]?.content[0]?.text ?? "";
    // The X-side warning must not fire — no X draft opened with the identity.
    expect(developerText).not.toContain("This post's X draft must NOT begin with the project name or ticker");
    // The Telegram-side warning must fire — a recent Telegram draft did.
    expect(developerText).toContain("A recent Telegram post already opened with");
    expect(developerText).toContain("This post's Telegram draft must NOT begin with the project name or ticker");
  });

  it("bans a phrase that recurred only across Telegram history in both drafts, since phrase reuse is checked across channels combined (issue #382)", () => {
    const body = buildDraftRequestBody(
      {
        project: PROJECT,
        voiceProfile: null,
        recentTelegramDrafts: [
          "the crew brings bold humor to every single update",
          "nothing beats bold humor from this crew",
        ],
      },
      "gpt-5-mini",
    );
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("short signature phrases already appeared");
    expect(developerText.toLowerCase()).toContain("bold humor");
  });
});

describe("checkDraftAngleCompliance", () => {
  it("reports no violation when the theme overrides the angle (no form requirement was ever emitted)", () => {
    expect(checkDraftAngleCompliance("Does this end in a question?", { theme: "community AMA recap", angleIndex: 1 })).toEqual({
      violated: false,
    });
  });

  it("flags a non-question angle whose draft ends in a question mark, naming the violation", () => {
    // angleIndex 1 = culture-observation, allowsQuestion: false
    const result = checkDraftAngleCompliance("Is DOOM really building momentum?", { angleIndex: 1 });
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.feedback).toContain("culture-observation");
      expect(result.feedback).toContain("question mark");
    }
  });

  it("does not flag the community-question angle for ending in a question mark", () => {
    // angleIndex 0 = community-question, allowsQuestion: true
    const result = checkDraftAngleCompliance("What's your favorite thing about DOOM?", { angleIndex: 0 });
    expect(result).toEqual({ violated: false });
  });

  it("flags a one-liner draft that exceeds its length cap", () => {
    // angleIndex 3 = one-liner
    const overLong = "x".repeat(200);
    const result = checkDraftAngleCompliance(overLong, { angleIndex: 3 });
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.feedback).toContain("one-liner");
      expect(result.feedback).toContain("character");
    }
  });

  it("does not flag a compliant draft for its angle", () => {
    // angleIndex 2 = milestone, statement, no length cap
    expect(checkDraftAngleCompliance("Liquidity is now locked for 6 months.", { angleIndex: 2 })).toEqual({ violated: false });
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

describe("allowed-facts ledger (issue #364)", () => {
  it("lists exactly the facts this route receives, and never mentions token supply", () => {
    const body = buildDraftRequestBody(
      { project: PROJECT, voiceProfile: null, directionBrief: "Push the community angle" },
      "gpt-5-mini",
    );
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("ALLOWED FACTS");
    expect(developerText).toContain("Project name: Test Coin");
    expect(developerText).toContain("Ticker: TEST");
    expect(developerText).toContain("Chain: Solana");
    expect(developerText).toContain("Description: A community-driven meme token.");
    expect(developerText).toContain("Direction brief: Push the community angle");
    // Token supply is not passed to this route — listing it would itself invite invention.
    expect(developerText.toLowerCase()).not.toContain("supply");
  });

  it("states that the description and direction brief are source material, not permission to infer facts", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    expect(developerText).toContain("source material for tone and subject matter only");
    expect(developerText).toContain("not permission to infer or invent");
  });

  it("explicitly prohibits inventing holder counts, prices, milestones, listings and partnerships", () => {
    const body = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    const developerText = body.input[0]?.content[0]?.text ?? "";
    ["holder counts", "prices", "market caps", "liquidity events", "exchange listings", "partnerships", "milestones", "'first' claim"].forEach(
      (phrase) => {
        expect(developerText).toContain(phrase);
      },
    );
  });

  it("requires every factual detail to trace to the brief or an allowed fact only when a brief is supplied", () => {
    const withBrief = buildDraftRequestBody({ project: PROJECT, voiceProfile: null, directionBrief: "Big week ahead" }, "gpt-5-mini");
    const withoutBrief = buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini");
    const withBriefText = withBrief.input[0]?.content[0]?.text ?? "";
    const withoutBriefText = withoutBrief.input[0]?.content[0]?.text ?? "";
    expect(withBriefText).toContain("must be directly supported by the direction brief above or another allowed fact");
    expect(withoutBriefText).not.toContain("must be directly supported by the direction brief above or another allowed fact");
  });
});

describe("checkDraftFactualRisk (issue #364)", () => {
  it("does not flag a clean draft with no risky claims", () => {
    const draft: SocialDraft = { xText: "DOOM is picking up energy this week.", telegramText: "Come hang out with the DOOM crew." };
    expect(checkDraftFactualRisk(draft)).toEqual({ violated: false });
  });

  const cases: Array<[string, SocialDraft]> = [
    ["a holder count", { xText: "doom just hit a new milestone: 10k holders strong and counting", telegramText: "clean" }],
    ["a wallet count", { xText: "500 wallets and growing", telegramText: "clean" }],
    ["a dollar figure", { xText: "clean", telegramText: "we just crossed $2m market cap" }],
    ["a percentage move", { xText: "DOOM is up 40% today", telegramText: "clean" }],
    ["a liquidity pool live claim", { xText: "our liquidity pool is finally live", telegramText: "clean" }],
    ["an exchange listing claim", { xText: "clean", telegramText: "we just got listed on a major exchange" }],
    ["a partnership claim", { xText: "clean", telegramText: "we just partnered with a huge brand" }],
    ["a 'first' claim", { xText: "clean", telegramText: "our first liquidity pool minted and live in action" }],
  ];

  it.each(cases)("flags %s", (_label, draft) => {
    const result = checkDraftFactualRisk(draft);
    expect(result.violated).toBe(true);
  });
});

describe("extractRepeatedPhrases (issue #364)", () => {
  it("returns a distinctive phrase that recurs across at least two recent drafts", () => {
    const drafts = [
      "the doom crew is bold humor at its finest",
      "nothing beats bold humor from the doom crew",
      "a totally different post about something else entirely",
    ];
    const phrases = extractRepeatedPhrases(drafts);
    expect(phrases.some((phrase) => phrase.includes("bold humor"))).toBe(true);
  });

  it("does not flag a distinctive phrase that appears in only one draft", () => {
    const drafts = ["a wildly unique phrase appears here", "a totally different sentence with nothing in common"];
    const phrases = extractRepeatedPhrases(drafts);
    expect(phrases.some((phrase) => phrase.includes("wildly unique"))).toBe(false);
  });

  it("returns an empty list for no recent drafts", () => {
    expect(extractRepeatedPhrases([])).toEqual([]);
  });
});

describe("checkDraftRepetition (issue #364)", () => {
  it("flags the \"isn't just X, it's Y\" construction", () => {
    const draft: SocialDraft = { xText: "DOOM isn't just a token, it's a movement.", telegramText: "clean" };
    expect(checkDraftRepetition(draft, []).violated).toBe(true);
  });

  it("flags the \"not X, it's Y\" variant", () => {
    const draft: SocialDraft = { xText: "clean", telegramText: "This is not just hype, it's a real community." };
    expect(checkDraftRepetition(draft, []).violated).toBe(true);
  });

  it("flags reuse of a phrase already on the banned list", () => {
    const draft: SocialDraft = { xText: "the doom crew brings bold humor every time", telegramText: "clean" };
    expect(checkDraftRepetition(draft, ["bold humor"]).violated).toBe(true);
  });

  it("does not flag a clean draft with no banned phrases", () => {
    const draft: SocialDraft = { xText: "DOOM keeps building steadily.", telegramText: "Come hang with the crew." };
    expect(checkDraftRepetition(draft, [])).toEqual({ violated: false });
  });
});

describe("checkDraftCompliance (issue #364)", () => {
  it("runs the angle check first and reports its violation", () => {
    // angleIndex 1 = culture-observation, which forbids a question mark.
    const draft: SocialDraft = { xText: "Is DOOM really building momentum?", telegramText: "clean" };
    const result = checkDraftCompliance(draft, { angleIndex: 1 });
    expect(result.violated).toBe(true);
    if (result.violated) expect(result.feedback).toContain("culture-observation");
  });

  it("runs the factual-risk check when the angle passes", () => {
    const draft: SocialDraft = { xText: "500 wallets and growing.", telegramText: "clean" };
    const result = checkDraftCompliance(draft, { angleIndex: 1 });
    expect(result.violated).toBe(true);
    if (result.violated) expect(result.feedback).toContain("holder/wallet/user count");
  });

  it("runs the repetition check when angle and factual risk both pass", () => {
    const draft: SocialDraft = { xText: "DOOM keeps building steadily, no gimmicks.", telegramText: "clean" };
    const result = checkDraftCompliance(draft, { angleIndex: 1, bannedPhrases: ["keeps building"] });
    expect(result.violated).toBe(true);
    if (result.violated) expect(result.feedback).toContain("keeps building");
  });

  it("reports no violation when every check passes", () => {
    const draft: SocialDraft = { xText: "DOOM keeps building steadily.", telegramText: "Come hang with the crew." };
    expect(checkDraftCompliance(draft, { angleIndex: 1 })).toEqual({ violated: false });
  });

  it("runs the project-identity-opener check ahead of repetition when a project is supplied (issue #366)", () => {
    const draft: SocialDraft = { xText: "DOOM crew, big week ahead.", telegramText: "clean" };
    const result = checkDraftCompliance(draft, {
      angleIndex: 1,
      project: { name: "Doom", ticker: "DOOM" },
      recentDrafts: ["$DOOM is picking up steam this week."],
    });
    expect(result.violated).toBe(true);
    if (result.violated) expect(result.feedback).toContain("already opened with");
  });

  it("does not run the identity-opener check when no project is supplied, staying backward compatible", () => {
    const draft: SocialDraft = { xText: "DOOM crew, big week ahead.", telegramText: "clean" };
    expect(checkDraftCompliance(draft, { angleIndex: 1, recentDrafts: ["DOOM is picking up steam."] })).toEqual({
      violated: false,
    });
  });
});

const DOOM_PROJECT = { name: "Doom", ticker: "DOOM" };

describe("checkDraftIdentityOpener (issue #366)", () => {
  it("rejects a DOOM-opening draft when a recent draft opened with $DOOM (case-insensitive, cross-form)", () => {
    const result = checkDraftIdentityOpener("Doom is picking up serious momentum today.", DOOM_PROJECT, [
      "$DOOM just keeps building, no signs of slowing down.",
    ]);
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.feedback).toContain("Doom");
      expect(result.feedback.toLowerCase()).toContain("different human perspective");
    }
  });

  it("rejects the reverse direction: a $DOOM opener when a recent draft opened with plain DOOM", () => {
    const result = checkDraftIdentityOpener("$DOOM is having a great week.", DOOM_PROJECT, [
      "doom keeps shipping, week after week.",
    ]);
    expect(result.violated).toBe(true);
  });

  it("ignores leading punctuation/emoji before the identity opener on either side", () => {
    const result = checkDraftIdentityOpener("🔥 DOOM is on fire today.", DOOM_PROJECT, [
      "\"Doom\" fans are showing up in force.",
    ]);
    expect(result.violated).toBe(true);
  });

  it("allows a project-identity opener when no recent draft used one (rolling-window rule, not a permanent ban)", () => {
    const result = checkDraftIdentityOpener("DOOM is picking up serious momentum today.", DOOM_PROJECT, [
      "Community energy is building fast this week.",
      "Feels like the right moment to double down.",
    ]);
    expect(result).toEqual({ violated: false });
  });

  it("allows a draft that doesn't open with the identity even when a recent draft did", () => {
    const result = checkDraftIdentityOpener("Community energy has been unreal lately.", DOOM_PROJECT, ["DOOM keeps shipping."]);
    expect(result).toEqual({ violated: false });
  });

  it("is token-aware: a short ticker must not falsely match the start of an unrelated longer word", () => {
    // Ticker "DOOM" must not match "Doomsday" — a different word that merely starts with the same letters.
    const result = checkDraftIdentityOpener("Doomsday predictions aside, the crew is thriving.", DOOM_PROJECT, [
      "DOOM is picking up steam.",
    ]);
    expect(result).toEqual({ violated: false });
  });

  it("returns no violation for empty recent drafts", () => {
    expect(checkDraftIdentityOpener("DOOM is picking up steam.", DOOM_PROJECT, [])).toEqual({ violated: false });
  });

  it("defaults to the X field label in feedback when no field is supplied (backward compatible)", () => {
    const result = checkDraftIdentityOpener("Doom is picking up serious momentum today.", DOOM_PROJECT, [
      "$DOOM just keeps building, no signs of slowing down.",
    ]);
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.feedback).toContain("A recent post already opened with");
      expect(result.feedback).toContain("X opening line");
    }
  });

  it("names the Telegram field in feedback when field is 'Telegram', checked against Telegram-only history (issue #382)", () => {
    const result = checkDraftIdentityOpener(
      "Doom fam, big week ahead.",
      DOOM_PROJECT,
      ["$DOOM crew, huge things coming."],
      "Telegram",
    );
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.feedback).toContain("A recent Telegram post already opened with");
      expect(result.feedback).toContain("Telegram opening line");
    }
  });

  it("checks the X and Telegram windows independently — a Telegram-history opener does not flag an X-field check and vice versa", () => {
    // Recent history only shows a Telegram opener; checking the X field against it should not violate.
    const xCheck = checkDraftIdentityOpener("Doom is picking up serious momentum today.", DOOM_PROJECT, [], "X");
    expect(xCheck).toEqual({ violated: false });

    const telegramCheck = checkDraftIdentityOpener(
      "Doom fam, big week ahead.",
      DOOM_PROJECT,
      ["$DOOM crew, huge things coming."],
      "Telegram",
    );
    expect(telegramCheck.violated).toBe(true);
  });
});

describe("checkDraftRepetition close phrase reuse against a single recent draft (issue #366)", () => {
  it("rejects a distinctive 4+ word phrase shared with just one recent X draft, naming the phrase", () => {
    const draft: SocialDraft = {
      xText: "the doom community keeps building something special together every single day",
      telegramText: "clean",
    };
    const result = checkDraftRepetition(draft, [], ["nothing stops the doom community keeps building something special today"]);
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.feedback).toContain("doom community keeps building something special");
    }
  });

  it("does not reject ordinary filler or a short allowed fact like the two-word chain name", () => {
    const draft: SocialDraft = {
      xText: "Building on Robinhood Chain has been a genuinely fun ride for the whole crew.",
      telegramText: "clean",
    };
    const result = checkDraftRepetition(draft, [], ["Robinhood Chain gives us the speed we need to move fast."]);
    expect(result).toEqual({ violated: false });
  });

  it("does not reject when the shared words are all short/generic (no distinctive word)", () => {
    const draft: SocialDraft = { xText: "this is the way we do it here and now", telegramText: "clean" };
    const result = checkDraftRepetition(draft, [], ["this is the way we always do it"]);
    expect(result).toEqual({ violated: false });
  });

  it("still rejects with only the phrase list when no recentDrafts are passed (backward compatible default)", () => {
    const draft: SocialDraft = { xText: "the doom crew brings bold humor every time", telegramText: "clean" };
    expect(checkDraftRepetition(draft, ["bold humor"]).violated).toBe(true);
  });

  it("rejects a distinctive 4+ word phrase shared with a recent Telegram draft, naming it as the Telegram post (issue #382)", () => {
    const draft: SocialDraft = {
      xText: "clean",
      telegramText: "the doom community keeps building something special together every single day",
    };
    const result = checkDraftRepetition(
      draft,
      [],
      [],
      ["nothing stops the doom community keeps building something special today"],
    );
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.feedback).toContain("Telegram post shares the phrase");
      expect(result.feedback).toContain("doom community keeps building something special");
    }
  });

  it("does not flag the Telegram overlap when the shared words are all short/generic", () => {
    const draft: SocialDraft = { xText: "clean", telegramText: "this is the way we do it here and now" };
    const result = checkDraftRepetition(draft, [], [], ["this is the way we always do it"]);
    expect(result).toEqual({ violated: false });
  });

  it("an X-only shared phrase does not trigger a false positive against unrelated Telegram history, and vice versa", () => {
    const draft: SocialDraft = {
      xText: "the doom community keeps building something special together every single day",
      telegramText: "A completely unrelated telegram sentence about something else.",
    };
    // recentTelegramDrafts has nothing in common with the Telegram body, so only the X-history match should fire.
    const result = checkDraftRepetition(
      draft,
      [],
      ["nothing stops the doom community keeps building something special today"],
      ["A totally different unrelated recent telegram post about nothing in particular."],
    );
    expect(result.violated).toBe(true);
    if (result.violated) expect(result.feedback).toContain("X post shares the phrase");
  });

  it("stays backward compatible when recentTelegramDrafts is omitted entirely", () => {
    const draft: SocialDraft = { xText: "clean", telegramText: "the doom crew brings bold humor every time" };
    expect(checkDraftRepetition(draft, [], []).violated).toBe(false);
  });
});

describe("resolveChainLabel", () => {
  it("maps robinhood to the Robinhood Chain label and everything else to Solana", () => {
    expect(resolveChainLabel("robinhood")).toBe("Robinhood Chain");
    expect(resolveChainLabel("solana")).toBe("Solana");
  });
});

describe("extractImmediateSignaturePhrases (issue #366 follow-up)", () => {
  it("flags a distinctive 2-3 word phrase after a single occurrence, not just 2+ recurrences", () => {
    const phrases = extractImmediateSignaturePhrases(
      ["The crew brings bold humor to everything we build."],
      DOOM_PROJECT,
      "Robinhood Chain",
    );
    expect(phrases).toContain("bold humor");
  });

  it("never flags the project's own name, ticker, or chain label", () => {
    const phrases = extractImmediateSignaturePhrases(
      ["$DOOM keeps shipping on Robinhood Chain, and Doom holders love it."],
      DOOM_PROJECT,
      "Robinhood Chain",
    );
    expect(phrases.some((phrase) => phrase.includes("doom"))).toBe(false);
    expect(phrases.some((phrase) => phrase.includes("robinhood chain"))).toBe(false);
  });

  it("ignores ordinary stopword-heavy filler and single generic words like 'community'", () => {
    const phrases = extractImmediateSignaturePhrases(
      ["We love our community and the energy it brings to us every day."],
      DOOM_PROJECT,
      "Robinhood Chain",
    );
    expect(phrases).toEqual([]);
  });

  it("returns an empty list for no recent drafts", () => {
    expect(extractImmediateSignaturePhrases([], DOOM_PROJECT, "Robinhood Chain")).toEqual([]);
  });
});

describe("checkDraftWatchedFillerTerms (issue #366 follow-up)", () => {
  it("allows a watched term's first use when no recent draft used it", () => {
    const result = checkDraftWatchedFillerTerms("Loving the vibe from this drop.", []);
    expect(result).toEqual({ violated: false });
  });

  it("rejects a second use of a watched term within the rolling window, naming it in feedback", () => {
    const result = checkDraftWatchedFillerTerms("Still riding that vibe today.", ["Loving the vibe from this drop."]);
    expect(result.violated).toBe(true);
    if (result.violated) expect(result.feedback).toContain('"vibe"');
  });

  it("is case-insensitive and matches the plural form too", () => {
    const result = checkDraftWatchedFillerTerms("The Vibes are unreal right now.", ["good vibes only around here."]);
    expect(result.violated).toBe(true);
  });

  it("does not reject ordinary vocabulary that isn't on the watched list", () => {
    const result = checkDraftWatchedFillerTerms("The community energy is unreal today.", ["The community energy was great yesterday."]);
    expect(result).toEqual({ violated: false });
  });

  it("exposes the watched term list as containing 'vibe'", () => {
    expect(WATCHED_FILLER_TERMS).toContain("vibe");
  });
});

describe("checkDraftCompliance immediate signature phrases and watched filler terms (issue #366 follow-up)", () => {
  it("rejects a second 'bold humor' after a single recent occurrence, naming the phrase in feedback", () => {
    const draft: SocialDraft = { xText: "This crew never runs out of bold humor.", telegramText: "clean" };
    const result = checkDraftCompliance(draft, {
      angleIndex: 1,
      project: DOOM_PROJECT,
      chainLabel: "Robinhood Chain",
      recentDrafts: ["The doom crew brings bold humor to everything we build."],
    });
    expect(result.violated).toBe(true);
    if (result.violated) expect(result.feedback).toContain("bold humor");
  });

  it("rejects a second 'vibe' within the rolling window", () => {
    const draft: SocialDraft = { xText: "Still riding that same vibe today.", telegramText: "clean" };
    const result = checkDraftCompliance(draft, {
      angleIndex: 1,
      project: DOOM_PROJECT,
      chainLabel: "Robinhood Chain",
      recentDrafts: ["Loving the vibe from this drop."],
    });
    expect(result.violated).toBe(true);
    if (result.violated) expect(result.feedback).toContain("vibe");
  });

  it("does not reject the project name, ticker, or the Robinhood Chain label", () => {
    const draft: SocialDraft = { xText: "Doom keeps building on Robinhood Chain, one day at a time.", telegramText: "clean" };
    const result = checkDraftCompliance(draft, {
      angleIndex: 1,
      project: DOOM_PROJECT,
      chainLabel: "Robinhood Chain",
      recentDrafts: ["Robinhood Chain gives DOOM the speed we need to move fast."],
    });
    expect(result).toEqual({ violated: false });
  });

  it("does not reject normal filler or a draft that merely matches recent voice cadence with different wording", () => {
    const draft: SocialDraft = {
      xText: "Another quiet day of steady progress for the whole crew.",
      telegramText: "clean",
    };
    const result = checkDraftCompliance(draft, {
      angleIndex: 1,
      project: DOOM_PROJECT,
      chainLabel: "Robinhood Chain",
      recentDrafts: ["Another calm day of steady work from the whole team."],
    });
    expect(result).toEqual({ violated: false });
  });

  it("allows a single use of 'vibe' with no recent occurrence", () => {
    const draft: SocialDraft = { xText: "Loving the vibe from this drop.", telegramText: "clean" };
    const result = checkDraftCompliance(draft, {
      angleIndex: 1,
      project: DOOM_PROJECT,
      chainLabel: "Robinhood Chain",
      recentDrafts: [],
    });
    expect(result).toEqual({ violated: false });
  });
});

describe("checkDraftCompliance Telegram variety enforcement (issue #382)", () => {
  it("rejects a Telegram draft that opens with the project identity when recent Telegram history already did, naming the Telegram text", () => {
    const draft: SocialDraft = { xText: "The crew is heads down building this week.", telegramText: "Doom fam, big week ahead for all of us." };
    const result = checkDraftCompliance(draft, {
      angleIndex: 1,
      project: DOOM_PROJECT,
      chainLabel: "Robinhood Chain",
      recentDrafts: [],
      recentTelegramDrafts: ["$DOOM crew, huge things coming this week."],
    });
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.feedback).toContain("A recent Telegram post already opened with");
      expect(result.feedback).toContain("Telegram opening line");
    }
  });

  it("does not reject an X draft opening with the identity purely because Telegram history opened with it (the two windows are independent)", () => {
    const draft: SocialDraft = { xText: "Doom keeps building steadily, no gimmicks.", telegramText: "A completely different Telegram post." };
    const result = checkDraftCompliance(draft, {
      angleIndex: 1,
      project: DOOM_PROJECT,
      chainLabel: "Robinhood Chain",
      recentDrafts: [],
      recentTelegramDrafts: ["$DOOM crew, huge things coming this week."],
    });
    expect(result).toEqual({ violated: false });
  });

  it("rejects a Telegram draft that closely echoes a recent Telegram draft's phrasing, naming it as the Telegram post", () => {
    // No project supplied here so the immediate-signature-phrase pre-check (which would otherwise
    // catch "keeps building" first and report the more generic reused-phrase message) is skipped,
    // isolating the close-phrase-overlap check this test targets.
    const draft: SocialDraft = {
      xText: "clean",
      telegramText: "the doom community keeps building something special together every single day",
    };
    const result = checkDraftCompliance(draft, {
      angleIndex: 1,
      recentDrafts: [],
      recentTelegramDrafts: ["nothing stops the doom community keeps building something special today"],
    });
    expect(result.violated).toBe(true);
    if (result.violated) expect(result.feedback).toContain("Telegram post shares the phrase");
  });

  it("bans a signature phrase in the X draft that only recently appeared in Telegram history, since phrase reuse is checked across both channels", () => {
    const draft: SocialDraft = { xText: "This crew never runs out of bold humor.", telegramText: "clean" };
    const result = checkDraftCompliance(draft, {
      angleIndex: 1,
      project: DOOM_PROJECT,
      chainLabel: "Robinhood Chain",
      recentDrafts: [],
      recentTelegramDrafts: ["The doom crew brings bold humor to everything we build."],
    });
    expect(result.violated).toBe(true);
    if (result.violated) expect(result.feedback).toContain("bold humor");
  });

  it("stays backward compatible when recentTelegramDrafts is omitted (no Telegram checks run, X-only behaviour unchanged)", () => {
    const draft: SocialDraft = { xText: "DOOM keeps building steadily.", telegramText: "Doom fam, checking in with the crew today." };
    const result = checkDraftCompliance(draft, { angleIndex: 1, project: DOOM_PROJECT, chainLabel: "Robinhood Chain", recentDrafts: [] });
    expect(result).toEqual({ violated: false });
  });
});
