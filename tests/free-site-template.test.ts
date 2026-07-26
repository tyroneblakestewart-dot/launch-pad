import { describe, expect, it } from "vitest";
import {
  ARTWORK_PLACEHOLDER,
  REQUIRED_PAGE_SECTIONS,
  isCompleteGeneratedPageHtml,
} from "@/lib/generated-site-page";
import {
  renderFreeSiteTemplate,
  type FreeSiteAboutStyle,
  type FreeSiteBackgroundEffect,
  type FreeSiteCopy,
  type FreeSiteFontPairing,
  type FreeSiteHeroStyle,
  type FreeSiteRoadmapStyle,
  type FreeSiteTheme,
  type FreeSiteTokenomicsStyle,
} from "@/lib/free-site-template";

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
  contract: "0x1111111111111111111111111111111111111111",
  aboutTitle: "A token with a mission",
  about1Title: "Community first",
  about1Body: "Every step is built around the people holding the line.",
  about2Title: "Transparent launch",
  about2Body: "The contract and launch details stay clear for everyone.",
  about3Title: "Built to last",
  about3Body: "The roadmap focuses on steady community-led growth.",
  tokenomicsTitle: "Simple tokenomics",
  supply: "1,000,000,000",
  buyTax: "0%",
  sellTax: "0%",
  lpStatus: "Locked",
  mintAuth: "Revoked",
  ownership: "Renounced",
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
  xHandle: "hoodlumsdev",
  telegram: "hoodlumsdev",
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

function render(theme: FreeSiteTheme = THEME, copy: FreeSiteCopy = COPY): string {
  return renderFreeSiteTemplate({ theme, copy });
}

function getBodyTag(html: string): string {
  const match = html.match(/<body\b[^>]*>/i);
  if (!match) throw new Error("Rendered page has no body tag.");
  return match[0];
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
    expect(html).not.toMatch(/<iframe\b/i);
    expect(html).not.toMatch(/javascript\s*:/i);
  });
});
