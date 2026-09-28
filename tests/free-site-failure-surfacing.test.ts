// Issue #422: POST /api/generate-free-site used to reduce a non-ok provider
// response to its status code and throw the body away, so a production 400
// from the Responses API was undiagnosable, and the studio's in-preview
// status panel kept spinning forever when the bespoke wallet-auth bridge
// short-circuited a request with its synthetic AbortError. These tests pin
// the provider-body capture (sanitised, logged, recorded for /admin, returned
// as a safe summary), the plain-English message, and the client's
// stop-the-spinner + "Try again" contract.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, PROVIDER_ERROR_BODY_MAX_CHARS } from "@/app/api/generate-free-site/route";
import type { AdminActivityItem, AdminServiceControl } from "@/lib/admin-operations";
import {
  createMemoryAdminOperationsState,
  createMemoryAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
  type MemoryAdminOperationsState,
} from "@/lib/server/admin-operations-store";
import { buildWebsiteGenerationPipeline } from "@/lib/server/system-health-pipeline";

const SECRET_TOKEN = "sk-live-secret-provider-token-1234567890";

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

function request() {
  return new Request("http://localhost/api/generate-free-site", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Cloud Club",
      ticker: "CLOUD",
      description: "A gentle mascot-led community token about making the internet feel friendlier.",
      imageDataUrl: "data:image/png;base64,aGVsbG8=",
      inspirationUrl: "",
      supply: "1,000,000,000",
      decimals: 18,
    }),
  });
}

