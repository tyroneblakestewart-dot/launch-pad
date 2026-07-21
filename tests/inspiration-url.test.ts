import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-style/route";
import { isValidInspirationWebsiteUrl } from "@/components/build-site-gate";
import { requestGeneratedSiteStyle } from "@/components/artwork-site-generator";
import {
  buildFinalSiteStyleRequestBody,
  buildInspirationInspectionRequestBody,
} from "@/lib/site-style-openai-pipeline";
import {
  MAX_INSPIRATION_URL_LENGTH,
  buildSiteStylePrompt,
  getInspirationDomain,
  isValidInspirationUrl,
  normaliseGenerateSiteStyleRequest,
} from "@/lib/server/generate-site-style";
import { VALID_STYLE } from "./site-style-fixture";

const ROOT = process.cwd();
const VALID_IMAGE = "data:image/png;base64,aGVsbG8=";
const INSPIRATION_URL = "https://example.com/meme-launch";
const INSPIRATION_BRIEF =
  "Typography is oversized and playful. The hero centres the artwork, motion is bouncy, sections are compact and the copy is witty and conversational.";

function request(body: unknown) {
  return new Request("http://localhost/api/generate-site-style", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function inspirationInspectionResponse(withSearch = true) {
  return new Response(
    JSON.stringify({
      output: [
        ...(withSearch
          ? [
              {
                type: "web_search_call",
                status: "completed",
                action: {
                  sources: [{ type: "url", url: INSPIRATION_URL }],
                },
              },
            ]
          : []),
        { content: [{ type: "output_text", text: INSPIRATION_BRIEF }] },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function successfulStyleResponse() {
  return new Response(
    JSON.stringify({
      output: [{ content: [{ type: "output_text", text: JSON.stringify(VALID_STYLE) }] }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("optional inspiration website URL", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalises the optional URL without allowing overlong input to become valid", () => {
    expect(normaliseGenerateSiteStyleRequest({}).inspirationUrl).toBe("");
    expect(
      normaliseGenerateSiteStyleRequest({ inspirationUrl: `  ${INSPIRATION_URL}  ` })
        .inspirationUrl,
    ).toBe(INSPIRATION_URL);
    expect(
      normaliseGenerateSiteStyleRequest({
        inspirationUrl: `https://example.com/${"a".repeat(MAX_INSPIRATION_URL_LENGTH)}`,
      }).inspirationUrl,
    ).toHaveLength(MAX_INSPIRATION_URL_LENGTH + 1);
  });

  it("accepts optional public website URLs and rejects unsafe or malformed values", () => {
    for (const value of ["", "https://example.com", "http://design.example/page"]) {
      expect(isValidInspirationUrl(value)).toBe(true);
      expect(isValidInspirationWebsiteUrl(value)).toBe(true);
    }

    for (const value of [
      "ftp://example.com",
      "not a url",
      "https://user:password@example.com",
      "http://localhost:3000",
      "http://127.0.0.1/site",
      "http://internal.local/page",
      `https://example.com/${"a".repeat(MAX_INSPIRATION_URL_LENGTH)}`,
    ]) {
      expect(isValidInspirationUrl(value)).toBe(false);
      expect(isValidInspirationWebsiteUrl(value)).toBe(false);
    }

    expect(isValidInspirationUrl(undefined)).toBe(false);
    expect(getInspirationDomain(INSPIRATION_URL)).toBe("example.com");
    expect(getInspirationDomain("")).toBeNull();
  });

  it("uses a separate high-context domain-restricted inspection before strict generation", () => {
    const withInspiration = normaliseGenerateSiteStyleRequest({
      name: "Meme",
      ticker: "MEME",
      description: "A meme project with enough story to generate a website.",
      imageDataUrl: VALID_IMAGE,
      inspirationUrl: INSPIRATION_URL,
    });
    const prompt = buildSiteStylePrompt(withInspiration);
    const inspection = buildInspirationInspectionRequestBody(withInspiration, "test-model");
    const generation = buildFinalSiteStyleRequestBody(
      withInspiration,
      "test-model",
      INSPIRATION_BRIEF,
    ) as {
      tools?: unknown;
      tool_choice?: unknown;
      input: Array<{ content: Array<{ text?: string }> }>;
    };

    expect(prompt).toContain(`Optional inspiration website: ${INSPIRATION_URL}`);
    expect(inspection?.tools).toEqual([
      {
        type: "web_search",
        search_context_size: "high",
        filters: { allowed_domains: ["example.com"] },
      },
    ]);
    expect(inspection?.tool_choice).toBe("required");
    expect(inspection?.include).toEqual(["web_search_call.action.sources"]);
    expect(inspection).not.toHaveProperty("text.format");

    expect(generation).not.toHaveProperty("tools");
    expect(generation).not.toHaveProperty("tool_choice");
    expect(generation.input[1].content[0].text).toContain(INSPIRATION_BRIEF);

    const uploadOnly = normaliseGenerateSiteStyleRequest({ imageDataUrl: VALID_IMAGE });
    expect(buildFinalSiteStyleRequestBody(uploadOnly, "test-model")).not.toHaveProperty(
      "tools",
    );
  });

  it("keeps uploaded content mandatory even when an inspiration URL is supplied", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ inspirationUrl: INSPIRATION_URL }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A valid optimised artwork image is required.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid optional URL before contacting OpenAI", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({ imageDataUrl: VALID_IMAGE, inspirationUrl: "javascript:alert(1)" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Enter a valid public http or https inspiration website URL.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to claim inspiration was used when the inspection did not use web search", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(inspirationInspectionResponse(false));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({
        name: "Meme",
        ticker: "MEME",
        description: "A meme project with enough story to generate a website.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: INSPIRATION_URL,
      }),
    );

    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("was not inspected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses two fresh OpenAI stages and returns inspirationUsed only after both succeed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(inspirationInspectionResponse(true))
      .mockResolvedValueOnce(successfulStyleResponse());
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({
        name: "Meme",
        ticker: "MEME",
        description: "A meme project with enough story to generate a website.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: INSPIRATION_URL,
      }),
    );
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody.style).toEqual({
      ...VALID_STYLE,
      source: "openai",
      inspirationUsed: true,
    });
    expect(JSON.stringify(responseBody)).not.toContain(INSPIRATION_URL);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [, inspectionInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const inspectionOutbound = JSON.parse(String(inspectionInit.body)) as {
      tool_choice?: string;
      tools?: Array<{ filters?: { allowed_domains?: string[] } }>;
      input: Array<{ role: string; content: Array<{ text?: string }> }>;
    };
    expect(inspectionOutbound.tool_choice).toBe("required");
    expect(inspectionOutbound.tools?.[0].filters?.allowed_domains).toEqual(["example.com"]);
    expect(inspectionOutbound.input[1].content[0].text).toContain(INSPIRATION_URL);

    const [, generationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const generationOutbound = JSON.parse(String(generationInit.body)) as {
      tools?: unknown;
      tool_choice?: unknown;
      input: Array<{ content: Array<{ text?: string }> }>;
    };
    expect(generationOutbound).not.toHaveProperty("tools");
    expect(generationOutbound).not.toHaveProperty("tool_choice");
    expect(generationOutbound.input[1].content[0].text).toContain(INSPIRATION_BRIEF);
  });

  it("stops after inspection when the final artwork generation fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(inspirationInspectionResponse(true))
      .mockResolvedValueOnce(new Response("generation failed", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({
        name: "Meme",
        ticker: "MEME",
        description: "A meme project with enough story to generate a website.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: INSPIRATION_URL,
      }),
    );

    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain(
      "website was inspected, but the artwork design could not be generated",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not silently fall back to artwork-only generation when a requested URL fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "The inspiration website could not be inspected." }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      requestGeneratedSiteStyle({
        name: "Meme",
        ticker: "MEME",
        description: "A meme project with enough story to generate a website.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: INSPIRATION_URL,
      }),
    ).rejects.toThrow("could not be inspected");
  });

  it("still permits browser artwork fallback when no inspiration URL was requested", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Unavailable" }), { status: 502 })),
    );

    await expect(
      requestGeneratedSiteStyle({
        name: "Meme",
        ticker: "MEME",
        description: "A meme project with enough story to generate a website.",
        imageDataUrl: VALID_IMAGE,
      }),
    ).resolves.toBeNull();
  });

  it("applies inspiration to visible typography, hero, motion and section content", async () => {
    const gate = await readFile(path.join(ROOT, "components", "build-site-gate.tsx"), "utf8");
    const generator = await readFile(
      path.join(ROOT, "components", "artwork-site-generator.tsx"),
      "utf8",
    );

    expect(gate).toContain("Inspiration website URL");
    expect(gate).toContain('label: "Uploaded artwork/content"');
    expect(generator).toContain("style.inspirationUsed");
    expect(generator).toContain("data-generated-font");
    expect(generator).toContain("data-generated-hero");
    expect(generator).toContain("data-generated-motion");
    expect(generator).toContain("style.heroBody");
    expect(generator).toContain("style.aboutBody");
    expect(generator).toContain("style.roadmap[index]");
    expect(generator).toContain("style.tickerPhrase");
    expect(generator).not.toContain("requestGeneratedSiteStyle(detail).catch(() => null)");
  });
});
