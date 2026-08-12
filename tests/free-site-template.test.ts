import { describe, expect, it } from "vitest";
import {
  ARTWORK_PLACEHOLDER,
  CHART_EMBED_PLACEHOLDER,
  REQUIRED_PAGE_SECTIONS,
  isCompleteGeneratedPageHtml,
} from "@/lib/generated-site-page";
import {
  FREE_SITE_SECTION_DEFAULTS,
  renderFreeSiteTemplate,
  type FreeSiteAboutStyle,
  type FreeSiteBackgroundEffect,
  type FreeSiteCopy,
  type FreeSiteFacts,
  type FreeSiteFontPairing,
  type FreeSiteHeroStyle,
  type FreeSiteRoadmapStyle,
  type FreeSiteSections,
  type FreeSiteTheme,
  type FreeSiteTokenomicsStyle,
} from "@/lib/free-site-template";

// Every existing test in this file predates the optional-section toggles
// and asserts against copy that fills every section, so it renders with
// every optional section enabled unless a test overrides `sections`.
const ALL_SECTIONS: FreeSiteSections = {
  about: true,
  tokenomics: true,
  roadmap: true,
  howToBuy: true,
  faq: true,
};

const THEME: FreeSiteTheme = {
  palette: {
    background: "#06110a",
    surface: "#0f1f14",
    primary: "#7cff5b",
    secondary: "#f5c945",
    text: "#e8ffe0",
  },
  fontPairing: "street",
  backgroundEffect: "cascade",
  heroStyle: "split",
  tokenomicsStyle: "terminal",
  roadmapStyle: "timeline",
  aboutStyle: "numbered",
};

const COPY: FreeSiteCopy = {
  tokenName: "Hoodlums",
  ticker: "HOOD",
  kicker: "The community takes the crown",
  tagline: "A community-first token built for the next chapter of New Sherwood.",
  aboutTitle: "A token with a mission",
  about1Title: "Community first",
  about1Body: "Every step is built around the people holding the line.",
  about2Title: "Transparent launch",
  about2Body: "The contract and launch details stay clear for everyone.",
  about3Title: "Built to last",
  about3Body: "The roadmap focuses on steady community-led growth.",
  tokenomicsTitle: "Simple tokenomics",
  roadmapTitle: "The road ahead",
  roadmap1Phase: "Phase 01",
  roadmap1Title: "Launch",
  roadmap1Body: "Open the gates and bring the first supporters together.",
  roadmap2Phase: "Phase 02",
  roadmap2Title: "Build",
  roadmap2Body: "Expand the story, tools and community presence.",
  roadmap3Phase: "Phase 03",
  roadmap3Title: "Grow",
  roadmap3Body: "Reach new holders through transparent community campaigns.",
  roadmap4Phase: "Phase 04",
  roadmap4Title: "Lead",
  roadmap4Body: "Let the community shape the next chapter.",
  howToBuyTitle: "Join the community",
  howToBuy1Title: "Create a wallet",
  howToBuy1Body: "Set up a compatible wallet and protect the recovery phrase.",
  howToBuy2Title: "Fund it",
  howToBuy2Body: "Add the network token needed for the purchase and gas.",
  howToBuy3Title: "Connect",
  howToBuy3Body: "Open the approved exchange and connect the selected wallet.",
  howToBuy4Title: "Swap",
  howToBuy4Body: "Confirm the token address and complete the swap in the wallet.",
  communityTitle: "Find the crew",
  faqTitle: "Questions answered",
  faq1Q: "What is Hoodlums?",
  faq1A: "A community-led meme token project with a New Sherwood story.",
  faq2Q: "Where is the contract?",
  faq2A: "The verified contract address appears at the top and bottom of the page.",
  faq3Q: "Is liquidity locked?",
  faq3A: "The current liquidity status is shown in the tokenomics section.",
  faq4Q: "Where are announcements posted?",
  faq4A: "Official updates are shared through the listed community channels.",
  faq5Q: "Is this financial advice?",
  faq5A: "No. Always research independently before making a decision.",
};

