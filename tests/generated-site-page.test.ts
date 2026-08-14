import { describe, expect, it } from "vitest";
import {
  ARTWORK_PLACEHOLDER,
  CHART_EMBED_PLACEHOLDER,
  describeGeneratedPageRejection,
  isCompleteGeneratedPageHtml,
  isGeneratedPageRejectedForLayoutOnly,
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

function withStyle(extra: string, css: string): string {
  return validHtml(extra).replace(/<style>[\s\S]*?<\/style>/, `<style>${css}</style>`);
}

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

  it("rejects <object> and <embed> even when a valid Dexscreener iframe is also present", () => {
    expect(
      isCompleteGeneratedPageHtml(validHtml('<object data="https://example.com"></object>')),
    ).toBe(false);
    expect(
      isCompleteGeneratedPageHtml(validHtml('<embed src="https://example.com">')),
    ).toBe(false);
    expect(
      isCompleteGeneratedPageHtml(
        validHtml(`<iframe src="https://dexscreener.com/robinhood/pair-1?embed=1"></iframe><object data="https://example.com"></object>`),
      ),
    ).toBe(false);
  });

  it("accepts an iframe whose src is the https://dexscreener.com/ origin", () => {
    expect(
      isCompleteGeneratedPageHtml(
        validHtml(`<iframe src="https://dexscreener.com/robinhood/pair-1?embed=1&theme=dark"></iframe>`),
      ),
    ).toBe(true);
  });

  it("rejects an iframe pointing anywhere other than https://dexscreener.com/", () => {
    expect(
      isCompleteGeneratedPageHtml(validHtml('<iframe src="https://dexscreener.com.evil.example/x"></iframe>')),
    ).toBe(false);
    expect(isCompleteGeneratedPageHtml(validHtml("<iframe></iframe>"))).toBe(false);
    expect(isCompleteGeneratedPageHtml(validHtml('<iframe src=""></iframe>'))).toBe(false);
  });

  it("accepts the unresolved free-site chart embed placeholder as an iframe src", () => {
    expect(
      isCompleteGeneratedPageHtml(validHtml(`<iframe src="${CHART_EMBED_PLACEHOLDER}"></iframe>`)),
    ).toBe(true);
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

  it("scopes frame-src to exactly the Dexscreener origin and leaves every other directive untouched", () => {
    const prepared = prepareGeneratedPageForPreview(
      validHtml(),
      "data:image/webp;base64,aGVsbG8=",
    );
    const cspMatch = prepared.match(/content="([^"]*)"/);
    expect(cspMatch).not.toBeNull();
    const csp = cspMatch![1];

    expect(csp).toContain("frame-src https://dexscreener.com");
    expect((csp.match(/frame-src/g) || [])).toHaveLength(1);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("img-src data:");
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("connect-src 'none'");
  });

  // Issue #323 part 1: a code-enforced overflow clamp injected into every
  // prepared page — the served /[slug] route and the studio preview both
  // call prepareGeneratedPageForPreview, so this one injection point covers
  // both surfaces — regardless of what the generated markup itself does.
  it("injects a code-enforced overflow clamp that no generated markup can remove", () => {
    const prepared = prepareGeneratedPageForPreview(
      validHtml(),
      "data:image/webp;base64,aGVsbG8=",
    );
    expect(prepared).toContain("html,body{max-width:100%;overflow-x:hidden}");
    expect(prepared).toContain("img,video,table,pre{max-width:100%}");
  });

  it("debounces the height-report bridge to once per animation frame instead of once per DOM mutation", () => {
    const prepared = prepareGeneratedPageForPreview(
      validHtml(),
      "data:image/webp;base64,aGVsbG8=",
    );
    expect(prepared).toContain("requestAnimationFrame(function(){scheduled=null;send()})");
    expect(prepared).toContain("new MutationObserver(scheduleSend)");
  });

  // Layer 2 of the desktop/mobile responsiveness contract (issue #303): a
  // generated page that has made no attempt at responsive CSS, or that
  // hardcodes a desktop-only wide container outside any breakpoint, should
  // never pass publish validation.
  describe("responsive baseline", () => {
    it("rejects a page with zero media queries and zero responsive units", () => {
      const flat = withStyle(
        "",
        ":root{--ink:#101820;--paper:#f7f9fb}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:var(--paper);color:var(--ink)}header{padding:24px}section{padding:72px 40px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}img{max-width:100%}",
      );
      expect(isCompleteGeneratedPageHtml(flat)).toBe(false);
    });

    it("accepts a page whose only responsive signal is a fluid unit like clamp(), with no @media at all", () => {
      // The grid here uses repeat(auto-fit, ...), not a fixed track count —
      // auto-fit is inherently responsive, so this fixture stays focused on
      // proving clamp() alone satisfies the baseline, not on the unstacked
      // multi-column-grid check covered separately below.
      const fluidOnly = withStyle(
        "",
        ":root{--ink:#101820;--paper:#f7f9fb}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:var(--paper);color:var(--ink)}header{padding:24px}section{padding:72px 40px}h1{font-size:clamp(28px,6vw,64px)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:20px}img{max-width:100%}",
      );
      expect(isCompleteGeneratedPageHtml(fluidOnly)).toBe(true);
    });

    it("rejects a fixed wide pixel container outside any media query, even alongside real responsive markers", () => {
      const overflowRisk = validHtml().replace("img{max-width:100%}", "img{max-width:100%}.wrapper{width:1900px}");
      expect(isCompleteGeneratedPageHtml(overflowRisk)).toBe(false);
    });

    it("does not confuse a min-width/max-width media query threshold with a fixed-width container", () => {
      // validHtml()'s only breakpoint is @media(max-width:700px) — the
      // "700px" here is a query threshold, not a container width, and must
      // not be flagged as an overflow risk.
      expect(isCompleteGeneratedPageHtml(validHtml())).toBe(true);
    });

    it("does not flag a wide fixed width that only applies inside a desktop min-width breakpoint", () => {
      const desktopOnlyWidth = validHtml().replace(
        "@media(max-width:700px){.grid{grid-template-columns:1fr}section{padding:44px 20px}}",
        "@media(max-width:700px){.grid{grid-template-columns:1fr}section{padding:44px 20px}}@media(min-width:1280px){.wrapper{width:1900px}}",
      );
      expect(isCompleteGeneratedPageHtml(desktopOnlyWidth)).toBe(true);
    });

    // Desktop-squish detection (issue #323 part 1): an always-active
    // multi-column grid with no breakpoint that ever stacks it is the exact
    // "desktop layout squished onto the phone" bug the owner reported.
    describe("desktop-squish (unstacked multi-column grid)", () => {
      it("rejects an always-active 3-column grid with no media query at all", () => {
        const squished = withStyle(
          "",
          ":root{--ink:#101820;--paper:#f7f9fb}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:var(--paper);color:var(--ink)}header{padding:24px}section{padding:72px 40px}h1{font-size:clamp(28px,6vw,64px)}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}img{max-width:100%}",
        );
        expect(isCompleteGeneratedPageHtml(squished)).toBe(false);
        expect(isGeneratedPageRejectedForLayoutOnly(squished)).toBe(true);
      });

      it("rejects an always-active 3-column grid even when a media query exists but never touches grid-template-columns", () => {
        const squished = validHtml().replace(
          "@media(max-width:700px){.grid{grid-template-columns:1fr}section{padding:44px 20px}}",
          "@media(max-width:700px){section{padding:44px 20px}}",
        );
        expect(isCompleteGeneratedPageHtml(squished)).toBe(false);
      });

      it("accepts validHtml() unchanged, whose @media(max-width:700px) block does stack the grid", () => {
        expect(isCompleteGeneratedPageHtml(validHtml())).toBe(true);
      });

      it("does not flag an always-active two-column grid — a common, legitimate mobile-safe pattern", () => {
        const twoUp = withStyle(
          "",
          ":root{--ink:#101820;--paper:#f7f9fb}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:var(--paper);color:var(--ink)}header{padding:24px}section{padding:72px 40px}h1{font-size:clamp(28px,6vw,64px)}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}img{max-width:100%}",
        );
        expect(isCompleteGeneratedPageHtml(twoUp)).toBe(true);
      });

      it("does not flag repeat(auto-fit, ...) or repeat(auto-fill, ...) — those are inherently responsive", () => {
        const autoFit = withStyle(
          "",
          ":root{--ink:#101820;--paper:#f7f9fb}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:var(--paper);color:var(--ink)}header{padding:24px}section{padding:72px 40px}h1{font-size:clamp(28px,6vw,64px)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px}img{max-width:100%}",
        );
        expect(isCompleteGeneratedPageHtml(autoFit)).toBe(true);
      });
    });
  });

  describe("rejection reasons and the one-retry-on-layout signal (issue #323)", () => {
    it("reports 'layout' only when the page is otherwise complete and safe", () => {
      const evidence = { artworkBriefId: "art-1234abcd", inspirationBriefId: "url-8765dcba" };
      const squished = withStyle(
        "",
        ":root{--ink:#101820;--paper:#f7f9fb}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:var(--paper);color:var(--ink)}header{padding:24px}section{padding:72px 40px}h1{font-size:clamp(28px,6vw,64px)}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}img{max-width:100%}",
      );

      expect(
        describeGeneratedPageRejection({ html: squished, ...evidence }, evidence),
      ).toBe("layout");
      expect(
        describeGeneratedPageRejection({ html: validHtml(), ...evidence }, evidence),
      ).toBe("ok");
    });

    it("reports 'other', not 'layout', for an unrelated rejection reason a layout retry would never fix", () => {
      const evidence = { artworkBriefId: "art-1234abcd", inspirationBriefId: "url-8765dcba" };

      expect(
        describeGeneratedPageRejection(
          { html: validHtml().replace('id="community"', 'id="missing"'), ...evidence },
          evidence,
        ),
      ).toBe("other");
      expect(
        describeGeneratedPageRejection(
          { html: validHtml(), artworkBriefId: "wrong", inspirationBriefId: evidence.inspirationBriefId },
          evidence,
        ),
      ).toBe("other");
    });
  });
});
