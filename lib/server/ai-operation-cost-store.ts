import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import {
  calculateImageCostUsd,
  calculateTextCostUsd,
  readAiPricingRates,
  type AiPricingRates,
} from "@/lib/server/ai-pricing";
import { countCompletedWebSearchCalls, extractOpenAIModel, extractOpenAIUsage } from "@/lib/server/ai-usage";
import { getPostgresPool } from "@/lib/server/postgres";

export type AiOperationAccessSource = "paid" | "test-allowlist" | "free" | "unknown";
export type AiOperationProvider = "openai" | "vercel-ai-gateway";

export type RecordAiOperationCostInput = {
  featureKey: string;
  walletAddress: string | null;
  accessSource: AiOperationAccessSource;
  provider: AiOperationProvider;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  imageCount: number;
  webSearchCallCount: number;
  estimatedCostUsd: number;
  rates: AiPricingRates;
  occurredAt: Date;
};

export interface AiOperationCostStore {
  record(input: RecordAiOperationCostInput): Promise<void>;
}

export class AiOperationCostStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is required to record AI operation costs.");
    this.name = "AiOperationCostStoreUnavailableError";
  }
}

const unconfiguredStore: AiOperationCostStore = {
  async record() {
    throw new AiOperationCostStoreUnavailableError();
  },
};

/** Test-only in-memory store; pass an array to inspect what was recorded. */
export function createMemoryAiOperationCostStore(sink: RecordAiOperationCostInput[] = []): AiOperationCostStore {
  return {
    async record(input) {
      sink.push(input);
    },
  };
}

export function createPostgresAiOperationCostStore(databaseUrl: string): AiOperationCostStore {
  const pool = getPostgresPool(databaseUrl);
  return {
    async record(input) {
      await pool.query(
        `INSERT INTO ai_operation_costs (
           id, occurred_at, feature_key, wallet_address, access_source, provider, model,
           input_tokens, cached_input_tokens, output_tokens, image_count, web_search_call_count,
           estimated_cost_usd,
           input_cost_usd_per_million, cached_input_cost_usd_per_million, output_cost_usd_per_million,
           web_search_cost_usd_per_call, image_cost_usd_per_image
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          randomUUID(),
          input.occurredAt,
          input.featureKey,
          input.walletAddress ? input.walletAddress.toLowerCase() : null,
          input.accessSource,
          input.provider,
          input.model,
          input.inputTokens,
          input.cachedInputTokens,
          input.outputTokens,
          input.imageCount,
          input.webSearchCallCount,
          input.estimatedCostUsd,
          input.rates.inputCostUsdPerMillion,
          input.rates.cachedInputCostUsdPerMillion,
          input.rates.outputCostUsdPerMillion,
          input.rates.webSearchCostUsdPerCall,
          input.rates.imageCostUsdPerImage,
        ],
      );
    },
  };
}

let testStore: AiOperationCostStore | null = null;
let productionStore: AiOperationCostStore | null = null;
let productionDatabaseUrl = "";

export function setAiOperationCostStoreForTests(store: AiOperationCostStore): void {
  testStore = store;
}

export function resetAiOperationCostStoreForTests(): void {
  testStore = null;
}

export function getAiOperationCostStore(): AiOperationCostStore {
  if (testStore) return testStore;
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresAiOperationCostStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

/**
 * Runs `task` after the response has gone out, via Next's `after()`. Outside
 * a real request scope (e.g. calling a route handler directly in a test)
 * `after()` throws synchronously rather than queuing anything, so this falls
 * back to firing the task without blocking — cost recording is always
 * best-effort and must never affect the caller either way.
 */
export function runAfterResponse(task: () => Promise<void> | void): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

/**
 * A failed cost insert must never change, delay, or replace a user's AI
 * result (issue #368) — every call site runs this via `runAfterResponse`,
 * well after the response/stream has already gone out.
 */
export async function recordAiOperationCostBestEffort(input: RecordAiOperationCostInput): Promise<void> {
  try {
    await getAiOperationCostStore().record(input);
  } catch (error) {
    console.error("AI operation cost recording failed.", error instanceof Error ? error.message : error);
  }
}

export type RecordTextOperationCostArgs = {
  featureKey: string;
  walletAddress: string | null;
  accessSource: AiOperationAccessSource;
  provider: AiOperationProvider;
  /** The raw provider response for this attempt — usage/model/web-search calls are all derived from it. Never records anything if usage is missing. */
  response: OpenAIResponse | null | undefined;
  fallbackModel: string;
  occurredAt?: Date;
  rates?: AiPricingRates;
};

/** Meters one text-generation provider attempt from its returned usage. No-ops (never fabricates a row) when usage is missing. */
export async function recordTextOperationCostBestEffort(args: RecordTextOperationCostArgs): Promise<void> {
  const usage = extractOpenAIUsage(args.response);
  if (!usage) return;

  const rates = args.rates ?? readAiPricingRates();
  const webSearchCallCount = countCompletedWebSearchCalls(args.response);
  const estimatedCostUsd = calculateTextCostUsd(
    {
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      webSearchCallCount,
    },
    rates,
  );

  await recordAiOperationCostBestEffort({
    featureKey: args.featureKey,
    walletAddress: args.walletAddress,
    accessSource: args.accessSource,
    provider: args.provider,
    model: extractOpenAIModel(args.response, args.fallbackModel),
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    imageCount: 0,
    webSearchCallCount,
    estimatedCostUsd,
    rates,
    occurredAt: args.occurredAt ?? new Date(),
  });
}

export type RecordImageOperationCostArgs = {
  featureKey: string;
  walletAddress: string | null;
  accessSource: AiOperationAccessSource;
  provider: AiOperationProvider;
  model: string;
  imageCount: number;
  occurredAt?: Date;
  rates?: AiPricingRates;
};

/** Meters a successful image count at the configured flat per-image rate — gpt-image-1 pricing is not usage-token metered here. */
export async function recordImageOperationCostBestEffort(args: RecordImageOperationCostArgs): Promise<void> {
  const rates = args.rates ?? readAiPricingRates();
  const estimatedCostUsd = calculateImageCostUsd(args.imageCount, rates);

  await recordAiOperationCostBestEffort({
    featureKey: args.featureKey,
    walletAddress: args.walletAddress,
    accessSource: args.accessSource,
    provider: args.provider,
    model: args.model,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    imageCount: args.imageCount,
    webSearchCallCount: 0,
    estimatedCostUsd,
    rates,
    occurredAt: args.occurredAt ?? new Date(),
  });
}