function providerError(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

function outputText(value: unknown): Response {
  return new Response(
    JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("POST /api/generate-free-site surfaces provider failures (issue #422)", () => {
  let adminState: MemoryAdminOperationsState;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    // No shared secret: in NODE_ENV=test the route skips the origin/secret
    // gate, the same shortcut tests/generate-site-page-provider-diagnostics uses.
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
    adminState = createMemoryAdminOperationsState();
    setAdminOperationsStoreForTests(createMemoryAdminOperationsStore(adminState));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    resetAdminOperationsStoreForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function flushBestEffortWrites() {
    // recordAdminActivityBestEffort is fire-and-forget (void); let it settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("reads the provider's error body, sanitises it, logs it and returns it as a safe summary with the plain message", async () => {
    const providerBody = JSON.stringify({
      error: {
        message: `Unsupported parameter: 'reasoning'. Bearer ${SECRET_TOKEN}`,
        type: "invalid_request_error",
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerError(400, providerBody)));

    const response = await POST(request());
    const body = (await response.json()) as {
      error: string;
      provider: { stage: string; status: number | null; summary: string | null };
    };

    expect(response.status).toBe(502);
    expect(body.error).toBe(
      "Site generation failed: the AI provider rejected the request. Try again shortly; if it keeps failing the team has been notified.",
    );
    expect(body.provider.stage).toBe("artwork-analysis");
    expect(body.provider.status).toBe(400);
    expect(body.provider.summary).toContain("Unsupported parameter: 'reasoning'.");
    expect(body.provider.summary).toContain("Bearer [redacted]");
    expect(body.provider.summary).not.toContain(SECRET_TOKEN);

    // The structured log line names the stage, the provider source and the status, never the token.
    const logged = errorSpy.mock.calls.find((call) => String(call[0]).includes("artwork-analysis request failed through"));
    expect(logged).toBeDefined();
    expect(logged![0]).toBe("AI artwork-analysis request failed through openai");
    expect(logged![1]).toBe(400);
    expect(String(logged![2])).toContain("Bearer [redacted]");
    expect(JSON.stringify(logged)).not.toContain(SECRET_TOKEN);
    // Our own Authorization header is never part of what is logged.
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("test-openai-key");
  });

  it("records the failure for /admin's Activity log with the sanitised detail and no secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(providerError(402, `{"error":{"message":"Insufficient credits. api_key=${SECRET_TOKEN}"}}`)),
    );

    await POST(request());
    await flushBestEffortWrites();

    const [entry] = adminState.activity;
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("free-site-provider-failed");
    expect(entry.serviceKey).toBe("website-generation");
    expect(entry.message).toContain("Free-site artwork-analysis failed (http 402):");
    expect(entry.message).toContain("Insufficient credits.");
    expect(entry.message).toContain("Provider openai, model ");
    expect(entry.message).not.toContain(SECRET_TOKEN);
  });

  it("bounds how much of a huge provider body is ever read or returned", async () => {
    const huge = "x".repeat(PROVIDER_ERROR_BODY_MAX_CHARS * 5);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerError(500, huge)));

    const response = await POST(request());
    const body = (await response.json()) as { provider: { summary: string | null } };

    expect(PROVIDER_ERROR_BODY_MAX_CHARS).toBe(2_000);
    // sanitiseProviderDetail caps at 500 after the 2,000-character read.
    expect(body.provider.summary!.length).toBeLessThanOrEqual(500);
  });

  it("reports an unreadable (non-JSON) provider answer as such, not as a rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>gateway timeout</html>", { status: 200 })),
    );

    const response = await POST(request());
    const body = (await response.json()) as { error: string; provider: { stage: string; status: number | null } };

    expect(response.status).toBe(502);
    expect(body.error).toBe(
      "Site generation failed: the AI provider returned an unreadable response. Try again shortly; if it keeps failing the team has been notified.",
    );
    expect(body.provider).toMatchObject({ stage: "artwork-analysis", status: null });
  });

  it("keeps our own parser's refusal of a valid provider answer as an identity error, and records no provider failure for it", async () => {
    // A fresh Response per call: the parser refuses both attempts, and a
    // consumed body must never be mistaken for an unreadable provider answer.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => outputText({ not: "an identity" })));

    const response = await POST(request());
    const body = (await response.json()) as { error: string; provider: { stage: string } };
    await flushBestEffortWrites();

    expect(response.status).toBe(502);
    expect(body.error).toBe("The AI returned an invalid artwork identity.");
    expect(body.provider.stage).toBe("artwork-analysis-parse");
    expect(adminState.activity).toHaveLength(0);
  });

  it("every request in this route carries a stage so the log and record name where it failed", () => {
    const route = source("app/api/generate-free-site/route.ts");
    expect(route).toContain("requestProvider(ai, artworkBody, ARTWORK_TIMEOUT_MS, stage)");
    expect(route).toContain('let designStage = "free-site-design";');
    expect(route).toContain('designStage = "free-site-design-retry";');
    expect(route).toContain("const rawBody = await response.text().catch(() => \"\");");
    expect(route).toContain("sanitiseProviderDetail(rawBody.slice(0, PROVIDER_ERROR_BODY_MAX_CHARS))");
    expect(route).not.toContain('return { ok: false, kind: "http", status: response.status };');
    // The admin kind is part of the Activity union.
    expect(source("lib/admin-operations.ts")).toContain('| "free-site-provider-failed"');
  });
});

describe("/admin website-generation pipeline shows free-site provider failures", () => {
  const now = new Date("2026-09-28T06:00:00.000Z");
  function activeControl(): AdminServiceControl {
    return { serviceKey: "website-generation", isolated: false, reason: null, updatedAt: now.toISOString(), updatedBy: null } as unknown as AdminServiceControl;
  }
  const entry = (minutesAgo: number, message: string, kind: AdminActivityItem["kind"]): AdminActivityItem => ({
    id: `a-${minutesAgo}-${kind}`,
    kind,
    serviceKey: "website-generation",
    message,
    createdAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  });

  it("names a free-site provider failure as the last outcome when it is the newest, while validation stays bespoke-only", async () => {
    const pipeline = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
      now,
      listActivity: async () => [
        entry(20, "Free-site artwork-analysis failed (http 400): Unsupported parameter. Provider openai, model gpt-5-mini.", "free-site-provider-failed"),
        entry(90, "Bespoke page rejected (layout): The page failed the responsive-layout check. Model gpt-5, wallet 0xabc.", "bespoke-page-rejected"),
      ],
    });
    const outcome = pipeline.stages.find((item) => item.id === "last-generation-outcome")!;
    expect(outcome.status).toBe("amber");
    expect(outcome.message).toBe(
      "Last free-site generation failed at the provider 20 min ago: Free-site artwork-analysis failed (http 400): Unsupported parameter. Provider openai, model gpt-5-mini.",
    );
    expect(outcome.observedAt).toBe(new Date(now.getTime() - 20 * 60_000).toISOString());
    const validation = pipeline.stages.find((item) => item.id === "response-validation")!;
    expect(validation.message).toBe("1 validation rejection in the last 7 days: layout ×1.");
  });

  it("goes green once the last free-site failure is older than a day", async () => {
    const pipeline = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
      now,
      listActivity: async () => [entry(60 * 30, "Free-site free-site-design failed (timeout): aborted. Provider openai, model gpt-5-mini.", "free-site-provider-failed")],
    });
    const outcome = pipeline.stages.find((item) => item.id === "last-generation-outcome")!;
    expect(outcome.status).toBe("green");
    expect(outcome.message).toContain("Last free-site provider failure was 30 h ago:");
  });
});

