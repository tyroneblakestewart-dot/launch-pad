import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postVoiceProfile } from "@/app/api/social/voice-profile/route";
import { AI_FEATURE_KEYS } from "@/lib/ai-feature-keys";
import { GENERATE_SITE_STYLE_HEADER, resetSocialStudioRateLimitsForTests } from "@/lib/server/api-protection";
import {
  createMemoryAiOperationCostStore,
  resetAiOperationCostStoreForTests,
  setAiOperationCostStoreForTests,
  type RecordAiOperationCostInput,
} from "@/lib/server/ai-operation-cost-store";
import { resetSocialProjectSlotsStoreForTests } from "@/lib/server/social-project-slots-store";
import { resetSocialStudioAuthoriserForTests, setSocialStudioAuthoriserForTests } from "@/lib/server/social-studio-entitlement";

const SECRET = "hoodlums-test-secret";
const ORIGIN = "https://hoodlums.dev";
const WALLET = "0x1111111111111111111111111111111111111111";
const PROJECT = { name: "Test Coin", ticker: "TEST" };
const EXAMPLES = ["GM to everyone still refreshing the chart.", "No roadmap slide, no VC round, no promises."];
const PROFILE = {
  tone: "bold",
  vocabulary: "slang",
  cadence: "punchy",
  emojiHabits: "some",
  sampleLines: ["Line one about Test Coin.", "Line two about Test Coin.", "Line three about Test Coin."],
};

function jsonResponse(payload: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(payload), init);
}
const USAGE = { input_tokens: 120, output_tokens: 40 };
function textPayload(value: Record<string, unknown>) {
  return { output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }], usage: USAGE };
}
const EMPTY_OUTPUT = { output: [], usage: USAGE };
function request() {
  return new Request(`${ORIGIN}/api/social/voice-profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Forwarded-For": "203.0.113.40", [GENERATE_SITE_STYLE_HEADER]: SECRET },
    body: JSON.stringify({ walletAddress: WALLET, project: PROJECT, examples: EXAMPLES }),
  });
}

let costRows: RecordAiOperationCostInput[];

beforeEach(() => {
  process.env.GENERATE_SITE_STYLE_SHARED_SECRET = SECRET;
  process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN = ORIGIN;
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.AI_GATEWAY_API_KEY;
  resetSocialStudioRateLimitsForTests();
  resetSocialStudioAuthoriserForTests();
  resetSocialProjectSlotsStoreForTests();
  setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "test-allowlist" }));
  costRows = [];
  setAiOperationCostStoreForTests(createMemoryAiOperationCostStore(costRows));
});

afterEach(() => {
  delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
  delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
  delete process.env.OPENAI_API_KEY;
  resetSocialStudioRateLimitsForTests();
  resetSocialStudioAuthoriserForTests();
  resetSocialProjectSlotsStoreForTests();
  resetAiOperationCostStoreForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("POST /api/social/voice-profile — one automatic retry on an incomplete answer", () => {
  it("retries once when the model returns a blank answer, and returns the second attempt's profile", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(EMPTY_OUTPUT))
      .mockResolvedValueOnce(jsonResponse(textPayload(PROFILE)));
    vi.stubGlobal("fetch", fetchMock);
    const response = await postVoiceProfile(request());
    expect(response.status).toBe(200);
    expect(((await response.json()) as { voiceProfile?: { tone: string } }).voiceProfile?.tone).toBe("bold");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Same request both times — a blank answer is not a correction.
    expect(fetchMock.mock.calls[0][1]?.body).toBe(fetchMock.mock.calls[1][1]?.body);
    await flush();
    expect(costRows.map((row) => row.featureKey)).toEqual([AI_FEATURE_KEYS.SOCIAL_VOICE_PROFILE, AI_FEATURE_KEYS.SOCIAL_VOICE_PROFILE_RETRY]);
  });

  it("retries on unparseable output too, and gives up honestly after the second blank", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ output: [{ content: [{ type: "output_text", text: "not json {" }] }] }))
      .mockResolvedValueOnce(jsonResponse(EMPTY_OUTPUT));
    vi.stubGlobal("fetch", fetchMock);
    const response = await postVoiceProfile(request());
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe("The AI response was incomplete. Try again.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a provider error or a malformed profile — a repeat would not fix those", async () => {
    const providerError = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", providerError);
    expect((await postVoiceProfile(request())).status).toBe(502);
    expect(providerError).toHaveBeenCalledTimes(1);

    const malformed = vi.fn().mockResolvedValue(jsonResponse(textPayload({ ...PROFILE, sampleLines: ["only one"] })));
    vi.stubGlobal("fetch", malformed);
    const response = await postVoiceProfile(request());
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain("didn't match the expected format");
    expect(malformed).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the first answer is good", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(textPayload(PROFILE)));
    vi.stubGlobal("fetch", fetchMock);
    expect((await postVoiceProfile(request())).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
