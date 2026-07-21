import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-style/route";
import { isValidInspirationWebsiteUrl } from "@/components/build-site-gate";
import {
  MAX_INSPIRATION_URL_LENGTH,
  buildOpenAIRequestBody,
  buildSiteStylePrompt,
  getInspirationDomain,
  isValidInspirationUrl,
  normaliseGenerateSiteStyleRequest,
  type SiteStyle,
} from "@/lib/server/generate-site-style";

const ROOT = process.cwd();
const VALID_IMAGE = "data:image/png;base64,aGVsbG8=";
const INSPIRATION_URL = "https://example.com/meme-launch";
const VALID_STYLE: SiteStyle = {
  background: "#050706",
  surface: "#101510",
  text: "#F4F7EF",
  muted: "#AAB2AA",
  primary: "#BCE759",
  secondary: "#91C738",
  accent: "#E8C435",
  layout: "split",
  mood: "playful",
  texture: "grain",
  radius: "soft",
  eyebrow: "MEME POWERED",
  headline: "A landing page born from the uploaded meme artwork.",
  cta: "JOIN $MEME",
};

function request(body: unknown) {
  return new Request("http://localhost/api/generate-site-style", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("optional inspiration website URL", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
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

  it("adds domain-restricted web inspiration only when a URL is supplied", () => {
    const withInspiration = normaliseGenerateSiteStyleRequest({
      name: "Meme",
      ticker: "MEME",
      description: "A meme project with enough story to generate a website.",
      imageDataUrl: VALID_IMAGE,
      inspirationUrl: INSPIRATION_URL,
    });
    const prompt = buildSiteStylePrompt(withInspiration);
    const outbound = buildOpenAIRequestBody(withInspiration, "test-model");

    expect(prompt).toContain(`Optional inspiration website: ${INSPIRATION_URL}`);
    expect(prompt).toContain("uploaded artwork/content remains mandatory");
    expect(prompt).toContain("Do not copy branding, logos, source code, assets, wording");
    expect(outbound.tools).toEqual([
      {
        type: "web_search",
        search_context_size: "low",
        filters: { allowed_domains: ["example.com"] },
      },
    ]);

    const uploadOnly = normaliseGenerateSiteStyleRequest({
      imageDataUrl: VALID_IMAGE,
    });
    expect(buildSiteStylePrompt(uploadOnly)).toContain("No inspiration website was supplied");
    expect(buildOpenAIRequestBody(uploadOnly, "test-model")).not.toHaveProperty("tools");
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

  it("passes a valid inspiration URL privately to the domain-restricted OpenAI request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [{ content: [{ type: "output_text", text: JSON.stringify(VALID_STYLE) }] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
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
    expect(JSON.stringify(responseBody)).not.toContain(INSPIRATION_URL);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const outbound = JSON.parse(String(init.body)) as {
      tools?: Array<{ filters?: { allowed_domains?: string[] } }>;
      input: Array<{ role: string; content: Array<{ text?: string }> }>;
    };
    expect(outbound.tools?.[0].filters?.allowed_domains).toEqual(["example.com"]);
    expect(outbound.input[1].content[0].text).toContain(INSPIRATION_URL);
  });

  it("shows the optional field while enforcing the required upload in the website builder", async () => {
    const gate = await readFile(
      path.join(ROOT, "components", "build-site-gate.tsx"),
      "utf8",
    );
    const generator = await readFile(
      path.join(ROOT, "components", "artwork-site-generator.tsx"),
      "utf8",
    );

    expect(gate).toContain("Inspiration website URL");
    expect(gate).toContain("build-site-inspiration-url");
    expect(gate).toContain('type="url"');
    expect(gate).toContain("Uploaded artwork/content is still required");
    expect(gate).toContain('label: "Uploaded artwork/content"');
    expect(gate).toContain('detail.imageDataUrl?.startsWith("data:image/")');
    expect(gate).toContain("inspirationUrl:");
    expect(gate).toContain('new CustomEvent("launchpad:generate-site", { detail })');
    expect(generator).toContain("body: JSON.stringify(detail)");
  });
});
