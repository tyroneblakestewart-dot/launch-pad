import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_STREAMED_OUTPUT_TEXT_LENGTH,
  streamGeneratedSitePage,
} from "@/lib/server/generate-site-page-stream";
import type { AIResponsesRuntime } from "@/lib/server/ai-responses-runtime";

const AI: AIResponsesRuntime = {
  apiKey: "test-key",
  responsesUrl: "https://api.openai.com/v1/responses",
  model: "gpt-5-mini",
  source: "openai",
};

function sseEvent(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

function sseStreamResponse(chunks: Array<string | Uint8Array>, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "Content-Type": "text/event-stream" } });
}

describe("streamGeneratedSitePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("makes exactly one streamed provider request with stream:true and the caller's abort signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseStreamResponse([sseEvent("response.completed", { response: { output: [] } })]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamGeneratedSitePage(AI, { model: "gpt-5-mini" }, controller.signal);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(AI.responsesUrl);
    expect(init.signal).toBe(controller.signal);
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "gpt-5-mini", stream: true });
  });

  it("parses an SSE event split across multiple chunk boundaries", async () => {
    const full = sseEvent("response.completed", { response: { output: [], id: "resp_split" } });
    const midpoint = Math.floor(full.length / 2);
    const chunk1 = full.slice(0, midpoint);
    const chunk2 = full.slice(midpoint);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(sseStreamResponse([chunk1, chunk2])));

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toMatchObject({ id: "resp_split" });
  });

  it("reassembles a multi-byte UTF-8 character split across chunk boundaries", async () => {
    const encoder = new TextEncoder();
    const prefix = `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"`;
    const emoji = "🙂";
    const suffix = `"}\n\n`;
    const prefixBytes = encoder.encode(prefix);
    const emojiBytes = encoder.encode(emoji);
    const suffixBytes = encoder.encode(suffix);
    const chunk1 = new Uint8Array([...prefixBytes, ...emojiBytes.slice(0, 2)]);
    const chunk2 = new Uint8Array([...emojiBytes.slice(2), ...suffixBytes]);
    const completed = sseEvent("response.completed", { response: { output: [] } });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(sseStreamResponse([chunk1, chunk2, completed])));

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(true);
  });

  it("resolves the final payload only from response.completed", async () => {
    const payload = { output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        sseStreamResponse([
          sseEvent("response.created", {}),
          sseEvent("response.output_text.delta", { delta: "partial should never be exposed" }),
          sseEvent("response.completed", { response: payload }),
        ]),
      ),
    );

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toEqual(payload);
  });

  it("does not double-count output_text.done text that already arrived via deltas", async () => {
    const text = "x".repeat(150_000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        sseStreamResponse([
          sseEvent("response.output_text.delta", { delta: text }),
          sseEvent("response.output_text.done", { text }),
          sseEvent("response.completed", { response: { output: [] } }),
        ]),
      ),
    );

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(true);
  });

  it("uses output_text.done text length for the cap when no deltas arrived", async () => {
    const text = "x".repeat(MAX_STREAMED_OUTPUT_TEXT_LENGTH + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        sseStreamResponse([
          sseEvent("response.output_text.done", { text }),
          sseEvent("response.completed", { response: { output: [] } }),
        ]),
      ),
    );

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("invalid");
      expect(result.detail).toContain("streaming buffer cap");
    }
  });

  it("fails once accumulated deltas exceed the streaming buffer cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        sseStreamResponse([
          sseEvent("response.output_text.delta", { delta: "x".repeat(MAX_STREAMED_OUTPUT_TEXT_LENGTH + 1) }),
          sseEvent("response.completed", { response: { output: [] } }),
        ]),
      ),
    );

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("streaming buffer cap");
  });

  it("treats response.incomplete as a failure with the incomplete reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        sseStreamResponse([
          sseEvent("response.incomplete", {
            response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
          }),
        ]),
      ),
    );

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("invalid");
      expect(result.detail).toContain("max_output_tokens");
    }
  });

  it("treats response.failed as a failure with the provider's error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        sseStreamResponse([
          sseEvent("response.failed", { response: { status: "failed", error: { message: "content filter" } } }),
        ]),
      ),
    );

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("content filter");
  });

  it("treats a protocol-level error event as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(sseStreamResponse([sseEvent("error", { message: "rate limited" })])),
    );

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("rate limited");
  });

  it("treats a bare [DONE] with no completed event as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(sseStreamResponse(["event: response.created\ndata: [DONE]\n\n"])),
    );

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("ended before returning a completed response");
  });

  it("flushes the decoder and defensively parses a final unterminated SSE block at EOF", async () => {
    const response = { output: [], id: "resp_unterminated" };
    const unterminated = `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response })}`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(sseStreamResponse([unterminated])));

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toMatchObject({ id: "resp_unterminated" });
  });

  it("fails if the stream ends without any completed event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(sseStreamResponse([sseEvent("response.created", {})])),
    );

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("ended without a completed response");
  });

  it("returns a network failure when the provider fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("network down")));

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("network");
  });

  it("returns an http failure when the provider responds with a non-2xx status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("bad request", { status: 400 })),
    );

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("http");
      expect(result.status).toBe(400);
    }
  });

  it("redacts secrets from sanitised failure detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response("Bearer secret-token-value rejected", { status: 401 }),
      ),
    );

    const result = await streamGeneratedSitePage(AI, {}, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).not.toContain("secret-token-value");
      expect(result.detail).toContain("Bearer [redacted]");
    }
  });
});
