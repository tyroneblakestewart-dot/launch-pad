import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestGeneratedWebsite } from "@/components/full-website-generator";

const ROOT = process.cwd();

function ndjsonResponse(lines: string[], init: { chunk?: (body: string) => string[] } = {}): Response {
  const body = lines.map((line) => `${line}\n`).join("");
  const parts = init.chunk ? init.chunk(body) : [body];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

const DETAIL = {
  name: "Journey",
  ticker: "RIDE",
  description: "A community token",
  imageDataUrl: "data:image/png;base64,aGVsbG8=",
  inspirationUrl: "",
};

describe("requestGeneratedWebsite", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the Accept header and forwards the abort signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(
      ndjsonResponse([JSON.stringify({ type: "complete", html: "<!doctype html>", inspirationUsed: false })]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestGeneratedWebsite(DETAIL, () => {}, controller.signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/generate-site-page");
    expect(new Headers(init.headers).get("Accept")).toBe("application/x-ndjson");
    expect(init.signal).toBe(controller.signal);
  });

  it("reports progress events and resolves on complete, across arbitrary chunk splits", async () => {
    const lines = [
      JSON.stringify({ type: "progress", stage: "analysing-artwork", message: "Analysing…" }),
      JSON.stringify({ type: "progress", stage: "building-page", message: "Writing…", receivedCharacters: 2000 }),
      JSON.stringify({ type: "complete", html: "<!doctype html><html></html>", source: "openai", inspirationUsed: true }),
    ];
    const full = lines.map((line) => `${line}\n`).join("");

    for (let cut = 1; cut < full.length; cut += 7) {
      const fetchMock = vi.fn().mockResolvedValue(
        ndjsonResponse(lines, { chunk: () => [full.slice(0, cut), full.slice(cut)] }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const progress: unknown[] = [];
      const result = await requestGeneratedWebsite(DETAIL, (event) => progress.push(event), new AbortController().signal);

      expect(result).toEqual({ html: "<!doctype html><html></html>", inspirationUsed: true });
      expect(progress).toEqual([
        { stage: "analysing-artwork", message: "Analysing…", receivedCharacters: undefined },
        { stage: "building-page", message: "Writing…", receivedCharacters: 2000 },
      ]);
      vi.unstubAllGlobals();
    }
  });

  it("rejects with the typed error message from a mid-stream error event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ndjsonResponse([
        JSON.stringify({ type: "progress", stage: "analysing-artwork", message: "Analysing…" }),
        JSON.stringify({ type: "error", error: "The artwork could not be analysed." }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestGeneratedWebsite(DETAIL, () => {}, new AbortController().signal),
    ).rejects.toThrow("The artwork could not be analysed.");
  });

  it("rejects when the stream ends without a complete or error event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ndjsonResponse([JSON.stringify({ type: "progress", stage: "building-page", message: "Writing…" })]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestGeneratedWebsite(DETAIL, () => {}, new AbortController().signal),
    ).rejects.toThrow("ended before completing");
  });

  it("passes through a pre-stream JSON error without reading it as NDJSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Website generation rate limit exceeded. Try again later." }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestGeneratedWebsite(DETAIL, () => {}, new AbortController().signal),
    ).rejects.toThrow("rate limit exceeded");
  });

  it("requires uploaded artwork before making any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestGeneratedWebsite({ ...DETAIL, imageDataUrl: undefined }, () => {}, new AbortController().signal),
    ).rejects.toThrow("Upload artwork");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("full-website-generator source guards", () => {
  it("keeps exactly one iframe, disposes srcdoc before removal, and never stores generated HTML in React state", async () => {
    const source = await readFile(
      path.join(ROOT, "components", "full-website-generator.tsx"),
      "utf8",
    );

    expect(source).not.toContain("useState");
    expect(source).toContain('frame.setAttribute("sandbox", "allow-scripts")');
    expect(source).toContain("frame.srcdoc = prepared");

    // Replacing an existing iframe disposes its srcdoc before removal.
    expect(source).toMatch(/previous\.srcdoc = "";\s*previous\.remove\(\);/);

    // Unmount disposes srcdoc, removes the node, clears the ref, and drops the page class.
    expect(source).toMatch(/activeFrame\.srcdoc = "";\s*activeFrame\.remove\(\);\s*activeFrame = null;/);
    expect(source).toMatch(/site\.classList\.remove\("full-generated-page"\)/);
  });

  it("uses a single AbortController per generation, aborting the previous one and on unmount", async () => {
    const source = await readFile(
      path.join(ROOT, "components", "full-website-generator.tsx"),
      "utf8",
    );
    expect(source).toContain("new AbortController()");
    expect(source).toContain("activeController?.abort()");
    // Abort must happen both when starting a new generation and on unmount cleanup.
    const abortCount = source.split("activeController?.abort()").length - 1;
    expect(abortCount).toBeGreaterThanOrEqual(2);
  });

  it("treats AbortError from an obsolete generation silently", async () => {
    const source = await readFile(
      path.join(ROOT, "components", "full-website-generator.tsx"),
      "utf8",
    );
    expect(source).toContain('(error as { name?: unknown }).name === "AbortError"');
    expect(source).toContain("if (isAbortError(error)) return;");
  });
});
