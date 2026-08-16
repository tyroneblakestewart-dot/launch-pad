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
  resetSocialStudioAuthoriserForTests,
  setSocialStudioAuthoriserForTests,
} from "@/lib/server/social-studio-entitlement";

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
});

afterEach(() => {
  delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
  delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
  delete process.env.OPENAI_API_KEY;
  resetSocialStudioRateLimitsForTests();
  resetSocialStudioAuthoriserForTests();
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
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET }));
    const response = await postVoiceProfile(
      request("/api/social/voice-profile", { walletAddress: WALLET, project: PROJECT, examples: ["only one"] }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 503 when no AI provider is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET }));
    const response = await postVoiceProfile(
      request("/api/social/voice-profile", { walletAddress: WALLET, project: PROJECT, examples: ["a", "b"] }),
    );
    expect(response.status).toBe(503);
  });

  it("returns a parsed voice profile on success", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET }));
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
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET }));
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
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET }));
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
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET }));
    const response = await postDraft(request("/api/social/draft", { walletAddress: WALLET, project: { name: "", ticker: "" } }));
    expect(response.status).toBe(400);
  });

  it("forwards a supplied directionBrief into the AI request body (issue #358)", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET }));
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
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET }));
    const response = await postMascotVisualDna(
      request("/api/social/mascot/visual-dna", { walletAddress: WALLET, project: PROJECT, imageDataUrl: "not a data url" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns the parsed mascot visual DNA on success", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET }));
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
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET }));
    const response = await postMascotImage(
      request("/api/social/mascot/image", { walletAddress: WALLET, project: PROJECT, sceneInput: "beach" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 without a scene", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET }));
    const response = await postMascotImage(
      request("/api/social/mascot/image", { walletAddress: WALLET, project: PROJECT, mascotVisualDNA: DNA, sceneInput: "" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns the generated image data URL on success", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET }));
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
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postMascotImage(
      request("/api/social/mascot/image", { walletAddress: WALLET, project: PROJECT, mascotVisualDNA: DNA, sceneInput: "beach" }),
    );
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
