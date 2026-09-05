import { describe, expect, it } from "vitest";
import { MAX_REINFORCEMENT_SAMPLE_LINES } from "@/lib/social-voice-feedback";
import {
  MAX_VOICE_SAMPLE_SOURCE_LENGTH,
  buildVoiceSampleRequestBody,
  normalisePersonaLines,
  normaliseSourcePost,
  parseVoiceSampleResponse,
} from "@/lib/server/social-voice-sample-pipeline";

function textResponse(value: unknown) {
  return { output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] } as never;
}

describe("normaliseSourcePost", () => {
  it("accepts a real post, collapsing whitespace", () => {
    expect(normaliseSourcePost("  GM to everyone   still refreshing\nthe chart.  ")).toEqual({
      ok: true,
      sourcePost: "GM to everyone still refreshing the chart.",
    });
  });

  it("rejects non-strings, short and oversized posts", () => {
    expect(normaliseSourcePost(42).ok).toBe(false);
    expect(normaliseSourcePost("too short").ok).toBe(false);
    expect(normaliseSourcePost("x".repeat(MAX_VOICE_SAMPLE_SOURCE_LENGTH + 1)).ok).toBe(false);
  });
});

describe("normalisePersonaLines", () => {
  it("keeps strings only, trimmed, and caps at the whole bank", () => {
    const raw = [" one ", 2, "", "two", ...Array.from({ length: 40 }, (_, index) => `line ${index}`)];
    const lines = normalisePersonaLines(raw);
    expect(lines[0]).toBe("one");
    expect(lines[1]).toBe("two");
    expect(lines).toHaveLength(MAX_REINFORCEMENT_SAMPLE_LINES);
  });
});

describe("buildVoiceSampleRequestBody", () => {
  const body = buildVoiceSampleRequestBody(
    { project: { name: "Hoodlums Test", ticker: "HOODT", description: "A test token." }, sourcePost: "Macron and his wife leaving Downing Street yesterday…", personaLines: ["Kept one."] },
    "gpt-test",
  );
  const developer = (body.input[0].content[0] as { text: string }).text;
  const user = (body.input[1].content[0] as { text: string }).text;

  it("is a strainer: keep the voice, throw away the identity, write about the user's project only", () => {
    expect(developer).toContain("Your job is a strainer: keep its voice and throw away everything else.");
    expect(developer).toContain("THROW AWAY: every trace of the source's identity");
    expect(developer).toContain('"Hoodlums Test" ($HOODT)');
    expect(developer).toContain("MUST be 280 characters or fewer");
    expect(developer).toContain("Never invent holder counts, prices, market caps, listings, partnerships");
    expect(developer).toContain("Never include a link, URL or hashtag.");
  });

  it("ranks the source post as the primary voice reference and the persona as secondary", () => {
    expect(developer).toContain("the source post is the primary voice reference for this sample");
    expect(user).toContain("Source post (voice reference only — strip its identity and subject entirely):");
    expect(user).toContain("Macron and his wife leaving Downing Street yesterday…");
    expect(user).toContain("1. Kept one.");
    expect(body.text.format.name).toBe("voice_sample");
    expect(body.text.format.strict).toBe(true);
    expect(body.store).toBe(false);
  });

  it("omits the persona block entirely when the bank is empty", () => {
    const empty = buildVoiceSampleRequestBody({ project: { name: "A", ticker: "B" }, sourcePost: "Long enough source post here." }, "m");
    expect((empty.input[0].content[0] as { text: string }).text).not.toContain("as their persona");
    expect((empty.input[1].content[0] as { text: string }).text).not.toContain("Persona lines");
  });
});

describe("parseVoiceSampleResponse", () => {
  it("returns the sample, collapsed and trimmed", () => {
    expect(parseVoiceSampleResponse(textResponse({ sample: "  Chart looks like a   heart monitor. $HOODT " }))).toEqual({
      ok: true,
      sample: "Chart looks like a heart monitor. $HOODT",
    });
  });

  it("truncates an overlong sample at a word boundary to 280 characters", () => {
    const long = Array.from({ length: 60 }, () => "word").join(" ");
    const parsed = parseVoiceSampleResponse(textResponse({ sample: long }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.sample.length).toBeLessThanOrEqual(280);
      expect(parsed.sample.endsWith("word")).toBe(true);
    }
  });

  it("names the failure reason for empty, unparseable and malformed responses", () => {
    expect(parseVoiceSampleResponse({ output: [] } as never)).toEqual({ ok: false, reason: "empty_output" });
    expect(parseVoiceSampleResponse({ output: [{ content: [{ type: "output_text", text: "not json" }] }] } as never)).toEqual({ ok: false, reason: "json_parse_error" });
    expect(parseVoiceSampleResponse(textResponse({ sample: 7 }))).toEqual({ ok: false, reason: "invalid_sample" });
    expect(parseVoiceSampleResponse(textResponse({ sample: "tiny" }))).toEqual({ ok: false, reason: "invalid_sample" });
  });
});
