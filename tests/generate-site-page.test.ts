import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-page/route";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import {
  getFusionBriefIds,
  type ArtworkIdentity,
} from "@/lib/site-style-openai-pipeline";

const ROOT = process.cwd();
const VALID_IMAGE = "data:image/png;base64,aGVsbG8=";
const URL = "https://example.com/inspiration";
const ARTWORK: ArtworkIdentity = {
  dominantColours: "Powder blue, charcoal black, steel grey, white and restrained transit red accents.",
  memeEnergy: "Curious London journey energy with a playful child-led sense of movement and discovery.",
  subjectAndIcons: "A child studying a Tube map while standing on a scooter, with route lines, station glass and transport details.",
  visibleText: "Tube map and small London transport labels are visible but should not become the project name.",
  typographyPersonality: "Friendly rounded transport signage with clear bold headings rather than cyber or military display type.",
  copyVoice: "Warm, adventurous, direct and optimistic, written like a city journey shared with a community.",
  nonNegotiables: "Keep the child, scooter and route-map story central; do not convert the image into hacker, heist or terminal imagery.",
};
const INSPIRATION =
  "Use a spacious commercial homepage structure with a utility header, prominent primary navigation, search-like discovery, large seasonal campaign cards, repeated three- and four-card grids, category browsing and clear promotional calls to action. Keep the rhythm bright, friendly and easy to scan without copying the source brand.";

function html() {
  const copy = "Original campaign content shaped by the uploaded journey artwork. ".repeat(105);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Journey token</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial;background:#f6fbfd;color:#15232d}header,section{padding:48px 6vw}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}@media(max-width:700px){.cards{grid-template-columns:1fr}}</style></head><body><header><nav>Discover About Roadmap Community</nav></header><section id="hero"><h1>The city is the adventure</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Journey artwork"><button>Start exploring</button></section><section id="about"><h2>About the journey</h2><p>${copy}</p></section><section id="tokenomics"><h2>Token details</h2><div class="cards"><article>Supply</article><article>Community</article><article>Launch</article></div></section><section id="roadmap"><h2>Next stops</h2><div class="cards"><article>Map it</article><article>Ride it</article><article>Share it</article></div></section><section id="how-to-buy"><h2>How to join</h2><ol><li>Connect</li><li>Choose</li><li>Swap</li><li>Ride</li></ol></section><section id="community"><h2>Travel together</h2><button>Join community</button></section><script>document.querySelector('img').onclick=function(){document.body.classList.toggle('celebrate')}</script></body></html>`;
}

function request(body: unknown) {
  return new Request("http://localhost/api/generate-site-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function outputText(value: unknown) {
  return new Response(
    JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function inspirationResponse() {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "web_search_call",
          status: "completed",
          action: { sources: [{ type: "url", url: URL }] },
        },
        { type: "message", content: [{ type: "output_text", text: INSPIRATION }] },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("POST /api/generate-site-page", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("analyses artwork and URL separately, then returns a complete original page", async () => {
    const ids = getFusionBriefIds(ARTWORK, INSPIRATION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse())
      .mockResolvedValueOnce(outputText({ html: html(), ...ids }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({
        name: "Journey",
        ticker: "RIDE",
        description: "A community token inspired by finding your route through London.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: URL,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ html: html(), source: "openai", inspirationUsed: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const finalRequest = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body)) as {
      max_output_tokens: number;
      input: Array<{ content: Array<{ type: string; text?: string; image_url?: string }> }>;
    };
    expect(finalRequest.max_output_tokens).toBe(12_000);
    expect(finalRequest.input[1].content[0].text).toContain("Artwork owns the page identity");
    expect(finalRequest.input[1].content[0].text).toContain(INSPIRATION);
    expect(finalRequest.input[1].content[1]).toMatchObject({
      type: "input_image",
      image_url: VALID_IMAGE,
      detail: "high",
    });
    expect(JSON.stringify(finalRequest)).not.toContain("initiate_heist");
  });

  it("rejects a full page that echoes the wrong collaboration evidence", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse())
      .mockResolvedValueOnce(
        outputText({
          html: html(),
          artworkBriefId: "art-deadbeef",
          inspirationBriefId: "url-deadbeef",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({ imageDataUrl: VALID_IMAGE, inspirationUrl: URL }),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("incomplete, unsafe, or did not prove");
  });

  it("keeps uploaded artwork mandatory", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ inspirationUrl: URL }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("full website frontend wiring", () => {
  it("uses the full page endpoint and sandboxed srcdoc renderer instead of the fixed style component", async () => {
    const page = await readFile(path.join(ROOT, "app", "page.tsx"), "utf8");
    const generator = await readFile(
      path.join(ROOT, "components", "full-website-generator.tsx"),
      "utf8",
    );
    const bridge = await readFile(
      path.join(ROOT, "components", "generate-site-style-auth-bridge.tsx"),
      "utf8",
    );

    expect(page).toContain("FullWebsiteGenerator");
    expect(page).not.toContain("ArtworkSiteGenerator");
    expect(generator).toContain('fetch("/api/generate-site-page"');
    expect(generator).toContain('frame.setAttribute("sandbox", "allow-scripts")');
    expect(generator).toContain("frame.srcdoc = prepared");
    expect(generator).toContain("hoodlums-generated-page-height");
    expect(bridge).toContain('"/api/generate-site-page"');
  });
});
