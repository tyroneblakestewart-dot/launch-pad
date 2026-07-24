import { describe, expect, it } from "vitest";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import {
  haveDistinctVariantLayouts,
  layoutSimilarity,
  parseGeneratedSiteVariants,
} from "@/lib/generated-site-variants";
import {
  SITE_DESIGN_VARIANT_COUNT,
  SITE_DESIGN_VARIANTS,
} from "@/lib/site-design-variants";
import {
  buildGeneratedSitePageRequestBody,
  parseGeneratedSitePageResponse,
} from "@/lib/site-page-openai-pipeline";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";

const request = {
  name: "Hoodlums",
  ticker: "HOOD",
  description: "A crew-led token project with a distinct visual story.",
  imageDataUrl: "data:image/png;base64,AAAA",
  inspirationUrl: "",
};

const artworkIdentity = {
  dominantColours: "forest green, gold, black, cream",
  memeEnergy: "bold community poster energy",
  subjectAndIcons: "hooded crew and arrow marks",
  visibleText: "HOODLUMS",
  typographyPersonality: "heavy editorial display",
  copyVoice: "confident and communal",
  nonNegotiables: "preserve the crew and gold wordmark",
};

const ids = {
  artworkBriefId: "artwork-brief",
  inspirationBriefId: "inspiration-brief",
};

function validHtml(id: string, layout: number, colour = "#224422"): string {
  const filler = "Original artwork-led token storytelling with useful community information. ".repeat(85);
  const structures = [
    `<header><nav>Index</nav></header><main><section id="hero"><div><h1>Hero</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Artwork"></div></section><section id="about"><article>${filler}</article><aside>Quote</aside></section><section id="tokenomics"><dl><div>Supply</div></dl></section><section id="roadmap"><ol><li>One</li><li>Two</li></ol></section><section id="how-to-buy"><div>Steps</div></section><section id="community"><footer>Join</footer></section></main>`,
    `<header><nav>Scenes</nav></header><main><section id="hero"><figure><img src="${ARTWORK_PLACEHOLDER}" alt="Artwork"><figcaption>Hero</figcaption></figure></section><section id="about"><div><h2>Story</h2><p>${filler}</p></div></section><section id="tokenomics"><article>Supply</article><article>Chain</article></section><section id="roadmap"><div><section>Act one</section><section>Act two</section></div></section><section id="how-to-buy"><ol><li>Connect</li></ol></section><section id="community"><div>Community</div></section></main>`,
    `<header><nav>Modules</nav></header><main><section id="hero"><article><img src="${ARTWORK_PLACEHOLDER}" alt="Artwork"></article><aside>Launch</aside></section><section id="about"><div>${filler}</div><div>Facts</div><div>Voice</div></section><section id="tokenomics"><div>Supply</div><div>Tax</div><div>Chain</div></section><section id="roadmap"><article>Phase A</article><article>Phase B</article><article>Phase C</article></section><section id="how-to-buy"><div>1</div><div>2</div><div>3</div></section><section id="community"><article>Links</article></section></main>`,
    `<header><nav>Collage</nav></header><main><section id="hero"><div><span>Cutout</span><img src="${ARTWORK_PLACEHOLDER}" alt="Artwork"><strong>Move</strong></div></section><section id="about"><figure><figcaption>${filler}</figcaption></figure></section><section id="tokenomics"><ul><li>Supply</li><li>Chain</li></ul></section><section id="roadmap"><div><blockquote>First</blockquote><blockquote>Second</blockquote></div></section><section id="how-to-buy"><p>Steps</p></section><section id="community"><nav>Join</nav></section></main>`,
    `<header><nav>Gallery</nav></header><main><section id="hero"><figure><img src="${ARTWORK_PLACEHOLDER}" alt="Artwork"></figure><h1>Exhibition</h1></section><section id="about"><p>${filler}</p></section><section id="tokenomics"><table><tbody><tr><td>Supply</td></tr></tbody></table></section><section id="roadmap"><ol><li>Room one</li><li>Room two</li></ol></section><section id="how-to-buy"><article>Acquire</article></section><section id="community"><footer>Visit</footer></section></main>`,
  ];
  const css = [
    `body{color:${colour};display:grid;grid-template-columns:1fr}#about{display:grid;grid-template-columns:2fr 1fr;gap:3rem}`,
    `body{color:${colour};margin:0}#hero{min-height:100vh;position:relative;overflow:hidden}figure{display:flex;flex-direction:column}`,
    `body{color:${colour}}main{display:grid;gap:2rem}#hero,#about,#tokenomics{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem}`,
    `body{color:${colour};overflow-x:hidden}#hero{position:relative;min-height:80vh}#hero div{transform:rotate(-2deg)}#roadmap{clip-path:polygon(0 8%,100% 0,100% 92%,0 100%)}`,
    `body{color:${colour};padding:4rem}main{max-width:72rem;margin:auto}section{display:flex;flex-direction:column;gap:5rem}figure{aspect-ratio:4/3}`,
  ][layout];
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body data-design-variant="${id}">${structures[layout]}<script>document.body.dataset.ready='true';</script></body></html>`;
}

function responseFor(html: string, variantId: string): OpenAIResponse {
  return {
    output: [
      {
        type: "message",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ html, ...ids, variantId }),
          },
        ],
      },
    ],
  };
}

describe("site design variant descriptors", () => {
  it("defines exactly five unique, structurally distinct directions", () => {
    expect(SITE_DESIGN_VARIANTS).toHaveLength(SITE_DESIGN_VARIANT_COUNT);
    expect(new Set(SITE_DESIGN_VARIANTS.map((item) => item.id)).size).toBe(5);
    expect(new Set(SITE_DESIGN_VARIANTS.map((item) => item.label)).size).toBe(5);
    for (const variant of SITE_DESIGN_VARIANTS) {
      expect(variant.direction.length).toBeGreaterThan(80);
    }
  });

  it("puts the requested direction, marker and anti-colour-swap rule in the OpenAI prompt", () => {
    const variant = SITE_DESIGN_VARIANTS[3];
    const body = buildGeneratedSitePageRequestBody(request, "test-model", artworkIdentity, undefined, variant);
    const developerText = body.input[0].content[0].text;
    expect(developerText).toContain(variant.id);
    expect(developerText).toContain(variant.label);
    expect(developerText).toContain(variant.direction);
    expect(developerText).toContain(`data-design-variant=\"${variant.id}\"`);
    expect(developerText).toContain("colour-swap-only");
    expect(body.text.format.schema.required).toContain("variantId");
  });
});