const FACTS: FreeSiteFacts = {
  supply: "1,000,000,000",
  decimals: 18,
  buyTax: "0%",
  sellTax: "0%",
  mintAuthority: "None",
  ownership: "No owner",
  xHandle: "hoodlumsdev",
  telegram: "hoodlumsdev",
};

function render(
  theme: FreeSiteTheme = THEME,
  copy: FreeSiteCopy = COPY,
  facts: FreeSiteFacts = FACTS,
  sections: FreeSiteSections = ALL_SECTIONS,
): string {
  return renderFreeSiteTemplate({ theme, copy, facts, sections });
}

function getBodyTag(html: string): string {
  const headEnd = html.toLowerCase().indexOf("</head>");
  if (headEnd === -1) throw new Error("Rendered page has no closing head tag.");
  const match = html.slice(headEnd + "</head>".length).match(/<body\b[^>]*>/i);
  if (!match) throw new Error("Rendered page has no body tag.");
  return match[0];
}

// Scoped to the actual navigation, unlike a whole-page href search: the
// hero's "Buy {{TICKER}}" CTA always links to #how-to-buy whenever a
// contract address is supplied (see BUY_CTA/hasContract), independently of
// whether the how-to-buy section itself is enabled — same as "Learn More"
// always linking to #about. Only the header nav and footer links list are
// expected to drop a link when its section is disabled.
function getHeaderNavLinks(html: string): string {
  const match = html.match(/<nav class="nav-links">([\s\S]*?)<\/nav>/);
  if (!match) throw new Error("Rendered page has no header nav-links block.");
  return match[1];
}

function getFooterLinks(html: string): string {
  const match = html.match(/<div class="eyebrow" style="margin-bottom:10px">Links<\/div>([\s\S]*?)<\/div>\s*<div class="foot-socials">/);
  if (!match) throw new Error("Rendered page has no footer links block.");
  return match[1];
}

