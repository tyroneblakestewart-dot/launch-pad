import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postVoiceProfile } from "@/app/api/social/voice-profile/route";
import { POST as postDraft } from "@/app/api/social/draft/route";
import { POST as postMascotVisualDna } from "@/app/api/social/mascot/visual-dna/route";
import { POST as postMascotImage } from "@/app/api/social/mascot/image/route";
import {
  GENERATE_SITE_STYLE_HEADER,
  SOCIAL_VOICE_PROFILE_LIMIT,
  resetSocialStudioRateLimitsForTests,
} from "@/lib/server/api-protection";
import {
  resetSocialProjectSlotsStoreForTests,
  setSocialProjectSlotsStoreForTests,
} from "@/lib/server/social-project-slots-store";
import {
  resetSocialStudioAuthoriserForTests,
  setSocialStudioAuthoriserForTests,
} from "@/lib/server/social-studio-entitlement";
import { createMemorySocialProjectSlotsStore } from "./social-project-slots-test-helpers";

const SECRET = "hoodlums-test-secret";
const ORIGIN = "https://hoodlums.dev";
const WALLET = "0x1111111111111111111111111111111111111111";
const PROJECT = { name: "Test Coin", ticker: "TEST", description: "A community token.", chain: "solana", contractAddress: "" };

function jsonResponse(payload: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(payload), init);
}

function textPayload(value: Record<string, unknown>) {
  return { output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] };
}

function request(url: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "X-Forwarded-For": "203.0.113.20",
      [GENERATE_SITE_STYLE_HEADER]: SECRET,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.GENERATE_SITE_STYLE_SHARED_SECRET = SECRET;
  process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN = ORIGIN;
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.AI_GATEWAY_API_KEY;
  resetSocialStudioRateLimitsForTests();
  resetSocialStudioAuthoriserForTests();
  resetSocialProjectSlotsStoreForTests();
});

afterEach(() => {
  delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
  delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
  delete process.env.OPENAI_API_KEY;
  resetSocialStudioRateLimitsForTests();
  resetSocialStudioAuthoriserForTests();
  resetSocialProjectSlotsStoreForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/social/voice-profile", () => {
  it("rejects a request missing the shared secret before any entitlement or AI call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postVoiceProfile(
      request("/api/social/voice-profile", { walletAddress: WALLET, project: PROJECT, examples: ["a", "b"] }, {
        [GENERATE_SITE_STYLE_HEADER]: "wrong",
      }),
    );
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the upsell shape for an unentitled wallet, spending no AI tokens", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "upsell", message: "Upgrade to Pro." }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postVoiceProfile(
      request("/api/social/voice-profile", { walletAddress: WALLET, project: PROJECT, examples: ["a", "b"] }),
    );
    expect(response.status).toBe(403);
    const payload = (await response.json()) as { upsell?: boolean; code?: string };
    expect(payload.upsell).toBe(true);
    expect(payload.code).toBe("social-studio-plan-required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for too few examples", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const response = await postVoiceProfile(
      request("/api/social/voice-profile", { walletAddress: WALLET, project: PROJECT, examples: ["only one"] }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 503 when no AI provider is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const response = await postVoiceProfile(
      request("/api/social/voice-profile", { walletAddress: WALLET, project: PROJECT, examples: ["a", "b"] }),
    );
    expect(response.status).toBe(503);
  });

  it("returns a parsed voice profile on success", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          textPayload({
            tone: "confident and playful",
            vocabulary: "crypto-native slang",
            cadence: "short punchy sentences",
            emojiHabits: "one emoji max",
            sampleLines: ["a", "b", "c"],
          }),
        ),
      ),
    );
    const response = await postVoiceProfile(
      request("/api/social/voice-profile", { walletAddress: WALLET, project: PROJECT, examples: ["a", "b"] }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { voiceProfile?: { tone?: string; exampleCount?: number } };
    expect(payload.voiceProfile?.tone).toBe("confident and playful");
    expect(payload.voiceProfile?.exampleCount).toBe(2);
  });

  it("blocks the request after the per-IP limit is exhausted", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          textPayload({
            tone: "confident and playful",
            vocabulary: "crypto-native slang",
            cadence: "short punchy sentences",
            emojiHabits: "one emoji max",
            sampleLines: ["a", "b", "c"],
          }),
        ),
      ),
    );
    for (let index = 0; index < SOCIAL_VOICE_PROFILE_LIMIT; index += 1) {
      const response = await postVoiceProfile(
        request("/api/social/voice-profile", { walletAddress: WALLET, project: PROJECT, examples: ["a", "b"] }),
      );
      expect(response.status).toBe(200);
    }
    const blocked = await postVoiceProfile(
      request("/api/social/voice-profile", { walletAddress: WALLET, project: PROJECT, examples: ["a", "b"] }),
    );
    expect(blocked.status).toBe(429);
  });
});