describe("variant response validation", () => {
  it("accepts the expected variant ID and document marker", () => {
    const variant = SITE_DESIGN_VARIANTS[0];
    const page = parseGeneratedSitePageResponse(
      responseFor(validHtml(variant.id, 0), variant.id),
      ids,
      {},
      variant,
    );
    expect(page?.html).toContain(`data-design-variant="${variant.id}"`);
  });

  it("rejects a wrong echoed ID or missing marker", () => {
    const variant = SITE_DESIGN_VARIANTS[0];
    expect(
      parseGeneratedSitePageResponse(
        responseFor(validHtml(variant.id, 0), "wrong-id"),
        ids,
        {},
        variant,
      ),
    ).toBeNull();
    expect(
      parseGeneratedSitePageResponse(
        responseFor(validHtml("wrong-id", 0), variant.id),
        ids,
        {},
        variant,
      ),
    ).toBeNull();
  });

  it("parses exactly five variants in stable descriptor order", () => {
    const value = SITE_DESIGN_VARIANTS.map((variant, index) => ({
      id: variant.id,
      label: variant.label,
      description: variant.description,
      html: validHtml(variant.id, index),
    }));
    expect(parseGeneratedSiteVariants(value)?.map((item) => item.id)).toEqual(
      SITE_DESIGN_VARIANTS.map((item) => item.id),
    );
    expect(parseGeneratedSiteVariants(value.slice(0, 4))).toBeNull();
    expect(parseGeneratedSiteVariants([...value, value[0]])).toBeNull();
  });
});

describe("layout diversity guard", () => {
  it("rejects duplicates and colour-only differences", () => {
    const first = validHtml("one", 0, "#112233");
    const duplicate = first;
    const colourSwap = validHtml("two", 0, "#ffee00");
    expect(layoutSimilarity(first, duplicate)).toBe(1);
    expect(layoutSimilarity(first, colourSwap)).toBeGreaterThanOrEqual(0.94);
    expect(haveDistinctVariantLayouts([{ id: "one", html: first }, { id: "two", html: colourSwap }])).toBe(false);
  });

  it("accepts structurally different layouts", () => {
    const variants = SITE_DESIGN_VARIANTS.map((variant, index) => ({
      id: variant.id,
      html: validHtml(variant.id, index),
    }));
    expect(haveDistinctVariantLayouts(variants)).toBe(true);
  });
});