describe("renderFreeSiteTemplate", () => {
  it("passes generated-page validation with realistic copy", () => {
    const html = render();
    expect(isCompleteGeneratedPageHtml(html)).toBe(true);
    expect(isCompleteGeneratedPageHtml(html, { forbidTerminalAesthetic: true })).toBe(true);
  });

  it("applies the theme and retains the required document structure", () => {
    const html = render();
    expect(html).toContain("--background: #06110a;");
    expect(html).toContain("--surface: #0f1f14;");
    expect(html).toContain("--primary: #7cff5b;");
    expect(html).toContain("--secondary: #f5c945;");
    expect(html).toContain("--text: #e8ffe0;");
    expect(html).toContain('data-fonts="street"');
    expect(html).toContain('data-bg="cascade"');
    expect(html).toContain('data-hero="split"');
    expect(html).toContain('data-tokenomics="terminal"');
    expect(html).toContain('data-roadmap="timeline"');
    expect(html).toContain('data-about="numbered"');

    expect(html.split(ARTWORK_PLACEHOLDER)).toHaveLength(2);
    for (const section of REQUIRED_PAGE_SECTIONS) {
      expect(html).toContain(`id="${section}"`);
    }
    expect(html.match(/id="hero"/g)).toHaveLength(1);
    expect(html.length).toBeLessThan(90_000);
  });

  it("omits data-palette from the rendered body tag", () => {
    expect(getBodyTag(render())).not.toMatch(/\bdata-palette=/i);
  });

  it("places a distinctive palette in :root without a matching body preset", () => {
    const html = render({
      ...THEME,
      palette: { ...THEME.palette, primary: "#ff00ff" },
    });
    expect(html).toContain("--primary: #ff00ff;");
    expect(getBodyTag(html)).not.toMatch(/\bdata-palette=/i);
  });

  it("applies all six style attributes exactly once on the body tag", () => {
    const theme: FreeSiteTheme = {
      ...THEME,
      fontPairing: "blocky",
      backgroundEffect: "gradients",
      heroStyle: "centred",
      tokenomicsStyle: "ledger",
      roadmapStyle: "cards",
      aboutStyle: "quotes",
    };
    const bodyTag = getBodyTag(render(theme));
    const attributes = {
      "data-fonts": theme.fontPairing,
      "data-bg": theme.backgroundEffect,
      "data-hero": theme.heroStyle,
      "data-tokenomics": theme.tokenomicsStyle,
      "data-roadmap": theme.roadmapStyle,
      "data-about": theme.aboutStyle,
    } as const;

    for (const [attribute, value] of Object.entries(attributes)) {
      expect(bodyTag.match(new RegExp(`${attribute}=`, "g"))).toHaveLength(1);
      expect(bodyTag).toContain(`${attribute}="${value}"`);
    }
  });

  it("escapes untrusted copy including script markup and quotes", () => {
    const dangerous = `<script>alert("owned")</script> "double" 'single'`;
    const html = render(THEME, { ...COPY, tokenName: dangerous });
    expect(html).not.toContain(dangerous);
    expect(html).not.toContain('<script>alert("owned")</script>');
    expect(html).toContain(
      "&lt;script&gt;alert(&quot;owned&quot;)&lt;/script&gt; &quot;double&quot; &#39;single&#39;",
    );
  });

  it("rejects invalid palette values", () => {
    expect(() =>
      render({
        ...THEME,
        palette: { ...THEME.palette, primary: "#fff; background:url(javascript:alert(1))" },
      }),
    ).toThrow(/Invalid palette colour/);
  });

  it("validates style fields at runtime", () => {
    expect(() => render({ ...THEME, heroStyle: "unsafe" as FreeSiteHeroStyle })).toThrow(
      /Invalid heroStyle/,
    );
  });

  it("renders every value of all six style unions", () => {
    const fontPairings: FreeSiteFontPairing[] = [
      "street",
      "blocky",
      "arcade",
      "rounded",
      "cyber",
      "editorial",
    ];
    const backgroundEffects: FreeSiteBackgroundEffect[] = [
      "cascade",
      "gradients",
      "particles",
      "grid",
      "none",
    ];
    const heroStyles: FreeSiteHeroStyle[] = ["split", "centred", "stacked"];
    const tokenomicsStyles: FreeSiteTokenomicsStyle[] = ["terminal", "grid", "ledger"];
    const roadmapStyles: FreeSiteRoadmapStyle[] = ["timeline", "cards", "path"];
    const aboutStyles: FreeSiteAboutStyle[] = ["numbered", "icons", "quotes"];

    for (const fontPairing of fontPairings) {
      expect(() => render({ ...THEME, fontPairing })).not.toThrow();
    }
    for (const backgroundEffect of backgroundEffects) {
      expect(() => render({ ...THEME, backgroundEffect })).not.toThrow();
    }
    for (const heroStyle of heroStyles) {
      expect(() => render({ ...THEME, heroStyle })).not.toThrow();
    }
    for (const tokenomicsStyle of tokenomicsStyles) {
      expect(() => render({ ...THEME, tokenomicsStyle })).not.toThrow();
    }
    for (const roadmapStyle of roadmapStyles) {
      expect(() => render({ ...THEME, roadmapStyle })).not.toThrow();
    }
    for (const aboutStyle of aboutStyles) {
      expect(() => render({ ...THEME, aboutStyle })).not.toThrow();
    }
  });

  it("removes the demo panel and contains no unsafe embedded resources", () => {
    const html = render();
    expect(html).not.toMatch(/demo-(?:panel|toggle|close)/i);
    expect(html).not.toMatch(/demo control panel|design controls/i);
    expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=/i);
    expect(html).not.toMatch(/<(?:object|embed)\b/i);
    expect(html).not.toMatch(/javascript\s*:/i);
  });

  it("emits exactly one iframe: the unresolved Dexscreener chart embed placeholder", () => {
    const html = render();
    const iframeTags = html.match(/<iframe\b[^>]*>/gi) || [];
    expect(iframeTags).toHaveLength(1);
    expect(iframeTags[0]).toContain(`src="${CHART_EMBED_PLACEHOLDER}"`);
  });

  it("never hides .reveal content outside a .js scope", () => {
    const html = render();
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    expect(styleMatch).not.toBeNull();
    const css = styleMatch![1];
    expect(css).not.toMatch(/(?<!\.js )\.reveal\b/);
    expect(css).toContain(".js .reveal { opacity: 0;");
    expect(css).toContain(".js .reveal.in { opacity: 1;");
  });

  it("adds the js class from the inline script before any other statement", () => {
    const html = render();
    const scriptMatch = html.match(/<script>\s*\(\(\) => \{([\s\S]*?)\n {2}const reduce/);
    expect(scriptMatch).not.toBeNull();
    const firstStatement = scriptMatch![1].trim();
    expect(firstStatement).toBe("document.documentElement.classList.add('js');");
  });

  it("falls back to revealing every .reveal element after a timeout", () => {
    const html = render();
    expect(html).toMatch(
      /addEventListener\('DOMContentLoaded',\s*\(\)\s*=>\s*\{\s*setTimeout\(\(\)\s*=>\s*\{\s*document\.querySelectorAll\('\.reveal:not\(\.in\)'\)\.forEach\(el => el\.classList\.add\('in'\)\);\s*\}, 1500\);/,
    );
  });

  describe("facts-driven tokenomics", () => {
    it("never renders the invented placeholder text 'not announced yet'", () => {
      expect(render().toLowerCase()).not.toContain("not announced yet");
    });

    it("renders supply and decimals from facts, not from copy", () => {
      const html = render(THEME, COPY, { ...FACTS, supply: "42,000,000", decimals: 9 });
      expect(html).toContain("42,000,000");
      expect(html).toContain(">9<");
    });

    it("renders the fixed contract guarantees as the six tokenomics stat cells", () => {
      const html = render();
      expect(html).toContain("Total Supply");
      expect(html).toContain("Decimals");
      expect(html).toContain("Buy Tax");
      expect(html).toContain("Sell Tax");
      expect(html).toContain("Mint Authority");
      expect(html).toContain("Ownership");
      expect(html).not.toContain("Liquidity");
      expect((html.match(/>0%</g) || []).length).toBeGreaterThanOrEqual(2);
      expect(html).toContain(">None<");
      expect(html).toContain(">No owner<");
    });

    it("never mentions the bonding-curve trading fee", () => {
      const html = render();
      const lower = html.toLowerCase();
      expect(lower).not.toContain("1%");
      expect(lower).not.toContain("bonding curve");
      expect(lower).not.toContain("trading fee");
    });
  });

  describe("conditional facts-driven blocks", () => {
    it("omits the X card when xHandle is blank but keeps the Telegram card", () => {
      const html = render(THEME, COPY, { ...FACTS, xHandle: "" });
      expect(html).not.toContain("Follow the mission");
      expect(html).not.toContain('aria-label="X"');
      expect(html).toContain("Join the horde");
      expect(html).toContain('id="community"');
      expect(html).toContain("#community");
    });

    it("omits the Telegram card when telegram is blank but keeps the X card", () => {
      const html = render(THEME, COPY, { ...FACTS, telegram: "" });
      expect(html).toContain("Follow the mission");
      expect(html).not.toContain("Join the horde");
      expect(html).not.toContain('aria-label="Telegram"');
    });

    it("omits the whole community section and its nav link when both handles are blank", () => {
      const html = render(THEME, COPY, { ...FACTS, xHandle: "", telegram: "" });
      expect(html).not.toContain("Follow the mission");
      expect(html).not.toContain("Join the horde");
      expect(html).not.toContain(">Community<");
      expect(html).not.toContain("#community");
      // isCompleteGeneratedPageHtml requires id="community" to remain present
      // (see tests/generated-site-page.test.ts), so an empty hidden section
      // stands in for the omitted content instead of dropping the id.
      expect(html).toContain('id="community"');
      expect(isCompleteGeneratedPageHtml(html)).toBe(true);
    });

    // Contract address, the Buy CTA link and the Dexscreener chart are
    // platform facts that arrive automatically after generation, so
    // renderFreeSiteTemplate no longer takes a contractAddress at all: it
    // always writes both the "known" and "coming soon" markup plus
    // unresolved platform placeholders, and lib/free-site-platform-facts.ts
    // picks one side and fills them in at request time (issue #173).
    it("always emits the contract bar, footer contract line, Buy CTA and chart with unresolved platform placeholders", () => {
      const html = render();
      expect(html).toContain('aria-label="Contract address"');
      expect(html).toContain("{{CONTRACT_ADDRESS}}");
      expect(html).toContain("{{BUY_HREF}}");
      expect(html).toContain(`Buy ${COPY.ticker}`);
      expect(html).toContain("Coming soon");
      expect(html).toContain('id="chart"');
      expect(html).toContain("{{CHART_URL}}");
      expect(html).toContain(CHART_EMBED_PLACEHOLDER);
      expect(html).toContain("{{CHART_SEARCH_URL}}");
      expect(html).toContain("{{LP_LOCKED_DATE}}");
      expect(html).toContain('href="#chart"');
    });

    it("passes generated-page validation with the platform-fact markers left in place", () => {
      const html = render();
      expect(isCompleteGeneratedPageHtml(html)).toBe(true);
    });

    // Dexscreener never indexes Robinhood Chain Testnet, so the no-pair-yet
    // state must read as "activates once trading is indexed", not "broken"
    // or a vague "coming soon" (issue #286).
    it("frames the no-pair chart state as activating once trading is indexed, not as broken", () => {
      const html = render();
      expect(html).toContain("Chart activates once trading is indexed");
      expect(html).toContain("doesn't index Robinhood Chain Testnet");
      expect(html).toContain("Check Dexscreener ↗");
    });
  });

  describe("handle normalisation and links", () => {
    it.each(["@BLTKK", "BLTKK", "x.com/BLTKK"])(
      "normalises xHandle %s to href=https://x.com/BLTKK and display @BLTKK",
      (rawHandle) => {
        const html = render(THEME, COPY, { ...FACTS, xHandle: rawHandle });
        expect(html).toContain('href="https://x.com/BLTKK"');
        expect(html).toContain(">@BLTKK<");
        expect(html).not.toContain("@@BLTKK");
      },
    );

    it.each(["@hoodlumsdev", "hoodlumsdev", "t.me/hoodlumsdev"])(
      "normalises telegram %s to href=https://t.me/hoodlumsdev",
      (rawHandle) => {
        const html = render(THEME, COPY, { ...FACTS, telegram: rawHandle });
        expect(html).toContain('href="https://t.me/hoodlumsdev"');
        expect(html).toContain(">t.me/hoodlumsdev<");
      },
    );

    it("gives every external link target=_blank and rel=noopener noreferrer", () => {
      const html = render();
      const externalLinks = [...html.matchAll(/<a\b[^>]*\btarget="_blank"[^>]*>/g)].map((m) => m[0]);
      expect(externalLinks.length).toBeGreaterThan(0);
      for (const link of externalLinks) {
        expect(link).toContain('rel="noopener noreferrer"');
      }
    });

    it("keeps nav anchors matching the sections actually rendered", () => {
      const html = render();
      for (const id of ["about", "tokenomics", "roadmap", "how-to-buy", "community"]) {
        expect(html).toContain(`href="#${id}"`);
      }
    });

    it("drops the community nav anchor when the community section is omitted", () => {
      const html = render(THEME, COPY, { ...FACTS, xHandle: "", telegram: "" });
      for (const id of ["about", "tokenomics", "roadmap", "how-to-buy"]) {
        expect(html).toContain(`href="#${id}"`);
      }
      expect(html).not.toContain('href="#community"');
    });
  });

  describe("marquee", () => {
    it("contains no unproven claim and only the approved fixed facts", () => {
      const html = render();
      const marqueeMatch = html.match(/<div class="marquee-track">([\s\S]*?)<\/div>/);
      expect(marqueeMatch).not.toBeNull();
      const marquee = marqueeMatch![1];
      expect(marquee).not.toMatch(/lp locked/i);
      expect(marquee).not.toMatch(/contract renounced/i);
      expect(marquee).not.toMatch(/no dev wallet/i);
      expect(marquee).toContain("0% TAX");
      expect(marquee).toContain("NO MINT FUNCTION");
      expect(marquee).toContain("NO OWNER");
    });
  });

  describe("hero artwork", () => {
    function getStyleCss(html: string): string {
      const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
      if (!styleMatch) throw new Error("Rendered page has no <style> block.");
      return styleMatch[1];
    }

    it("never applies object-fit: cover to the artwork on any hero variant", () => {
      const css = getStyleCss(render());
      const heroArtImgRules = css.match(/\.hero-art img[^{]*\{[^}]*\}/g) ?? [];
      expect(heroArtImgRules.length).toBeGreaterThanOrEqual(3);
      for (const rule of heroArtImgRules) {
        expect(rule).not.toMatch(/object-fit:\s*cover/);
      }
    });

    it("does not force a 16/9 aspect ratio on the stacked variant's artwork", () => {
      const css = getStyleCss(render());
      const stackedArtRules = css.match(/body\[data-hero="stacked"\] \.hero-art[^{]*\{[^}]*\}/g) ?? [];
      expect(stackedArtRules.length).toBeGreaterThanOrEqual(2);
      for (const rule of stackedArtRules) {
        expect(rule).not.toMatch(/aspect-ratio:\s*16\s*\/\s*9/);
      }
    });

    it("raises the centred variant's artwork opacity to at least .7", () => {
      const css = getStyleCss(render());
      const centredArtRule = css.match(/body\[data-hero="centred"\] \.hero-art \{[^}]*\}/);
      expect(centredArtRule).not.toBeNull();
      const opacityMatch = centredArtRule![0].match(/opacity:\s*([\d.]+)/);
      expect(opacityMatch).not.toBeNull();
      expect(Number(opacityMatch![1])).toBeGreaterThanOrEqual(0.7);
    });

    it("renders every hero variant as complete, valid page HTML", () => {
      const heroStyles: FreeSiteHeroStyle[] = ["split", "centred", "stacked"];
      for (const heroStyle of heroStyles) {
        const html = render({ ...THEME, heroStyle });
        expect(isCompleteGeneratedPageHtml(html)).toBe(true);
      }
    });
  });

  it("throws when a facts value has the wrong type", () => {
    expect(() =>
      renderFreeSiteTemplate({
        theme: THEME,
        copy: COPY,
        facts: { ...FACTS, decimals: Number.NaN },
        sections: ALL_SECTIONS,
      }),
    ).toThrow(/Invalid facts value for decimals/);
  });

  describe("optional sections", () => {
    const ABOUT_ONLY: FreeSiteSections = {
      about: true,
      tokenomics: false,
      roadmap: false,
      howToBuy: false,
      faq: false,
    };

    it("renders only hero and about when the rest are disabled, with hidden empty placeholders for the others", () => {
      const html = render(THEME, COPY, FACTS, ABOUT_ONLY);

      expect(html).toContain(COPY.aboutTitle);
      expect(html).toContain(COPY.about1Body);

      for (const [id, disabledCopy] of [
        ["tokenomics", COPY.tokenomicsTitle],
        ["roadmap", COPY.roadmapTitle],
        ["how-to-buy", COPY.howToBuyTitle],
        ["faq", COPY.faqTitle],
      ] as const) {
        expect(html).toContain(`<section id="${id}" aria-hidden="true" style="display:none"></section>`);
        expect(html).not.toContain(disabledCopy as string);
      }

      // Every required id from lib/generated-site-page.ts stays present.
      expect(isCompleteGeneratedPageHtml(html)).toBe(true);
      for (const section of REQUIRED_PAGE_SECTIONS) {
        expect(html).toContain(`id="${section}"`);
      }
    });

    it("keeps only the enabled sections' links in the header nav and footer", () => {
      const html = render(THEME, COPY, FACTS, ABOUT_ONLY);
      const nav = getHeaderNavLinks(html);
      const footer = getFooterLinks(html);

      expect(nav).toContain('href="#about"');
      expect(footer).toContain('href="#about"');
      for (const id of ["tokenomics", "roadmap", "how-to-buy"]) {
        expect(nav).not.toContain(`href="#${id}"`);
      }
      for (const id of ["tokenomics", "roadmap"]) {
        expect(footer).not.toContain(`href="#${id}"`);
      }
    });

    it("drops the facts-driven tokenomics stats along with the rest of the section when tokenomics is disabled", () => {
      const html = render(THEME, COPY, FACTS, ABOUT_ONLY);
      expect(html).not.toContain("Total Supply");
      expect(html).not.toContain(FACTS.supply);
    });

    it("renders every section when all toggles are enabled, matching the pre-toggle behaviour", () => {
      const html = render();
      expect(html).toContain(COPY.roadmapTitle as string);
      expect(html).toContain(COPY.howToBuyTitle as string);
      expect(html).toContain(COPY.faqTitle as string);
      const nav = getHeaderNavLinks(html);
      for (const id of ["about", "tokenomics", "roadmap", "how-to-buy"]) {
        expect(nav).toContain(`href="#${id}"`);
      }
    });

    it("does not require copy for a disabled section", () => {
      const sparseCopy: FreeSiteCopy = {
        tokenName: COPY.tokenName,
        ticker: COPY.ticker,
        kicker: COPY.kicker,
        tagline: COPY.tagline,
        aboutTitle: COPY.aboutTitle,
        about1Title: COPY.about1Title,
        about1Body: COPY.about1Body,
        about2Title: COPY.about2Title,
        about2Body: COPY.about2Body,
        about3Title: COPY.about3Title,
        about3Body: COPY.about3Body,
        communityTitle: COPY.communityTitle,
      };
      expect(() => render(THEME, sparseCopy, FACTS, ABOUT_ONLY)).not.toThrow();
    });

    it("throws when copy for an enabled section is missing", () => {
      const withoutTokenomicsTitle = { ...COPY };
      delete withoutTokenomicsTitle.tokenomicsTitle;
      expect(() =>
        render(THEME, withoutTokenomicsTitle, FACTS, ALL_SECTIONS),
      ).toThrow(/Invalid copy value for tokenomicsTitle/);
    });

    it("throws when a sections value is not a boolean", () => {
      expect(() =>
        render(THEME, COPY, FACTS, { ...ALL_SECTIONS, roadmap: "yes" as unknown as boolean }),
      ).toThrow(/Invalid sections value for roadmap/);
    });

    it("defaults to about and tokenomics on, the rest off (issue #171)", () => {
      expect(FREE_SITE_SECTION_DEFAULTS).toEqual({
        about: true,
        tokenomics: true,
        roadmap: false,
        howToBuy: false,
        faq: false,
      });
    });

    it("hides every optional section and its nav links when all toggles are off", () => {
      const allOff: FreeSiteSections = {
        about: false,
        tokenomics: false,
        roadmap: false,
        howToBuy: false,
        faq: false,
      };
      const html = render(THEME, COPY, FACTS, allOff);

      for (const id of ["about", "tokenomics", "roadmap", "how-to-buy", "faq"]) {
        expect(html).toContain(`<section id="${id}" aria-hidden="true" style="display:none"></section>`);
      }
      const nav = getHeaderNavLinks(html);
      const footer = getFooterLinks(html);
      for (const id of ["about", "tokenomics", "roadmap", "how-to-buy"]) {
        expect(nav).not.toContain(`href="#${id}"`);
      }
      for (const id of ["about", "tokenomics", "roadmap"]) {
        expect(footer).not.toContain(`href="#${id}"`);
      }
      expect(isCompleteGeneratedPageHtml(html)).toBe(true);
    });
  });
});
