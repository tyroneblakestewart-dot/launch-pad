import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-style/route";
import { isValidInspirationWebsiteUrl } from "@/components/build-site-gate";
import { requestGeneratedSiteStyle } from "@/components/artwork-site-generator";
import {
  buildArtworkIdentityRequestBody,
  buildFinalSiteStyleRequestBody,
  buildInspirationInspectionRequestBody,
  getFusionBriefIds,
  type ArtworkIdentity,
} from "@/lib/site-style-openai-pipeline";
import {
  MAX_INSPIRATION_URL_LENGTH,
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
const ARTWORK_IDENTITY: ArtworkIdentity = {
  dominantColours: "Forest green #14371F, hood green #2E7D3F, gold #E8C435, off-white and near-black.",
  memeEnergy: "Rebellious street-heist energy with confident, mischievous and community-led momentum.",
  subjectAndIcons: "A hooded crew leader, gold jewellery, green arrows, code rain and a duffel bag.",
  visibleText: "HOODLUMS and small character-role labels are visible.",
  typographyPersonality: "Heavy urban display lettering with sharp terminal-style supporting copy.",
  copyVoice: "Confident, funny, degen and rebellious without making financial promises.",
  nonNegotiables: "Keep the dark code atmosphere, green crew identity, gold accents and central character recognisable.",
};

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
                action: { sources: [{ type: "url", url: INSPIRATION_URL }] },
              },
            ]
          : []),
        { content: [{ type: "output_text", text: INSPIRATION_BRIEF }] },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function artworkIdentityResponse(valid = true) {
  return new Response(
    JSON.stringify({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify(
                valid ? ARTWORK_IDENTITY : { ...ARTWORK_IDENTITY, copyVoice: "short" },
              ),
            },
          ],
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function collaborativeStyleResponse(validEvidence = true) {
  const ids = getFusionBriefIds(ARTWORK_IDENTITY, INSPIRATION_BRIEF);
  return new Response(
    JSON.stringify({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                ...VALID_STYLE,
                fusionEvidence: {
                  ...ids,
                  inspirationBriefId: validEvidence ? ids.inspirationBriefId : "url-00000000",
                  artworkInfluence:
                    "The artwork supplies the green and gold palette, hooded character, code atmosphere and rebellious voice.",
                  inspirationInfluence:
                    "The website supplies oversized type, centred hero composition, bounce motion and compact pacing.",
                  collaborationDecision:
                    "The presentation was rebuilt around the artwork identity so the structure and meme content feel like one native design.",
                },
              }),
            },
          ],
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function collaborativeFetchMock(options: {
  withSearch?: boolean;
  validArtwork?: boolean;
  generationStatus?: number;
  validEvidence?: boolean;
} = {}) {
  const {
    withSearch = true,
    validArtwork = true,
    generationStatus = 200,
    validEvidence = true,
  } = options;

  return vi.fn(async (_url: string, init?: RequestInit) => {
    const outbound = JSON.parse(String(init?.body || "{}")) as {
      tools?: unknown;
      text?: { format?: { name?: string } };
    };
    if (outbound.tools) return inspirationInspectionResponse(withSearch);
    if (outbound.text?.format?.name === "artwork_identity") {
      return artworkIdentityResponse(validArtwork);
    }
    if (generationStatus !== 200) {
      return new Response("generation failed", { status: generationStatus });
    }
    return collaborativeStyleResponse(validEvidence);
  });
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

  it("normalises and validates optional public URLs", () => {
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
    ]) {
      expect(isValidInspirationUrl(value)).toBe(false);
      expect(isValidInspirationWebsiteUrl(value)).toBe(false);
    }
    expect(getInspirationDomain(INSPIRATION_URL)).toBe("example.com");
  });

  it("builds separate artwork identity, inspiration presentation and fusion requests", () => {
    const input = normaliseGenerateSiteStyleRequest({
      name: "Meme",
      ticker: "MEME",
      description: "A meme project with enough story to generate a website.",
      imageDataUrl: VALID_IMAGE,
      inspirationUrl: INSPIRATION_URL,
    });
    const artwork = buildArtworkIdentityRequestBody(input, "test-model");
    const inspiration = buildInspirationInspectionRequestBody(input, "test-model");
    const generation = buildFinalSiteStyleRequestBody(
      input,
      "test-model",
      INSPIRATION_BRIEF,
      ARTWORK_IDENTITY,
    ) as {
      tools?: unknown;
      input: Array<{ content: Array<{ text?: string }> }>;
      text: { format: { schema: { required: string[] } } };
    };

    expect(artwork.text.format.name).toBe("artwork_identity");
    expect(artwork.input[1].content[1]).toMatchObject({ type: "input_image", detail: "high" });
    expect(inspiration?.tools?.[0].filters.allowed_domains).toEqual(["example.com"]);
    expect(generation).not.toHaveProperty("tools");
    expect(generation.input[1].content[0].text).toContain(ARTWORK_IDENTITY.dominantColours);
    expect(generation.input[1].content[0].text).toContain(INSPIRATION_BRIEF);
    expect(generation.text.format.schema.required).toContain("fusionEvidence");
  });

  it("keeps uploaded content mandatory and rejects an invalid URL before OpenAI", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const missingArtwork = await POST(request({ inspirationUrl: INSPIRATION_URL }));
    expect(missingArtwork.status).toBe(400);
    expect((await missingArtwork.json()).error).toContain("artwork image is required");

    const invalidUrl = await POST(
      request({ imageDataUrl: VALID_IMAGE, inspirationUrl: "javascript:alert(1)" }),
    );
    expect(invalidUrl.status).toBe(400);
    expect((await invalidUrl.json()).error).toContain("valid public http or https");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects missing website inspection or incomplete artwork identity", async () => {
    const noSearch = collaborativeFetchMock({ withSearch: false });
    vi.stubGlobal("fetch", noSearch);
    const noSearchResponse = await POST(
      request({
        name: "Meme",
        ticker: "MEME",
        description: "A meme project with enough story to generate a website.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: INSPIRATION_URL,
      }),
    );
    expect(noSearchResponse.status).toBe(502);
    expect((await noSearchResponse.json()).error).toContain("was not inspected");
    expect(noSearch).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
    const badArtwork = collaborativeFetchMock({ validArtwork: false });
    vi.stubGlobal("fetch", badArtwork);
    const badArtworkResponse = await POST(
      request({
        name: "Meme",
        ticker: "MEME",
        description: "A meme project with enough story to generate a website.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: INSPIRATION_URL,
      }),
    );
    expect(badArtworkResponse.status).toBe(502);
    expect((await badArtworkResponse.json()).error).toContain("artwork identity");
    expect(badArtwork).toHaveBeenCalledTimes(2);
  });

  it("runs both analyses in parallel, then returns only a proven collaborative style", async () => {
    const fetchMock = collaborativeFetchMock();
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
    expect(responseBody.style).not.toHaveProperty("fusionEvidence");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body || "{}")));
    expect(bodies.some((body) => body.tools)).toBe(true);
    expect(bodies.some((body) => body.text?.format?.name === "artwork_identity")).toBe(true);
    const finalBody = bodies.find((body) => body.text?.format?.name === "artwork_site_style");
    expect(finalBody.input[1].content[0].text).toContain(ARTWORK_IDENTITY.copyVoice);
    expect(finalBody.input[1].content[0].text).toContain(INSPIRATION_BRIEF);
  });

  it("rejects final output that does not prove both briefs were used", async () => {
    const fetchMock = collaborativeFetchMock({ validEvidence: false });
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
    expect((await response.json()).error).toContain("did not prove collaboration");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports final collaborative generation failures without silently claiming success", async () => {
    const fetchMock = collaborativeFetchMock({ generationStatus: 500 });
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
    expect((await response.json()).error).toContain("collaborative website could not be generated");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps URL errors visible but preserves upload-only browser fallback", async () => {
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

    vi.unstubAllGlobals();
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

  it("wires the collaborative result into visible typography, hero, motion and copy", async () => {
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
  });
});
