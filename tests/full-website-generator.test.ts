import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GENERATE_SITE_PAGE_NDJSON_CONTENT_TYPE,
  type GenerateSitePageStreamStage,
} from "@/lib/generate-site-page-stream-protocol";
import { requestGeneratedWebsiteStream } from "@/components/full-website-generator";

const ROOT = process.cwd();
const VALID_DETAIL = {
  name: "Journey",
  ticker: "RIDE",
  description: "A community token.",
  imageDataUrl: "data:image/png;base64,aGVsbG8=",
};

function fakeReader(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    read: vi.fn(async () => {
      if (index >= chunks.length) return { done: true, value: undefined };
      const value = encoder.encode(chunks[index]);
      index += 1;
      return { done: false, value };
    }),
    cancel: vi.fn(async () => undefined),
    releaseLock: vi.fn(),
  };
}

function fakeStreamResponse(chunks: string[]) {
  const reader = fakeReader(chunks);
  const response = {
    ok: true,
    body: { getReader: () => reader },
    json: async () => ({}),
  } as unknown as Response;
  return { response, reader };
}

describe("requestGeneratedWebsiteStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the ndjson Accept header alongside the JSON content type", async () => {
    const { response } = fakeStreamResponse(['{"type":"complete","html":"<p></p>","source":"openai","inspirationUsed":false}\n']);
    const fetchMock = vi.fn().mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);

    await requestGeneratedWebsiteStream(VALID_DETAIL, () => undefined, new AbortController().signal);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Accept")).toBe(GENERATE_SITE_PAGE_NDJSON_CONTENT_TYPE);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("parses progress events split across chunk boundaries in stage order", async () => {
    const { response } = fakeStreamResponse([
      '{"type":"progress","stage":"analysing-',
      'artwork"}\n{"type":"progress","stage":"preparing-design"}\n',
      '{"type":"complete","html":"<p>done</p>","source":"openai","inspirationUsed":true}\n',
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response));

    const stages: GenerateSitePageStreamStage[] = [];
    const result = await requestGeneratedWebsiteStream(
      VALID_DETAIL,
      (stage) => stages.push(stage),
      new AbortController().signal,
    );

    expect(stages).toEqual(["analysing-artwork", "preparing-design"]);
    expect(result).toEqual({ html: "<p>done</p>", source: "openai", inspirationUsed: true });
  });

  it("parses a final unterminated NDJSON line at stream end", async () => {
    const { response } = fakeStreamResponse([
      '{"type":"complete","html":"<p>done</p>","source":"openai","inspirationUsed":false}',
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response));

    const result = await requestGeneratedWebsiteStream(VALID_DETAIL, () => undefined, new AbortController().signal);
    expect(result).toEqual({ html: "<p>done</p>", source: "openai", inspirationUsed: false });
  });

  it("rejects with the server's error event message", async () => {
    const { response, reader } = fakeStreamResponse(['{"type":"error","error":"AI returned an invalid document."}\n']);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response));

    await expect(
      requestGeneratedWebsiteStream(VALID_DETAIL, () => undefined, new AbortController().signal),
    ).rejects.toThrow("AI returned an invalid document.");
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("always cancels and releases the reader once a complete event resolves", async () => {
    const { response, reader } = fakeStreamResponse([
      '{"type":"complete","html":"<p></p>","source":"openai","inspirationUsed":false}\n',
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response));

    await requestGeneratedWebsiteStream(VALID_DETAIL, () => undefined, new AbortController().signal);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("releases the reader and throws when the stream ends without a complete or error event", async () => {
    const { response, reader } = fakeStreamResponse(['{"type":"progress","stage":"analysing-artwork"}\n']);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response));

    await expect(
      requestGeneratedWebsiteStream(VALID_DETAIL, () => undefined, new AbortController().signal),
    ).rejects.toThrow("The full website could not be generated.");
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("requires uploaded artwork before making any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestGeneratedWebsiteStream(
        { ...VALID_DETAIL, imageDataUrl: undefined },
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Upload artwork before generating the website.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws the JSON error body when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        body: null,
        json: async () => ({ error: "Website generation rate limit exceeded." }),
      } as unknown as Response),
    );

    await expect(
      requestGeneratedWebsiteStream(VALID_DETAIL, () => undefined, new AbortController().signal),
    ).rejects.toThrow("Website generation rate limit exceeded.");
  });
});

describe("full-website-generator source guards", () => {
  it("keeps a single iframe creation site, disposes srcdoc on replacement/unmount, and never renders before completion", async () => {
    const source = await readFile(
      path.join(ROOT, "components", "full-website-generator.tsx"),
      "utf8",
    );

    const iframeCreations = [...source.matchAll(/document\.createElement\("iframe"\)/g)];
    expect(iframeCreations).toHaveLength(1);

    expect(source).toContain("function disposeFrame(");
    expect(source).toContain('frame.srcdoc = "";');
    expect(source).toContain("disposeFrame(previousFrame)");
    expect(source).toContain("disposeFrame(activeFrame)");
    expect(source).toContain('site.classList.remove("full-generated-page")');

    // The DOM is only ever mutated with generated HTML from a validated "complete" outcome.
    expect(source).toContain("renderGeneratedWebsite(page.html");
    expect(source).not.toMatch(/renderGeneratedWebsite\([^)]*event\.html/);

    expect(source).toContain("reader.cancel()");
    expect(source).toContain("reader.releaseLock()");
    expect(source).toContain("Accept: GENERATE_SITE_PAGE_NDJSON_CONTENT_TYPE");
    expect(source).toContain("activeController?.abort()");
  });
});
