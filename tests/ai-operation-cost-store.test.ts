import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_PRICING_RATES } from "@/lib/server/ai-pricing";
import {
  createMemoryAiOperationCostStore,
  recordAiOperationCostBestEffort,
  recordImageOperationCostBestEffort,
  recordTextOperationCostBestEffort,
  resetAiOperationCostStoreForTests,
  setAiOperationCostStoreForTests,
  type RecordAiOperationCostInput,
} from "@/lib/server/ai-operation-cost-store";

afterEach(() => {
  resetAiOperationCostStoreForTests();
  vi.restoreAllMocks();
});

describe("recordAiOperationCostBestEffort", () => {
  it("records through the injected store", async () => {
    const sink: RecordAiOperationCostInput[] = [];
    setAiOperationCostStoreForTests(createMemoryAiOperationCostStore(sink));

    await recordAiOperationCostBestEffort({
      featureKey: "bespoke-site.full-page",
      walletAddress: "0xabc",
      accessSource: "paid",
      provider: "openai",
      model: "gpt-5-mini",
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 50,
      imageCount: 0,
      webSearchCallCount: 0,
      estimatedCostUsd: 0.001,
      rates: DEFAULT_AI_PRICING_RATES,
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(sink).toHaveLength(1);
    expect(sink[0]).toMatchObject({ featureKey: "bespoke-site.full-page", walletAddress: "0xabc" });
  });

  it("never throws when the store rejects — a failed insert must not change the caller's contract", async () => {
    setAiOperationCostStoreForTests({
      async record() {
        throw new Error("db exploded");
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordAiOperationCostBestEffort({
        featureKey: "bespoke-site.full-page",
        walletAddress: null,
        accessSource: "unknown",
        provider: "openai",
        model: "gpt-5-mini",
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        imageCount: 0,
        webSearchCallCount: 0,
        estimatedCostUsd: 0,
        rates: DEFAULT_AI_PRICING_RATES,
        occurredAt: new Date(),
      }),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("recordTextOperationCostBestEffort", () => {
  it("computes and records cost from returned usage, using the response's own model", async () => {
    const sink: RecordAiOperationCostInput[] = [];
    setAiOperationCostStoreForTests(createMemoryAiOperationCostStore(sink));

    await recordTextOperationCostBestEffort({
      featureKey: "social.voice-profile",
      walletAddress: "0xABC",
      accessSource: "paid",
      provider: "openai",
      response: { model: "gpt-5-mini-2026", usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 } },
      fallbackModel: "gpt-5-mini",
    });

    expect(sink).toHaveLength(1);
    expect(sink[0]).toMatchObject({
      featureKey: "social.voice-profile",
      model: "gpt-5-mini-2026",
      inputTokens: 1000,
      outputTokens: 200,
      imageCount: 0,
    });
    expect(sink[0].estimatedCostUsd).toBeGreaterThan(0);
  });

  it("never records anything when the response has no usage (network/HTTP failure)", async () => {
    const sink: RecordAiOperationCostInput[] = [];
    setAiOperationCostStoreForTests(createMemoryAiOperationCostStore(sink));

    await recordTextOperationCostBestEffort({
      featureKey: "social.draft",
      walletAddress: null,
      accessSource: "unknown",
      provider: "openai",
      response: undefined,
      fallbackModel: "gpt-5-mini",
    });

    expect(sink).toHaveLength(0);
  });

  it("counts completed web_search_call output items into the recorded row", async () => {
    const sink: RecordAiOperationCostInput[] = [];
    setAiOperationCostStoreForTests(createMemoryAiOperationCostStore(sink));

    await recordTextOperationCostBestEffort({
      featureKey: "site-style.inspiration-search",
      walletAddress: null,
      accessSource: "free",
      provider: "openai",
      response: {
        usage: { input_tokens: 500, output_tokens: 100 },
        output: [{ type: "web_search_call", status: "completed" }],
      },
      fallbackModel: "gpt-5-mini",
    });

    expect(sink[0]).toMatchObject({ webSearchCallCount: 1 });
  });
});

describe("recordImageOperationCostBestEffort", () => {
  it("records a flat per-image cost for a successful image count", async () => {
    const sink: RecordAiOperationCostInput[] = [];
    setAiOperationCostStoreForTests(createMemoryAiOperationCostStore(sink));

    await recordImageOperationCostBestEffort({
      featureKey: "social.mascot-image",
      walletAddress: "0xabc",
      accessSource: "paid",
      provider: "openai",
      model: "gpt-image-1",
      imageCount: 1,
    });

    expect(sink).toHaveLength(1);
    expect(sink[0]).toMatchObject({ imageCount: 1, inputTokens: 0, outputTokens: 0 });
    expect(sink[0].estimatedCostUsd).toBeCloseTo(DEFAULT_AI_PRICING_RATES.imageCostUsdPerImage, 10);
  });
});
