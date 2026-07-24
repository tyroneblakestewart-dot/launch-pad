import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-page/route";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import { SITE_DESIGN_VARIANTS } from "@/lib/site-design-variants";
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
  "Use a spacious retail marketplace homepage structure with a utility header, prominent primary navigation, search-like product discovery, large seasonal campaign cards, repeated three- and four-card grids, category browsing and clear promotional calls to action. Keep the rhythm bright, friendly and easy to scan without copying the source brand.";

function html(variantId: string, index: number, extra = "") {
  const copy = "Original campaign content shaped by the uploaded journey artwork. ".repeat(105);
  const structures = [
    `<header><nav>Discover · Stories · Community</nav><form role="search"><input type="search" aria-label="Discover routes"></form></header><main><section id="hero"><div class="campaign-card"><h1>The city is the adventure</h1><figure><img src="${ARTWORK_PLACEHOLDER}" alt="Journey artwork"><figcaption>Find your route</figcaption></figure></div></section><section id="about"><article class="story-card"><h2>About</h2><p>${copy}</p></article><aside class="quote-card">Every route begins somewhere.</aside></section><section id="tokenomics"><dl class="metric-card"><div><dt>Supply</dt><dd>Community</dd></div></dl><article class="detail-card">Launch details</article></section><section id="roadmap"><ol class="roadmap-card"><li>Map it</li><li>Ride it</li><li>Share it</li></ol></section><section id="how-to-buy"><article class="steps-card">Connect · Choose · Swap · Ride</article></section><section id="community"><footer class="community-card">Join the journey</footer></section></main>`,
    `<header><nav>Scenes · Route · Join</nav><div role="search" class="discovery-card">Discover the next stop</div></header><main><section id="hero"><figure class="campaign-card"><img src="${ARTWORK_PLACEHOLDER}" alt="Journey artwork"><figcaption><h1>Move through the city</h1></figcaption></figure></section><section id="about"><div class="story-card"><h2>The journey</h2><p>${copy}</p></div></section><section id="tokenomics"><table class="metric-card"><tbody><tr><th>Supply</th><td>Shared</td></tr></tbody></table><article class="detail-card">Token route</article></section><section id="roadmap"><details class="roadmap-card" open><summary>Act one</summary><p>Find the line.</p></details><details class="phase-card"><summary>Act two</summary><p>Share the ride.</p></details></section><section id="how-to-buy"><ol class="steps-card"><li>Connect</li><li>Choose</li><li>Swap</li></ol></section><section id="community"><address class="community-card">Travel together</address></section></main>`,
    `<header><nav>Browse · Campaigns · Categories</nav><input class="search-card" type="search" aria-label="Discover campaigns"></header><main><section id="hero"><article class="campaign-card"><h1>Your route, remixed</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Journey artwork"></article><aside class="hero-card">Live journey</aside></section><section id="about"><div class="story-card"><h2>About</h2><p>${copy}</p></div><div class="voice-card">Community voice</div><div class="facts-card">Project facts</div></section><section id="tokenomics"><div class="metric-card">Supply</div><div class="detail-card">Chain</div><div class="token-card">Launch</div></section><section id="roadmap"><article class="roadmap-card">Stop one</article><article class="phase-card">Stop two</article><article class="future-card">Stop three</article></section><section id="how-to-buy"><div class="steps-card">1 · 2 · 3 · 4</div></section><section id="community"><article class="community-card">Join riders</article></section></main>`,
    `<header><nav>Discover · Cutouts · Crew</nav><form class="search-card" role="search"><input aria-label="Discover the collage"></form></header><main><section id="hero"><div class="campaign-card"><span>MOVE</span><img src="${ARTWORK_PLACEHOLDER}" alt="Journey artwork"><strong>TOGETHER</strong></div></section><section id="about"><figure class="story-card"><figcaption><h2>City energy</h2><p>${copy}</p></figcaption></figure><em class="quote-card">Pick a line.</em></section><section id="tokenomics"><ul class="metric-card"><li>Supply</li><li>Chain</li><li>Community</li></ul><mark class="detail-card">Live facts</mark></section><section id="roadmap"><div class="roadmap-card"><blockquote>First stop</blockquote><blockquote>Next stop</blockquote></div></section><section id="how-to-buy"><p class="steps-card">Connect, choose, swap, share.</p></section><section id="community"><nav class="community-card">Join the movement</nav></section></main>`,
    `<header><nav>Gallery · Index · Visit</nav><input class="search-card" type="search" aria-label="Discover the collection"></header><main><section id="hero"><figure class="campaign-card"><img src="${ARTWORK_PLACEHOLDER}" alt="Journey artwork"></figure><h1 class="title-card">A journey in five rooms</h1></section><section id="about"><p class="story-card">${copy}</p><small class="caption-card">Artwork-led exhibition note</small></section><section id="tokenomics"><table class="metric-card"><tbody><tr><td>Supply</td><td>Community</td></tr></tbody></table><div class="detail-card">Token details</div></section><section id="roadmap"><ol class="roadmap-card"><li>Room one</li><li>Room two</li><li>Room three</li></ol></section><section id="how-to-buy"><article class="steps-card">Acquire in four clear steps.</article></section><section id="community"><footer class="community-card">Visit the community</footer></section></main>`,
  ];
  const styles = [
    `*{box-sizing:border-box}body{margin:0;color:#15232d;display:grid;grid-template-columns:1fr}header,section{padding:48px 6vw}#about{display:grid;grid-template-columns:2fr 1fr;gap:3rem}.campaign-card{max-width:72rem;margin:auto}`,
    `*{box-sizing:border-box}body{margin:0;color:#15232d}#hero{min-height:100vh;position:relative;overflow:hidden}figure{display:flex;flex-direction:column}section{padding:9vh 7vw}.roadmap-card{min-height:14rem}`,
    `*{box-sizing:border-box}body{margin:0;color:#15232d}main{display:grid;gap:2rem;padding:2rem}#hero,#about,#tokenomics,#roadmap{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem}.campaign-card{grid-column:span 3}.story-card{grid-column:span 2}`,
    `*{box-sizing:border-box}body{margin:0;color:#15232d;overflow-x:hidden}section{padding:5rem 7vw}#hero{position:relative;min-height:80vh}#hero div{transform:rotate(-2deg)}#roadmap{clip-path:polygon(0 8%,100% 0,100% 92%,0 100%)}.quote-card{display:inline-block;transform:rotate(3deg)}`,
    `*{box-sizing:border-box}body{margin:0;color:#15232d;padding:4rem}main{max-width:72rem;margin:auto}section{display:flex;flex-direction:column;gap:5rem;padding:7rem 0}figure{aspect-ratio:4/3}header{display:flex;justify-content:space-between}`,
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Journey token</title><style>${styles[index]}@media(max-width:700px){main,section{display:block;padding:24px}}</style></head><body data-design-variant="${variantId}">${structures[index]}${extra}<script>document.querySelector('img').onclick=function(){document.body.classList.toggle('celebrate')}</script></body></html>`;
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

function addVariantResponses(
  fetchMock: ReturnType<typeof vi.fn>,
  ids: ReturnType<typeof getFusionBriefIds>,
  mutate?: (payload: { html: string; artworkBriefId: string; inspirationBriefId: string; variantId: string }, index: number) => unknown,
) {
  SITE_DESIGN_VARIANTS.forEach((variant, index) => {
    const payload = {
      html: html(variant.id, index),
      ...ids,
      variantId: variant.id,
    };
    fetchMock.mockResolvedValueOnce(outputText(mutate ? mutate(payload, index) : payload));
  });
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

  it("analyses artwork and URL once, then returns five complete original pages", async () => {
    const ids = getFusionBriefIds(ARTWORK, INSPIRATION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse());
    addVariantResponses(fetchMock, ids);
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
    expect(body.source).toBe("openai");
    expect(body.inspirationUsed).toBe(true);
    expect(body.variants).toHaveLength(5);
    expect(body.variants.map((item: { id: string }) => item.id)).toEqual(
      SITE_DESIGN_VARIANTS.map((item) => item.id),
    );
    expect(body.variants[0].html).toContain('data-design-variant="editorial-poster"');
    expect(fetchMock).toHaveBeenCalledTimes(7);

    const artworkRequest = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
      text: { format: { schema: unknown } };
    };
    const finalRequest = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body)) as {
      max_output_tokens: number;
      input: Array<{ content: Array<{ type: string; text?: string; image_url?: string }> }>;
      text: { format: { schema: unknown } };
    };
    expect(finalRequest.max_output_tokens).toBe(10_000);
    expect(finalRequest.input[0].content[0].text).toContain("Artwork owns the page identity");
    expect(finalRequest.input[0].content[0].text).toContain("Editorial Poster");
    expect(finalRequest.input[0].content[0].text).toContain("colour-swap-only");
    expect(finalRequest.input[1].content[0].text).toContain(INSPIRATION);
    expect(finalRequest.input[1].content[1]).toMatchObject({
      type: "input_image",
      image_url: VALID_IMAGE,
      detail: "high",
    });
    expect(JSON.stringify(artworkRequest.text.format.schema)).not.toMatch(/minLength|maxLength|pattern/);
    expect(JSON.stringify(finalRequest.text.format.schema)).not.toMatch(/minLength|maxLength|pattern/);
    expect(JSON.stringify(finalRequest)).not.toContain("initiate_heist");
  });

  it("rejects all five when one retail-inspired result falls back to terminal and heist styling", async () => {
    const ids = getFusionBriefIds(ARTWORK, INSPIRATION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse());
    addVariantResponses(fetchMock, ids, (payload, index) =>
      index === 0
        ? { ...payload, html: html(payload.variantId, index, "<p>root@token:~$ tokenomics.sh join the heist</p>") }
        : payload,
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ imageDataUrl: VALID_IMAGE, inspirationUrl: URL }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("Editorial Poster failed");
  });

  it("rejects all five when one page echoes the wrong collaboration evidence", async () => {
    const ids = getFusionBriefIds(ARTWORK, INSPIRATION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse());
    addVariantResponses(fetchMock, ids, (payload, index) =>
      index === 0
        ? { ...payload, artworkBriefId: "art-deadbeef", inspirationBriefId: "url-deadbeef" }
        : payload,
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ imageDataUrl: VALID_IMAGE, inspirationUrl: URL }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("Editorial Poster failed");
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
  it("uses the full page endpoint and never presents a fixed fallback as a finished result", async () => {
    const page = await readFile(path.join(ROOT, "app", "page.tsx"), "utf8");
    const generator = await readFile(
      path.join(ROOT, "components", "full-website-generator.tsx"),
      "utf8",
    );
    const selector = await readFile(
      path.join(ROOT, "components", "generated-site-variant-selector.tsx"),
      "utf8",
    );
    const bridge = await readFile(
      path.join(ROOT, "components", "generate-site-style-auth-bridge.tsx"),
      "utf8",
    );

    expect(page).toContain("FullWebsiteGenerator");
    expect(page).not.toContain("ArtworkSiteGenerator");
    expect(generator).toContain('fetch("/api/generate-site-page"');
    expect(generator).toContain('sandbox="allow-scripts"');
    expect(generator).toContain("srcDoc={selectedHtml}");
    expect(generator).toContain("GeneratedSiteVariantSelector");
    expect(selector).toContain('sandbox=""');
    expect(generator).toContain("hoodlums-generated-page-height");
    expect(generator).toContain("full-page-generating");
    expect(generator).toContain("full-page-failed");
    expect(generator).toContain("No stale design has been accepted");
    expect(generator).toContain("previewAvailable: false");
    expect(bridge).toContain('"/api/generate-site-page"');
  });
});
