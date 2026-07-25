import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STREAMED_OUTPUT_TEXT_BUFFER_LIMIT,
  requestStreamedFullPageGeneration,
} from "@/lib/server/generate-site-page-stream";
import type { AIResponsesRuntime } from "@/lib/server/ai-responses-runtime";

const AI: AIResponsesRuntime = {
  apiKey: "test-key",
  responsesUrl: "https://example.test/v1/responses",
  model: "gpt-test",
  source: "openai",
};

function sse(payload: unknown, terminated = true): string {
  return `data: ${JSON.stringify(payload)}${terminated ? "\n\n" : ""}`;
}

function streamResponse(chunks: string[], onCancel?: () => void, close = true): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(encoder.encode(chunks[index]));
          index += 1;
          return;
        }
        if (close) controller.close();
      },
      cancel() {
        onCancel?.();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function completedResponse() {
  return { output: [{ type: "message", content: [] }] };
}

describe("streamed full-page response finalisation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("accounts for output_text.done when a provider sends no deltas", async () => {
    const onDelta = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      streamResponse([
        sse({ type: "response.output_text.done", text: "finished structured text" }) +
          sse({ type: "response.completed", response: completedResponse() }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const result = await requestStreamedFullPageGeneration(AI, { model: "gpt-test" }, controller.signal, onDelta);

    expect(result.ok).toBe(true);
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "gpt-test", stream: true });
    expect(init.signal).toBe(controller.signal);
  });

  it("does not double-count the done text after deltas", async () => {
    const onDelta = vi.fn();
    const oversizedDoneText = "x".repeat(STREAMED_OUTPUT_TEXT_BUFFER_LIMIT + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse([
          sse({ type: "response.output_text.delta", delta: "small delta" }) +
            sse({ type: "response.output_text.done", text: oversizedDoneText }) +
            sse({ type: "response.completed", response: completedResponse() }),
        ]),
      ),
    );

    const result = await requestStreamedFullPageGeneration(
      AI,
      { model: "gpt-test" },
      new AbortController().signal,
      onDelta,
    );

    expect(result.ok).toBe(true);
    expect(onDelta).toHaveBeenCalledTimes(1);
  });

  it("enforces the buffer cap for done-only providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse([
          sse({
            type: "response.output_text.done",
            text: "x".repeat(STREAMED_OUTPUT_TEXT_BUFFER_LIMIT + 1),
          }) + sse({ type: "response.completed", response: completedResponse() }),
        ]),
      ),
    );

    const result = await requestStreamedFullPageGeneration(
      AI,
      { model: "gpt-test" },
      new AbortController().signal,
    );

    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    if (!result.ok) expect(result.detail).toContain("streaming buffer");
  });

  it("flushes and parses a final terminal event without a trailing blank line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse([
          sse({ type: "response.completed", response: completedResponse() }, false),
        ]),
      ),
    );

    const result = await requestStreamedFullPageGeneration(
      AI,
      { model: "gpt-test" },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
  });

  it("cancels the provider reader after a terminal event", async () => {
    const onCancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse(
          [sse({ type: "response.completed", response: completedResponse() })],
          onCancel,
          false,
        ),
      ),
    );

    const result = await requestStreamedFullPageGeneration(
      AI,
      { model: "gpt-test" },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