describe("studio preview stops spinning and offers Try again (issue #422 part C)", () => {
  const generator = source("components/full-website-generator.tsx");
  const gate = source("components/build-site-gate.tsx");
  const bridge = source("components/generate-site-style-auth-bridge.tsx");

  it("filters real cancellations by the run's own aborted controller, not by the error's name", () => {
    expect(generator).toContain("if (currentGeneration !== generationNumber || controller.signal.aborted) return;");
    expect(generator).not.toContain("if (currentGeneration !== generationNumber || isAbortError(error)) return;");
    // The bridge's synthetic AbortError still reaches the panel and is only used to skip the duplicate failure event.
    expect(generator).toContain("const reportedByAuthBridge = isAbortError(error);");
    expect(generator).toContain("if (!reportedByAuthBridge) {\n          window.dispatchEvent(\n            new CustomEvent(\"launchpad:site-generation-failed\"");
    // The bridge contract this relies on: it dispatches the failure itself, then throws an AbortError.
    expect(bridge).toContain('new CustomEvent("launchpad:site-generation-failed", {\n      detail: { message, previewAvailable: true },');
    expect(bridge).toContain('error.name = "AbortError";');
  });

  it("renders a Try again button on the failed panel only, and routes it through the gate", () => {
    expect(generator).toContain('retryButton.className = "full-generated-page-retry-button";');
    expect(generator).toContain('retryButton.textContent = "Try again";');
    expect(generator).toContain('if (mode === "failed" && onRetry) {');
    expect(generator).toContain("} else if (retryButton) {\n    retryButton.onclick = null;\n    retryButton.remove();");
    expect(generator).toContain("() => requestGenerationRetry(mode),");
    expect(generator).toContain("new CustomEvent<SiteGenerationRetryDetail>(SITE_GENERATION_RETRY_EVENT, { detail: { mode } })");
    // 44px touch target, per rule 7.
    expect(generator).toContain(".full-generated-page-retry-button {\n        min-height: 44px;");
  });

  it("the gate starts the retry through its own startGeneration, so its busy flag, timeout and locks apply", () => {
    expect(source("lib/site-preview-state.ts")).toContain('export const SITE_GENERATION_RETRY_EVENT = "launchpad:site-generation-retry";');
    expect(gate).toContain("startGenerationFromEvent = startGeneration;");
    expect(gate).toContain('startGenerationFromEvent?.(mode === "bespoke" ? "bespoke" : "free");');
    expect(gate).toContain("window.addEventListener(SITE_GENERATION_RETRY_EVENT, onRetry);");
    expect(gate).toContain("window.removeEventListener(SITE_GENERATION_RETRY_EVENT, onRetry);");
    // Still exactly one generate-site dispatch site (the gate's), so a retry cannot bypass it.
    expect((gate.match(/window\.dispatchEvent\(new CustomEvent\("launchpad:generate-site"/g) || []).length).toBe(1);
    expect(generator).not.toContain('new CustomEvent("launchpad:generate-site"');
  });
});
