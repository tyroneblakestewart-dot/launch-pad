import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestArtworkIdentity,
  type ArtworkIdentityProviderResult,
} from "@/lib/server/artwork-identity-request";
import type { ArtworkIdentity } from "@/lib/site-style-openai-pipeline";

const ARTWORK: ArtworkIdentity = {
  dominantColours: "Powder blue, charcoal black, steel grey, white and restrained transit red accents.",
  memeEnergy: "Curious London journey energy with a playful child-led sense of movement and discovery.",
  subjectAndIcons: "A child studying a Tube map while standing on a scooter, with route lines, station glass and transport details.",
  visibleText: "Tube map and small London transport labels are visible but should not become the project name.",
  typographyPersonality: "Friendly rounded transport signage with clear bold headings rather than cyber or military display type.",
  copyVoice: "Warm, adventurous, direct and optimistic, written like a city journey shared with a community.",
  nonNegotiables: "Keep the child, scooter and route-map story central; do not convert the image into hacker, heist or terminal imagery.",
};

const STAGES = {
  first: "test-first",
  retry: "test-retry",
  parseFailure: "test-parse-failure",
};

function identityPayload(value: unknown) {
  return {
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  };
}

function incompletePayload(reason = "max_output_tokens") {
  return { status: "incomplete", incomplete_details: { reason }, output: [] };
}

describe("requestArtworkIdentity", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries once when the first response fails to parse, and succeeds if the second parses", async () => {
    const requestAttempt = vi
      .fn<(stage: string) => Promise<ArtworkIdentityProviderResult>>()
      .mockResolvedValueOnce({ ok: true, payload: incompletePayload() })
      .mockResolvedValueOnce({ ok: true, payload: identityPayload(ARTWORK) });

    const result = await requestArtworkIdentity(requestAttempt, STAGES);

    expect(result).toEqual({ ok: true, identity: ARTWORK });
    expect(requestAttempt).toHaveBeenCalledTimes(2);
    expect(requestAttempt).toHaveBeenNthCalledWith(1, STAGES.first);
    expect(requestAttempt).toHaveBeenNthCalledWith(2, STAGES.retry);
    expect(console.warn).toHaveBeenCalledWith(
      "AI artwork identity response was incomplete; retrying once",
      expect.stringContaining("max_output_tokens"),
    );
  });

  it("returns a failure after two failed parses", async () => {
    const requestAttempt = vi
      .fn<(stage: string) => Promise<ArtworkIdentityProviderResult>>()
      .mockResolvedValueOnce({ ok: true, payload: incompletePayload("max_output_tokens") })
      .mockResolvedValueOnce({ ok: true, payload: identityPayload({ dominantColours: "too short" }) });

    const result = await requestArtworkIdentity(requestAttempt, STAGES);

    expect(requestAttempt).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.stage).toBe(STAGES.parseFailure);
    expect(result.failure.kind).toBe("invalid");
    expect(result.failure.detail).toContain("attempt 1 returned an incomplete response");
    expect(result.failure.detail).toContain("attempt 2 completed but did not match");
  });

  it("does not retry when the provider call itself fails", async () => {
    const failure: ArtworkIdentityProviderResult = { ok: false, kind: "network", detail: "boom" };
    const requestAttempt = vi
      .fn<(stage: string) => Promise<ArtworkIdentityProviderResult>>()
      .mockResolvedValueOnce(failure);

    const result = await requestArtworkIdentity(requestAttempt, STAGES);

    expect(requestAttempt).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, stage: STAGES.first, failure });
  });
});
