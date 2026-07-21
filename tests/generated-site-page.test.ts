import { describe, expect, it } from "vitest";
import {
  ARTWORK_PLACEHOLDER,
  isCompleteGeneratedPageHtml,
  parseGeneratedPagePayload,
  prepareGeneratedPageForPreview,
  type GeneratedPageAcceptanceProfile,
} from "@/lib/generated-site-page";

function validHtml(extra = "") {
  const padding = "Original responsive campaign card content. ".repeat(110);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Original token page</title>
<style>
:root{--ink:#101820;--paper:#f7f9fb;--accent:#69b8d0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:var(--paper);color:var(--ink)}header{padding:24px}section{padding:72px 7vw}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}img{max-width:100%}@media(max-width:700px){.grid{grid-template-columns:1fr}section{padding:44px 20px}}
</style>
</head>
<body>
<header><nav>Home About Roadmap Community</nav></header>
<section id="hero"><h1>Move through the city differently</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Uploaded artwork"><button>Explore the journey</button></section>
<section id="about"><h2>About</h2><p>${padding}</p></section>
<section id="tokenomics"><h2>Tokenomics</h2><div class="grid"><article>Supply</article><article>Community</article><article>Launch</article></div></section>
<section id="roadmap"><h2>Roadmap</h2><div class="grid"><article>Start</article><article>Move</article><article>Grow</article></div></section>
<section id="how-to-buy"><h2>How to buy</h2><ol><li>Connect</li><li>Choose</li><li>Swap</li><li>Join</li></ol></section>
<section id="community"><h2>Community</h2><button>Join the conversation</button></section>
<script>document.querySelector('img').addEventListener('click',function(){document.body.classList.toggle('celebrate')});</script>
${extra}
</body>
</html>`;
}

function retailHtml(extra = "") {
  return validHtml(extra)
    .replace(
      "<header><nav>Home About Roadmap Community</nav></header>",
      '<header><nav>Discover Categories About Community</nav><form role="search"><input type="search" aria-label="Discover"></form></header>',
    )
    .replace('class="grid"', 'class="grid category-cards"')
    .replace('class="grid"', 'class="grid campaign-cards"');
}

const RETAIL_PROFILE: GeneratedPageAcceptanceProfile = {
  forbidTerminalAesthetic: true,
  requireRetailMarketplacePresentation: true,
};

describe("generated full website document", () => {
  it("accepts a complete original single-file page with every required section", () => {
    expect(isCompleteGeneratedPageHtml(validHtml())).toBe(true);
  });

  it("rejects the old fixed terminal template, unsafe embeds and incomplete pages", () => {
    expect(isCompleteGeneratedPageHtml(validHtml("<p>initiate_heist</p>"))).toBe(false);
    expect(isCompleteGeneratedPageHtml(validHtml("<iframe src='https://example.com'></iframe>"))).toBe(false);
    expect(isCompleteGeneratedPageHtml(validHtml().replace('id="community"', 'id="missing"'))).toBe(false);
    expect(isCompleteGeneratedPageHtml(validHtml().replace(ARTWORK_PLACEHOLDER, "image.png"))).toBe(false);
  });

  it("requires retail discovery structure and rejects terminal styling when the briefs demand it", () => {
    expect(isCompleteGeneratedPageHtml(retailHtml(), RETAIL_PROFILE)).toBe(true);
    expect(isCompleteGeneratedPageHtml(validHtml(), RETAIL_PROFILE)).toBe(false);
    expect(
      isCompleteGeneratedPageHtml(
        retailHtml("<p>root@token:~$ tokenomics.sh join the heist</p>"),
        RETAIL_PROFILE,
      ),
    ).toBe(false);
  });

  it("requires the exact artwork and inspiration evidence IDs", () => {
    const expected = { artworkBriefId: "art-1234abcd", inspirationBriefId: "url-8765dcba" };
    expect(
      parseGeneratedPagePayload(
        { html: validHtml(), ...expected },
        expected,
      ),
    ).toEqual({ html: validHtml(), ...expected });
    expect(
      parseGeneratedPagePayload(
        { html: validHtml(), ...expected, artworkBriefId: "art-deadbeef" },
        expected,
      ),
    ).toBeNull();
  });

  it("injects the uploaded artwork, a restrictive CSP and iframe resize bridge", () => {
    const prepared = prepareGeneratedPageForPreview(
      validHtml(),
      "data:image/webp;base64,aGVsbG8=",
    );
    expect(prepared).toContain("data:image/webp;base64,aGVsbG8=");
    expect(prepared).not.toContain(ARTWORK_PLACEHOLDER);
    expect(prepared).toContain("Content-Security-Policy");
    expect(prepared).toContain("hoodlums-generated-page-height");
    expect(prepared).toContain("connect-src 'none'");
  });
});
