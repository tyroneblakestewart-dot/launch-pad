import { afterEach, describe, expect, it, vi } from "vitest";
import { requestGeneratedWebsite } from "@/components/full-website-generator";

function ndjsonStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

function line(event: unknown): string {
  return `${JSON.stringify(event)}\n`;
}

const DETAIL = {
  name: "Journey",
  ticker: "RIDE",
  description: "A London journey token.",
  imageDataUrl: "data:image/png;base64,aGVsbG8=",
};

describe("requestGeneratedWebsite", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects before fetching when no artwork has been uploaded", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestGeneratedWebsite({ ...DETAIL, imageDataUrl: "" })).rejects.toThrow(
      "Upload artwork before generating the website.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses NDJSON progress and complete events split across arbitrary chunk boundaries", async () => {
    const progressLine = line({ type: "progress", stage: "analysing-artwork", message: "Analysing…" });
    const buildingLine = line({
      type: "progress",
      stage: "building-page",
      message: "Writing the finished website…",
      receivedCharacters: 512,
    });
    const completeLine = line({ type: "complete", html: "<!doctype html><html></html>", source: "openai", inspirationUsed: true });
    const whole = progressLine + buildingLine + completeLine;

    // Split mid-line to prove the reader re-assembles NDJSON lines across chunks,
    // not just whole-line-per-chunk network delivery.
    const splitPoint = progressLine.length + 5;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(ndjsonStreamResponse([whole.slice(0, splitPoint), whole.slice(splitPoint)])),
    );

    const progressEvents: Array<{ stage: string; message: string; receivedCharacters?: number }> = [];
    const result = await requestGeneratedWebsite(DETAIL, (progress) => progressEvents.push(progress));

    expect(result).toEqual({ html: "<!doctype html><html></html>", inspirationUsed: true });
    expect(progressEvents).toEqual([
      { stage: "analysing-artwork", message: "Analysing…", receivedCharacters: undefined },
      { stage: "building-page", message: "Writing the finished website…", receivedCharacters: 512 },
    ]);
  });

  it("throws using the streamed error event's message", async () => {
    const body =
      line({ type: "progress", stage: "analysing-artwork", message: "Analysing…" }) +
      line({ type: "error", error: "The inspiration website could not be inspected." });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjsonStreamResponse([body])));

    await expect(requestGeneratedWebsite(DETAIL)).rejects.toThrow(
      "The inspiration website could not be inspected.",
    );
  });

  it("throws a clear error when the stream ends without a complete or error event", async () => {
    const body = line({ type: "progress", stage: "analysing-artwork", message: "Analysing…" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjsonStreamResponse([body])));

    await expect(requestGeneratedWebsite(DETAIL)).rejects.toThrow(
      "The generated website document was missing.",
    );
  });

  it("still parses a plain JSON error body for pre-stream failures like rate limiting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Website generation rate limit exceeded. Try again later." }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(requestGeneratedWebsite(DETAIL)).rejects.toThrow(
      "Website generation rate limit exceeded. Try again later.",
    );
  });
});
