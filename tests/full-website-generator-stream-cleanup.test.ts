import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestGeneratedWebsite } from "@/components/full-website-generator";

const ROOT = process.cwd();
const DETAIL = {
  name: "Journey",
  ticker: "RIDE",
  description: "A London journey token.",
  imageDataUrl: "data:image/png;base64,aGVsbG8=",
  inspirationUrl: "",
};

function openCompleteStream(onCancel: () => void): Response {
  const encoder = new TextEncoder();
  let sent = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return;
        sent = true;
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "complete",
              html: "<!doctype html><html><body>Done</body></html>",
              source: "openai",
              inspirationUsed: false,
            })}\n`,
          ),
        );
      },
      cancel() {
        onCancel();
      },
    }),
    { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
  );
}

describe("full website streaming client cleanup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requests NDJSON and releases the open response stream after complete", async () => {
    const onCancel = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(openCompleteStream(onCancel));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestGeneratedWebsite(DETAIL)).resolves.toEqual({
      html: "<!doctype html><html><body>Done</body></html>",
      inspirationUsed: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps one iframe and cleans requests, srcdoc, classes and listeners on unmount", async () => {
    const source = await readFile(
      path.join(ROOT, "components", "full-website-generator.tsx"),
      "utf8",
    );

    expect((source.match(/document\.createElement\("iframe"\)/g) || []).length).toBe(1);
    expect(source).not.toContain("useState");
    expect(source).toContain('frame.srcdoc = "";');
    expect(source.indexOf('frame.srcdoc = "";')).toBeLessThan(source.indexOf("frame.remove();"));
    expect(source).toContain("activeController?.abort();");
    expect(source).toContain('error.name === "AbortError"');
    expect(source).toContain('site.classList.remove("full-generated-page");');
    expect(source).toContain('window.removeEventListener("message", onMessage);');
    expect(source).toContain('window.removeEventListener("launchpad:generate-site", onGenerate);');
    expect(source).toContain("await reader.cancel();");
    expect(source).toContain("reader.releaseLock();");
  });
});
