import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-page/route";

async function readNdjson(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("POST /api/generate-site-page provider diagnostics", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("streams a sanitized stage, provider, status and upstream detail for artwork failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: "Unsupported image request. Bearer secret-provider-token",
              type: "invalid_request_error",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const response = await POST(
      new Request("https://hoodlums.dev/api/generate-site-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Journey",
          ticker: "RIDE",
          description: "A London journey community project with enough detail for generation.",
          imageDataUrl: "data:image/jpeg;base64,aGVsbG8=",
        }),
      }),
    );

    // Validation already passed, so streaming has started: the artwork
    // failure surfaces as a typed NDJSON error event on a 200 response.
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const events = await readNdjson(response);
    expect(events[0]).toMatchObject({ type: "progress", stage: "analysing-artwork" });
    const errorEvent = events.at(-1) as { type: string; error: string; providerError: Record<string, unknown> };
    expect(errorEvent.type).toBe("error");
    expect(errorEvent.error).toContain("artwork-analysis service could not complete");
    expect(errorEvent.error).toContain("artwork has not been rejected");
    expect(errorEvent.providerError).toMatchObject({
      stage: "page-artwork-analysis",
      provider: "openai",
      kind: "http",
      status: 400,
    });
    expect(errorEvent.providerError.detail).toContain("Unsupported image request");
    expect(JSON.stringify(events)).not.toContain("secret-provider-token");
  });
});