describe("POST /api/social/draft", () => {
  it("returns the upsell shape for an unentitled wallet, spending no AI tokens", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "upsell", message: "Upgrade to Pro." }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(request("/api/social/draft", { walletAddress: WALLET, project: PROJECT }));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a draft with an X variant that never exceeds 280 characters, even if the model overshoots", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          textPayload({ xText: `${"word ".repeat(60)}tail`, telegramText: "A fine telegram post about Test Coin." }),
        ),
      ),
    );
    const response = await postDraft(request("/api/social/draft", { walletAddress: WALLET, project: PROJECT }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { draft?: { xText: string; telegramText: string } };
    expect(payload.draft?.xText.length).toBeLessThanOrEqual(280);
    expect(payload.draft?.telegramText).toBe("A fine telegram post about Test Coin.");
  });

  it("returns 400 without a project name/ticker", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const response = await postDraft(request("/api/social/draft", { walletAddress: WALLET, project: { name: "", ticker: "" } }));
    expect(response.status).toBe(400);
  });

  it("forwards a supplied directionBrief into the AI request body (issue #358)", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const fetchMock = vi.fn(async () =>
      jsonResponse(textPayload({ xText: "A fine X post.", telegramText: "A fine telegram post about Test Coin." })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(
      request("/api/social/draft", {
        walletAddress: WALLET,
        project: PROJECT,
        directionBrief: "Push the community angle, big announcement coming Friday",
      }),
    );
    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, { body?: string }];
    const sentBody = JSON.parse(init.body ?? "{}") as { input?: Array<{ content?: Array<{ text?: string }> }> };
    const developerText = sentBody.input?.[0]?.content?.[0]?.text ?? "";
    expect(developerText).toContain("Push the community angle, big announcement coming Friday");
  });

  it("regenerates exactly once with corrective feedback when the draft violates its angle, and returns the corrected draft (issue #362)", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    // angleIndex 1 = culture-observation, which forbids ending in a question mark.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(textPayload({ xText: "Is DOOM really building momentum?", telegramText: "A fine telegram post." })),
      )
      .mockResolvedValueOnce(
        jsonResponse(textPayload({ xText: "DOOM is quietly building real momentum.", telegramText: "A fine telegram post." })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(
      request("/api/social/draft", { walletAddress: WALLET, project: PROJECT, angleIndex: 1 }),
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const payload = (await response.json()) as { draft?: { xText: string } };
    expect(payload.draft?.xText).toBe("DOOM is quietly building real momentum.");

    const [, retryInit] = fetchMock.mock.calls[1] as [string, { body?: string }];
    const retryBody = JSON.parse(retryInit.body ?? "{}") as { input?: Array<{ content?: Array<{ text?: string }> }> };
    const retryDeveloperText = retryBody.input?.[0]?.content?.[0]?.text ?? "";
    expect(retryDeveloperText).toContain("IMPORTANT CORRECTION");
    expect(retryDeveloperText).toContain("culture-observation");
  });

  it("does not retry when the first draft already complies with its angle", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    // angleIndex 0 = community-question, which allows a question mark.
    const fetchMock = vi.fn(async () =>
      jsonResponse(textPayload({ xText: "What's your favorite thing about DOOM?", telegramText: "A fine telegram post." })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(
      request("/api/social/draft", { walletAddress: WALLET, project: PROJECT, angleIndex: 0 }),
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a safe error rather than the unsafe original draft when the corrective retry request itself fails (issue #364 — no more failing open)", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(textPayload({ xText: "Is DOOM really building momentum?", telegramText: "A fine telegram post." })),
      )
      .mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(
      request("/api/social/draft", { walletAddress: WALLET, project: PROJECT, angleIndex: 1 }),
    );
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const payload = (await response.json()) as { draft?: unknown; error?: string };
    expect(payload.draft).toBeUndefined();
    expect(payload.error).toBeTruthy();
  });

  it("regression: never returns a retry's draft that still fails safety checks — it is re-checked, not trusted (issue #364, fail-open bug from #363)", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    // angleIndex 1 = culture-observation, which forbids ending in a question mark.
    // Both the first draft and the "corrected" retry still violate a check —
    // the first on angle form, the retry on the new factual-risk check.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(textPayload({ xText: "Is DOOM really building momentum?", telegramText: "A fine telegram post." })),
      )
      .mockResolvedValueOnce(
        jsonResponse(textPayload({ xText: "DOOM just hit 10k holders and counting.", telegramText: "A fine telegram post." })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(
      request("/api/social/draft", { walletAddress: WALLET, project: PROJECT, angleIndex: 1 }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(502);
    const payload = (await response.json()) as { draft?: unknown; error?: string };
    // The unsafe retry draft (a fabricated holder count) must never reach the caller.
    expect(payload.draft).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("10k holders");
    expect(payload.error).toBeTruthy();
  });

  it("threads project + recentDrafts into the compliance check and retries when the draft opens with the project identity again (issue #366)", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(textPayload({ xText: "Test Coin is picking up serious steam today.", telegramText: "A fine telegram post." })),
      )
      .mockResolvedValueOnce(
        jsonResponse(textPayload({ xText: "The community keeps showing up for Test Coin.", telegramText: "A fine telegram post." })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(
      request("/api/social/draft", {
        walletAddress: WALLET,
        project: PROJECT,
        angleIndex: 1,
        recentDrafts: ["$TEST just keeps building, no signs of slowing down at all."],
      }),
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const payload = (await response.json()) as { draft?: { xText: string } };
    expect(payload.draft?.xText).toBe("The community keeps showing up for Test Coin.");

    const [, retryInit] = fetchMock.mock.calls[1] as [string, { body?: string }];
    const retryBody = JSON.parse(retryInit.body ?? "{}") as { input?: Array<{ content?: Array<{ text?: string }> }> };
    const retryDeveloperText = retryBody.input?.[0]?.content?.[0]?.text ?? "";
    expect(retryDeveloperText).toContain("IMPORTANT CORRECTION");
    expect(retryDeveloperText).toContain("already opened with");
  });

  it("fails closed when the retry draft still opens with the project identity after a recent identity opener (issue #366)", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(textPayload({ xText: "Test Coin is picking up serious steam today.", telegramText: "A fine telegram post." })),
      )
      .mockResolvedValueOnce(
        jsonResponse(textPayload({ xText: "TEST is having an incredible week.", telegramText: "A fine telegram post." })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(
      request("/api/social/draft", {
        walletAddress: WALLET,
        project: PROJECT,
        angleIndex: 1,
        recentDrafts: ["$TEST just keeps building, no signs of slowing down at all."],
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(502);
    const payload = (await response.json()) as { draft?: unknown; error?: string };
    expect(payload.draft).toBeUndefined();
    expect(payload.error).toBeTruthy();
  });

  it("threads recentTelegramDrafts into the compliance check and retries with Telegram-specific corrective feedback when only the Telegram variant repeats a recent identity opener (issue #382)", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        // The X text is fine on its own — only the Telegram variant repeats the identity opener.
        jsonResponse(textPayload({ xText: "The community keeps showing up.", telegramText: "Test Coin fam, big week ahead." })),
      )
      .mockResolvedValueOnce(
        jsonResponse(textPayload({ xText: "The community keeps showing up.", telegramText: "Big week ahead for the whole crew." })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(
      request("/api/social/draft", {
        walletAddress: WALLET,
        project: PROJECT,
        angleIndex: 1,
        recentDrafts: [],
        recentTelegramDrafts: ["$TEST just keeps building, no signs of slowing down at all."],
      }),
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const payload = (await response.json()) as { draft?: { telegramText: string } };
    expect(payload.draft?.telegramText).toBe("Big week ahead for the whole crew.");

    const [, retryInit] = fetchMock.mock.calls[1] as [string, { body?: string }];
    const retryBody = JSON.parse(retryInit.body ?? "{}") as { input?: Array<{ content?: Array<{ text?: string }> }> };
    const retryDeveloperText = retryBody.input?.[0]?.content?.[0]?.text ?? "";
    expect(retryDeveloperText).toContain("IMPORTANT CORRECTION");
    expect(retryDeveloperText).toContain("Telegram opening line");
  });

  it("fails closed when the retry's Telegram variant still opens with the project identity after a recent Telegram-only identity opener (issue #382)", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(textPayload({ xText: "The community keeps showing up.", telegramText: "Test Coin fam, big week ahead." })),
      )
      .mockResolvedValueOnce(
        jsonResponse(textPayload({ xText: "The community keeps showing up.", telegramText: "$TEST is having an incredible week." })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(
      request("/api/social/draft", {
        walletAddress: WALLET,
        project: PROJECT,
        angleIndex: 1,
        recentDrafts: [],
        recentTelegramDrafts: ["$TEST just keeps building, no signs of slowing down at all."],
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(502);
    const payload = (await response.json()) as { draft?: unknown; error?: string };
    expect(payload.draft).toBeUndefined();
    expect(payload.error).toBeTruthy();
  });

  it("forwards recentTelegramDrafts into the AI request body's developer prompt (issue #382)", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const fetchMock = vi.fn(async () =>
      jsonResponse(textPayload({ xText: "A fine X post.", telegramText: "A fine telegram post about Test Coin." })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(
      request("/api/social/draft", {
        walletAddress: WALLET,
        project: PROJECT,
        recentTelegramDrafts: ["Test Coin fam, huge week ahead for the whole crew."],
      }),
    );
    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, { body?: string }];
    const sentBody = JSON.parse(init.body ?? "{}") as { input?: Array<{ content?: Array<{ text?: string }> }> };
    const developerText = sentBody.input?.[0]?.content?.[0]?.text ?? "";
    // openingWords caps at 6 words, matching the X-side opening-context format.
    expect(developerText).toContain("Test Coin fam, huge week ahead");
  });
});

describe("POST /api/social/mascot/visual-dna", () => {
  it("returns the upsell shape for an unentitled wallet, spending no AI tokens", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "upsell", message: "Upgrade to Pro." }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postMascotVisualDna(
      request("/api/social/mascot/visual-dna", { walletAddress: WALLET, project: PROJECT, imageDataUrl: "data:image/png;base64,AAAA" }),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid image data URL", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const response = await postMascotVisualDna(
      request("/api/social/mascot/visual-dna", { walletAddress: WALLET, project: PROJECT, imageDataUrl: "not a data url" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns the parsed mascot visual DNA on success", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          textPayload({
            characterDescription: "a green cartoon dog mascot",
            colourPalette: "lime, navy",
            signatureProps: "gold chain",
            artStyle: "flat vector meme illustration",
          }),
        ),
      ),
    );
    const response = await postMascotVisualDna(
      request("/api/social/mascot/visual-dna", { walletAddress: WALLET, project: PROJECT, imageDataUrl: "data:image/png;base64,AAAA" }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { mascotVisualDNA?: { characterDescription?: string } };
    expect(payload.mascotVisualDNA?.characterDescription).toBe("a green cartoon dog mascot");
  });
});

describe("POST /api/social/mascot/image", () => {
  const DNA = { characterDescription: "a green dog", colourPalette: "lime, navy", signatureProps: "chain", artStyle: "flat vector" };

  it("returns the upsell shape for an unentitled wallet, spending no AI tokens", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "upsell", message: "Upgrade to Pro." }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postMascotImage(
      request("/api/social/mascot/image", { walletAddress: WALLET, project: PROJECT, mascotVisualDNA: DNA, sceneInput: "beach" }),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 without a locked mascot visual DNA", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const response = await postMascotImage(
      request("/api/social/mascot/image", { walletAddress: WALLET, project: PROJECT, sceneInput: "beach" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 without a scene", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const response = await postMascotImage(
      request("/api/social/mascot/image", { walletAddress: WALLET, project: PROJECT, mascotVisualDNA: DNA, sceneInput: "" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns the generated image data URL on success", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [{ b64_json: "AAAA" }] })),
    );
    const response = await postMascotImage(
      request("/api/social/mascot/image", { walletAddress: WALLET, project: PROJECT, mascotVisualDNA: DNA, sceneInput: "beach" }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { imageDataUrl?: string };
    expect(payload.imageDataUrl).toBe("data:image/png;base64,AAAA");
  });

  it("returns 503 with a clear message on the Vercel AI Gateway fallback (unsupported provider)", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "gateway-key";
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postMascotImage(
      request("/api/social/mascot/image", { walletAddress: WALLET, project: PROJECT, mascotVisualDNA: DNA, sceneInput: "beach" }),
    );
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AI Social Studio project-slot enforcement (issue #407)", () => {
  const PAID_WALLET = "0x3333333333333333333333333333333333333333";
  const DNA = { characterDescription: "a green dog", colourPalette: "lime, navy", signatureProps: "chain", artStyle: "flat vector" };

  function paidAuthoriser(plan: "pro" | "pro-bundle" = "pro") {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: PAID_WALLET, accessSource: "paid", plan }));
  }

  it("returns 400 for a missing project id before any AI request — draft", async () => {
    paidAuthoriser();
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(request("/api/social/draft", { walletAddress: PAID_WALLET, project: PROJECT }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers the first project under the Pro limit and lets the draft request through", async () => {
    paidAuthoriser();
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(textPayload({ xText: "A fine X post.", telegramText: "A fine telegram post about Test Coin." }))),
    );
    const response = await postDraft(
      request("/api/social/draft", { walletAddress: PAID_WALLET, projectId: "proj-1", displayName: "Test Coin", project: PROJECT }),
    );
    expect(response.status).toBe(200);
  });

  it("returns 403 naming the plan and limit for a second project on a Pro (limit 1) wallet — draft", async () => {
    paidAuthoriser("pro");
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: PAID_WALLET, projectId: "proj-1", displayName: "Test Coin", limit: 1 });
    setSocialProjectSlotsStoreForTests(store);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(
      request("/api/social/draft", { walletAddress: PAID_WALLET, projectId: "proj-2", displayName: "Other Coin", project: PROJECT }),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    const payload = (await response.json()) as { error?: string; code?: string; limit?: number; activeCount?: number };
    expect(payload.code).toBe("social-studio-project-slot-limit");
    expect(payload.error).toContain("Pro");
    expect(payload.error).toContain("1");
    expect(payload.limit).toBe(1);
    expect(payload.activeCount).toBe(1);
  });

  it("allows a third project on a Pro Bundle (limit 3) wallet", async () => {
    paidAuthoriser("pro-bundle");
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: PAID_WALLET, projectId: "proj-1", displayName: "Coin One", limit: 3 });
    await store.ensureSlot({ walletAddress: PAID_WALLET, projectId: "proj-2", displayName: "Coin Two", limit: 3 });
    setSocialProjectSlotsStoreForTests(store);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(textPayload({ xText: "A fine X post.", telegramText: "A fine telegram post about Test Coin." }))),
    );
    const response = await postDraft(
      request("/api/social/draft", { walletAddress: PAID_WALLET, projectId: "proj-3", displayName: "Coin Three", project: PROJECT }),
    );
    expect(response.status).toBe(200);
  });

  it("returns 400 for a missing project id — voice-profile", async () => {
    paidAuthoriser();
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postVoiceProfile(
      request("/api/social/voice-profile", { walletAddress: PAID_WALLET, project: PROJECT, examples: ["a", "b"] }),
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 at the Pro limit — voice-profile", async () => {
    paidAuthoriser("pro");
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: PAID_WALLET, projectId: "proj-1", displayName: "Test Coin", limit: 1 });
    setSocialProjectSlotsStoreForTests(store);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postVoiceProfile(
      request("/api/social/voice-profile", {
        walletAddress: PAID_WALLET,
        projectId: "proj-2",
        displayName: "Other Coin",
        project: PROJECT,
        examples: ["a", "b"],
      }),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers the first project and lets the request through — voice-profile", async () => {
    paidAuthoriser();
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          textPayload({
            tone: "confident and playful",
            vocabulary: "crypto-native slang",
            cadence: "short punchy sentences",
            emojiHabits: "one emoji max",
            sampleLines: ["a", "b", "c"],
          }),
        ),
      ),
    );
    const response = await postVoiceProfile(
      request("/api/social/voice-profile", {
        walletAddress: PAID_WALLET,
        projectId: "proj-1",
        displayName: "Test Coin",
        project: PROJECT,
        examples: ["a", "b"],
      }),
    );
    expect(response.status).toBe(200);
  });

  it("returns 400 for a missing project id — mascot visual-dna", async () => {
    paidAuthoriser();
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postMascotVisualDna(
      request("/api/social/mascot/visual-dna", { walletAddress: PAID_WALLET, project: PROJECT, imageDataUrl: "data:image/png;base64,AAAA" }),
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 at the Pro limit — mascot visual-dna", async () => {
    paidAuthoriser("pro");
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: PAID_WALLET, projectId: "proj-1", displayName: "Test Coin", limit: 1 });
    setSocialProjectSlotsStoreForTests(store);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postMascotVisualDna(
      request("/api/social/mascot/visual-dna", {
        walletAddress: PAID_WALLET,
        projectId: "proj-2",
        displayName: "Other Coin",
        project: PROJECT,
        imageDataUrl: "data:image/png;base64,AAAA",
      }),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers the first project and lets the request through — mascot visual-dna", async () => {
    paidAuthoriser();
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          textPayload({
            characterDescription: "a green cartoon dog mascot",
            colourPalette: "lime, navy",
            signatureProps: "gold chain",
            artStyle: "flat vector meme illustration",
          }),
        ),
      ),
    );
    const response = await postMascotVisualDna(
      request("/api/social/mascot/visual-dna", {
        walletAddress: PAID_WALLET,
        projectId: "proj-1",
        displayName: "Test Coin",
        project: PROJECT,
        imageDataUrl: "data:image/png;base64,AAAA",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("returns 400 for a missing project id — mascot image", async () => {
    paidAuthoriser();
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postMascotImage(
      request("/api/social/mascot/image", { walletAddress: PAID_WALLET, project: PROJECT, mascotVisualDNA: DNA, sceneInput: "beach" }),
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 at the Pro limit — mascot image", async () => {
    paidAuthoriser("pro");
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: PAID_WALLET, projectId: "proj-1", displayName: "Test Coin", limit: 1 });
    setSocialProjectSlotsStoreForTests(store);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postMascotImage(
      request("/api/social/mascot/image", {
        walletAddress: PAID_WALLET,
        projectId: "proj-2",
        displayName: "Other Coin",
        project: PROJECT,
        mascotVisualDNA: DNA,
        sceneInput: "beach",
      }),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers the first project and lets the request through — mascot image", async () => {
    paidAuthoriser();
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ b64_json: "AAAA" }] })));
    const response = await postMascotImage(
      request("/api/social/mascot/image", {
        walletAddress: PAID_WALLET,
        projectId: "proj-1",
        displayName: "Test Coin",
        project: PROJECT,
        mascotVisualDNA: DNA,
        sceneInput: "beach",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("returns 503 when the project-slot registry is not configured", async () => {
    paidAuthoriser();
    // No setSocialProjectSlotsStoreForTests call — the unconfigured fallback throws.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(
      request("/api/social/draft", { walletAddress: PAID_WALLET, projectId: "proj-1", displayName: "Test Coin", project: PROJECT }),
    );
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
