import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STREAMED_OUTPUT_TEXT_BUFFER_LIMIT,
  extractSseEventData,
  requestStreamedFullPageGeneration,
  splitCompleteSseEvents,
} from "@/lib/server/generate-site-page-stream";
import type { AIResponsesRuntime } from "@/lib/server/ai-responses-runtime";
import { sseEventChunk, sseResponse } from "./generate-site-page-test-helpers";

const AI: AIResponsesRuntime = {
  apiKey: "test-key",
  responsesUrl: "https://api.openai.com/v1/responses",
  model: "gpt-5-mini",
  source: "openai",
};

function completedEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "response.completed",
    response: { output: [{ type: "message", content: [{ type: "output_text", text: '{"html":"ok"}' }] }] },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("splitCompleteSseEvents / extractSseEventData", () => {
  it("returns no complete events until a full blank-line-terminated block has arrived", () => {
    const first = splitCompleteSseEvents('data: {"type":"response.output_text.delta","delta":"He');
    expect(first.events).toEqual([]);
    expect(first.remainder).toBe('data: {"type":"response.output_text.delta","delta":"He');
  });

  it("completes an event once the remaining bytes arrive in a later chunk", () => {
    const buffered = 'data: {"type":"response.output_text.delta","delta":"He' + 'llo"}\n\n';
    const { events, remainder } = splitCompleteSseEvents(buffered);
    expect(remainder).toBe("");
    expect(events).toHaveLength(1);
    expect(extractSseEventData(events[0])).toBe('{"type":"response.output_text.delta","delta":"Hello"}');
  });

  it("keeps a second, still-incomplete event buffered as the remainder", () => {
    const buffered = 'data: {"type":"a"}\n\n' + 'data: {"type":"b"';
    const { events, remainder } = splitCompleteSseEvents(buffered);
    expect(events).toHaveLength(1);
    expect(remainder).toBe('data: {"type":"b"');
  });
});

describe("requestStreamedFullPageGeneration", () => {
  it("parses a response.completed event split across multiple chunk boundaries", async () => {
    const whole = sseEventChunk(completedEvent());
    const splitPoint = Math.floor(whole.length / 2);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([whole.slice(0, splitPoint), whole.slice(splitPoint)]));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await requestStreamedFullPageGeneration(AI, { model: AI.model }, new AbortController().signal);

    expect(outcome).toEqual({
      ok: true,
      payload: completedEvent().response,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ model: AI.model, stream: true });
  });

  it("collects output_text deltas and still resolves once response.completed arrives", async () => {
    const onDelta = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        sseEventChunk({ type: "response.output_text.delta", delta: "partial " }),
        sseEventChunk({ type: "response.output_text.delta", delta: "html" }),
        sseEventChunk(completedEvent()),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await requestStreamedFullPageGeneration(AI, {}, new AbortController().signal, onDelta);

    expect(outcome.ok).toBe(true);
    expect(onDelta).toHaveBeenCalledTimes(2);
  });

  it("reports response.incomplete as a distinct, truthful failure kind", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          sseEventChunk({
            type: "response.incomplete",
            response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
          }),
        ]),
      ),
    );

    const outcome = await requestStreamedFullPageGeneration(AI, {}, new AbortController().signal);
    expect(outcome).toMatchObject({ ok: false, kind: "incomplete" });
    if (!outcome.ok) expect(outcome.detail).toContain("max_output_tokens");
  });

  it("reports response.failed as a distinct failure kind", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([sseEventChunk({ type: "response.failed", response: { error: { message: "server_error" } } })]),
      ),
    );

    const outcome = await requestStreamedFullPageGeneration(AI, {}, new AbortController().signal);
    expect(outcome).toMatchObject({ ok: false, kind: "failed", detail: "server_error" });
  });

  it("reports a protocol-level error event as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sseResponse([sseEventChunk({ type: "error", message: "stream reset" })])),
    );

    const outcome = await requestStreamedFullPageGeneration(AI, {}, new AbortController().signal);
    expect(outcome).toMatchObject({ ok: false, kind: "invalid", detail: "stream reset" });
  });

  it("treats a bare [DONE] before completion as an unexpected stream end", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(["data: [DONE]\n\n"])));

    const outcome = await requestStreamedFullPageGeneration(AI, {}, new AbortController().signal);
    expect(outcome).toMatchObject({ ok: false, kind: "invalid" });
    if (!outcome.ok) expect(outcome.detail).toContain("ended before");
  });

  it("stops buffering once the structured text exceeds the streaming cap", async () => {
    const oversized = "x".repeat(STREAMED_OUTPUT_TEXT_BUFFER_LIMIT + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([sseEventChunk({ type: "response.output_text.delta", delta: oversized })]),
      ),
    );

    const outcome = await requestStreamedFullPageGeneration(AI, {}, new AbortController().signal);
    expect(outcome).toMatchObject({ ok: false, kind: "invalid" });
    if (!outcome.ok) expect(outcome.detail).toContain("streaming buffer");
  });

  it("returns a network failure when the provider request itself throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection reset")));

    const outcome = await requestStreamedFullPageGeneration(AI, {}, new AbortController().signal);
    expect(outcome).toMatchObject({ ok: false, kind: "network", detail: "connection reset" });
  });

  it("returns an http failure for a non-200 provider response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad request", { status: 400 })));

    const outcome = await requestStreamedFullPageGeneration(AI, {}, new AbortController().signal);
    expect(outcome).toMatchObject({ ok: false, kind: "http", status: 400 });
  });
});
