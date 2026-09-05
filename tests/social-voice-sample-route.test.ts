import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postVoiceSample } from "@/app/api/social/voice-sample/route";
import {
  GENERATE_SITE_STYLE_HEADER,
  SOCIAL_VOICE_SAMPLE_LIMIT,
  resetSocialStudioRateLimitsForTests,
} from "@/lib/server/api-protection";
import { resetSocialProjectSlotsStoreForTests } from "@/lib/server/social-project-slots-store";
import { resetSocialStudioAuthoriserForTests, setSocialStudioAuthoriserForTests } from "@/lib/server/social-studio-entitlement";

const SECRET = "hoodlums-test-secret";
const ORIGIN = "https://hoodlums.dev";
const WALLET = "0x1111111111111111111111111111111111111111";
const PROJECT = { name: "Test Coin", ticker: "TEST", description: "A community token." };
const SOURCE = "Macron and his wife leaving Downing Street yesterday… Apparently she just wanted to phone home.";

function jsonResponse(payload: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(payload), init);
}
function textPayload(value: Record<string, unknown>) {
  return { output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] };
}
function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/social/voice-sample`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "X-Forwarded-For": "203.0.113.21",
      [GENERATE_SITE_STYLE_HEADER]: SECRET,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
const allowed = async () => ({ status: "allowed" as const, walletAddress: WALLET, accessSource: "test-allowlist" as const });

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

describe("POST /api/social/voice-sample", () => {
  it("rejects a request missing the shared secret before any entitlement or AI call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postVoiceSample(request({ walletAddress: WALLET, project: PROJECT, sourcePost: SOURCE }, { [GENERATE_SITE_STYLE_HEADER]: "wrong" }));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the upsell shape for an unentitled wallet, spending no AI tokens", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "upsell", message: "Upgrade to Pro." }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postVoiceSample(request({ walletAddress: WALLET, project: PROJECT, sourcePost: SOURCE }));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { upsell?: boolean }).upsell).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 without a project or a usable source post", async () => {
    setSocialStudioAuthoriserForTests(allowed);
    expect((await postVoiceSample(request({ walletAddress: WALLET, project: { name: "", ticker: "" }, sourcePost: SOURCE }))).status).toBe(400);
    expect((await postVoiceSample(request({ walletAddress: WALLET, project: PROJECT, sourcePost: "short" }))).status).toBe(400);
  });

  it("returns 503 when no AI provider is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    setSocialStudioAuthoriserForTests(allowed);
    expect((await postVoiceSample(request({ walletAddress: WALLET, project: PROJECT, sourcePost: SOURCE }))).status).toBe(503);
  });

  it("returns the reshaped sample on success, sending the source post and persona lines to the model", async () => {
    setSocialStudioAuthoriserForTests(allowed);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: Array<{ content: Array<{ text: string }> }> };
      const userText = body.input[1].content[0].text;
      expect(userText).toContain(SOURCE);
      expect(userText).toContain("1. Kept line.");
      return jsonResponse(textPayload({ sample: "Test Coin leaving the group chat yesterday… apparently it just wanted to phone home. $TEST" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await postVoiceSample(request({ walletAddress: WALLET, project: PROJECT, sourcePost: SOURCE, personaLines: ["Kept line."] }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { sample: string }).sample).toContain("$TEST");
  });

  it("fails closed when the reshaped sample invents a fact, never handing an unsafe line to the persona bank", async () => {
    setSocialStudioAuthoriserForTests(allowed);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(textPayload({ sample: "Holders just crossed 1,000 wallets and we are listed on Binance. $TEST" }))));
    const response = await postVoiceSample(request({ walletAddress: WALLET, project: PROJECT, sourcePost: SOURCE }));
    expect(response.status).toBe(502);
    const payload = (await response.json()) as { sample?: string; error?: string };
    expect(payload.sample).toBeUndefined();
    expect(payload.error).toContain("invented a fact");
  });

  it("blocks the request after the per-IP limit is exhausted", async () => {
    setSocialStudioAuthoriserForTests(allowed);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(textPayload({ sample: "A perfectly ordinary reshaped line about Test Coin. $TEST" }))));
    for (let index = 0; index < SOCIAL_VOICE_SAMPLE_LIMIT; index += 1) {
      const response = await postVoiceSample(request({ walletAddress: WALLET, project: PROJECT, sourcePost: SOURCE }));
      expect(response.status).toBe(200);
    }
    const blocked = await postVoiceSample(request({ walletAddress: WALLET, project: PROJECT, sourcePost: SOURCE }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });
});
