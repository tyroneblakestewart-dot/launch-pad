import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postSiteStyle } from "@/app/api/generate-site-style/route";
import { POST as postDraft } from "@/app/api/social/draft/route";
import { POST as postMascotImage } from "@/app/api/social/mascot/image/route";
import { GENERATE_SITE_STYLE_HEADER, resetSocialStudioRateLimitsForTests } from "@/lib/server/api-protection";
import {
  createMemoryAiOperationCostStore,
  resetAiOperationCostStoreForTests,
  setAiOperationCostStoreForTests,
  type RecordAiOperationCostInput,
} from "@/lib/server/ai-operation-cost-store";
import { setSocialStudioAuthoriserForTests, resetSocialStudioAuthoriserForTests } from "@/lib/server/social-studio-entitlement";
import { VALID_STYLE } from "./site-style-fixture";

const ORIGIN = "https://hoodlums.dev";
const WALLET = "0x1111111111111111111111111111111111111111";

function jsonResponse(payload: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(payload), init);
}

/** After() falls back to a fire-and-forget task outside a real request scope (see runAfterResponse) — flush it before asserting. */
async function flushBackgroundWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AI operation cost recording (issue #368)", () => {
  let sink: RecordAiOperationCostInput[];

  beforeEach(() => {
    sink = [];
    setAiOperationCostStoreForTests(createMemoryAiOperationCostStore(sink));
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.GENERATE_SITE_STYLE_SHARED_SECRET = "test-secret";
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN = ORIGIN;
    resetSocialStudioRateLimitsForTests();
    resetSocialStudioAuthoriserForTests();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
    resetSocialStudioRateLimitsForTests();
    resetSocialStudioAuthoriserForTests();
    resetAiOperationCostStoreForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records site-style generation as unattributed (no wallet) spend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(VALID_STYLE) }] }],
        usage: { input_tokens: 800, output_tokens: 300, total_tokens: 1100 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await postSiteStyle(
      new Request(`${ORIGIN}/api/generate-site-style`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          "X-Forwarded-For": "203.0.113.30",
          [GENERATE_SITE_STYLE_HEADER]: "test-secret",
        },
        body: JSON.stringify({ name: "Hoodlums", ticker: "HOOD", imageDataUrl: "data:image/png;base64,aGVsbG8=" }),
      }),
    );
    expect(response.status).toBe(200);
    await flushBackgroundWork();

    expect(sink).toHaveLength(1);
    expect(sink[0]).toMatchObject({
      featureKey: "site-style.final",
      walletAddress: null,
      accessSource: "free",
      provider: "openai",
      inputTokens: 800,
      outputTokens: 300,
    });
  });

  function draftRequest(body: Record<string, unknown>) {
    return new Request(`${ORIGIN}/api/social/draft`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        "X-Forwarded-For": "203.0.113.31",
        [GENERATE_SITE_STYLE_HEADER]: "test-secret",
      },
      body: JSON.stringify(body),
    });
  }

  function draftPayload(xText: string) {
    return jsonResponse({
      output: [{ content: [{ type: "output_text", text: JSON.stringify({ xText, telegramText: "A fine telegram post." }) }] }],
      usage: { input_tokens: 500, output_tokens: 120, total_tokens: 620 },
    });
  }

  it("records one row per attempt, including the corrective retry, attributed to the wallet", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "paid" }));
    // angleIndex 1 = culture-observation, which forbids ending in a question mark — first draft violates it.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(draftPayload("Is DOOM really building momentum?"))
      .mockResolvedValueOnce(draftPayload("DOOM is quietly building real momentum."));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postDraft(
      draftRequest({ walletAddress: WALLET, project: { name: "Test Coin", ticker: "TEST" }, angleIndex: 1 }),
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await flushBackgroundWork();

    expect(sink).toHaveLength(2);
    expect(sink[0]).toMatchObject({ featureKey: "social.draft", walletAddress: WALLET.toLowerCase(), accessSource: "paid" });
    expect(sink[1]).toMatchObject({ featureKey: "social.draft-retry", walletAddress: WALLET.toLowerCase(), accessSource: "paid" });
  });

  it("keeps the route's response contract unchanged when cost recording fails (best-effort)", async () => {
    setAiOperationCostStoreForTests({
      async record() {
        throw new Error("db exploded");
      },
    });
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "paid" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(draftPayload("What's your favorite thing about DOOM?")));

    const response = await postDraft(
      draftRequest({ walletAddress: WALLET, project: { name: "Test Coin", ticker: "TEST" }, angleIndex: 0 }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { draft?: { xText: string } };
    expect(payload.draft?.xText).toBe("What's your favorite thing about DOOM?");
    await flushBackgroundWork();
  });

  it("records a mascot image cost row after a successful generation", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: WALLET, accessSource: "paid" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: "AAAA" }] })));

    const response = await postMascotImage(
      new Request(`${ORIGIN}/api/social/mascot/image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          "X-Forwarded-For": "203.0.113.32",
          [GENERATE_SITE_STYLE_HEADER]: "test-secret",
        },
        body: JSON.stringify({
          walletAddress: WALLET,
          project: { name: "Test Coin", ticker: "TEST" },
          sceneInput: "beach",
          mascotVisualDNA: {
            characterDescription: "A cartoon doge",
            colourPalette: "orange and white",
            signatureProps: "sunglasses",
            artStyle: "flat vector",
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    await flushBackgroundWork();

    expect(sink).toHaveLength(1);
    expect(sink[0]).toMatchObject({ featureKey: "social.mascot-image", walletAddress: WALLET.toLowerCase(), imageCount: 1 });
    expect(sink[0].estimatedCostUsd).toBeGreaterThan(0);
  });
});
