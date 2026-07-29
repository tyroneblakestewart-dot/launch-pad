import { describe, expect, it } from "vitest";
import {
  buildDexscreenerSearchUrl,
  formatLiquidityLabel,
  isFreeSiteTemplateHtml,
  substituteFreeSitePlatformFacts,
  type FreeSitePlatformFacts,
} from "@/lib/free-site-platform-facts";

function page(inner: string): string {
  return `<!doctype html><html><body>${inner}</body></html>`;
}

const NOT_FOUND: FreeSitePlatformFacts["chart"] = { found: false };
const FOUND: FreeSitePlatformFacts["chart"] = {
  found: true,
  url: "https://dexscreener.com/robinhood/pair-1",
  dexId: "uniswap",
  liquidityLabel: "£12K liquidity",
};

describe("isFreeSiteTemplateHtml", () => {
  it("is true only when the free-site marker is present", () => {
    expect(isFreeSiteTemplateHtml(page("<!--HOODLUMS_FREE_SITE_TEMPLATE-->"))).toBe(true);
    expect(isFreeSiteTemplateHtml(page("<p>bespoke page</p>"))).toBe(false);
  });
});

describe("buildDexscreenerSearchUrl", () => {
  it("builds a search URL for a trimmed address and empty string for blank input", () => {
    expect(buildDexscreenerSearchUrl(" 0xabc ")).toBe(
      "https://dexscreener.com/search?q=0xabc",
    );
    expect(buildDexscreenerSearchUrl("   ")).toBe("");
  });
});

describe("formatLiquidityLabel", () => {
  it("falls back to a generic label for zero or missing liquidity", () => {
    expect(formatLiquidityLabel(0)).toBe("Liquidity detected");
  });

  it("formats a positive value as compact currency plus liquidity", () => {
    expect(formatLiquidityLabel(12_000)).toContain("liquidity");
    expect(formatLiquidityLabel(12_000)).toMatch(/£|\$/);
  });
});

describe("substituteFreeSitePlatformFacts", () => {
  function markerPage(): string {
    return page(
      [
        '<div class="contract">',
        '<!--CONTRACT_KNOWN_START--><span id="ca-value">{{CONTRACT_ADDRESS}}</span><!--CONTRACT_KNOWN_END-->',
        '<!--CONTRACT_PENDING_START--><span class="contract-pending">Coming soon</span><!--CONTRACT_PENDING_END-->',
        "</div>",
        '<!--BUY_KNOWN_START--><a href="{{BUY_HREF}}">Buy</a><!--BUY_KNOWN_END-->',
        '<!--BUY_PENDING_START--><span class="btn-pending">Coming soon</span><!--BUY_PENDING_END-->',
        '<!--FOOTER_CONTRACT_KNOWN_START--><div>CA: {{CONTRACT_ADDRESS}}</div><!--FOOTER_CONTRACT_KNOWN_END-->',
        '<!--FOOTER_CONTRACT_PENDING_START--><div>CA: Coming soon</div><!--FOOTER_CONTRACT_PENDING_END-->',
        '<!--CHART_FOUND_START--><div>{{CHART_DEX_ID}} · {{CHART_LIQUIDITY}} <a href="{{CHART_URL}}">Open</a></div><!--CHART_FOUND_END-->',
        '<!--CHART_UNKNOWN_START--><div>Coming soon<!--CHART_SEARCH_LINK_START--><a href="{{CHART_SEARCH_URL}}">Search</a><!--CHART_SEARCH_LINK_END--></div><!--CHART_UNKNOWN_END-->',
        '<!--LP_LOCKED_START--><div class="stat">LP Locked {{LP_LOCKED_DATE}}</div><!--LP_LOCKED_END-->',
      ].join(""),
    );
  }

  it("selects the pending contract, buy and footer states and leaves no unresolved placeholders when there is no contract", () => {
    const html = substituteFreeSitePlatformFacts(markerPage(), {
      contractAddress: "",
      chart: NOT_FOUND,
      lpLockedAt: null,
    });

    expect(html).toContain("Coming soon");
    expect(html).not.toContain('id="ca-value"');
    expect(html).not.toContain("{{CONTRACT_ADDRESS}}");
    expect(html).not.toContain("{{BUY_HREF}}");
    expect(html).not.toContain('<a href="">Buy</a>');
    expect(html).toContain("btn-pending");
    // No contract at all means the chart's search-out link is also dropped.
    expect(html).not.toContain("Search</a>");
    expect(html).not.toContain("{{LP_LOCKED_DATE}}");
    expect(html).not.toContain("LP Locked");
  });

  it("selects the known contract, buy and footer states and fills the address once a contract exists", () => {
    const html = substituteFreeSitePlatformFacts(markerPage(), {
      contractAddress: "0x1111111111111111111111111111111111111111",
      chart: NOT_FOUND,
      lpLockedAt: null,
    });

    expect(html).toContain('<span id="ca-value">0x1111111111111111111111111111111111111111</span>');
    expect(html).toContain("CA: 0x1111111111111111111111111111111111111111");
    expect(html).not.toContain("contract-pending");
    expect(html).not.toContain("btn-pending");
    // A contract with no pair yet still gets a Dexscreener search link-out.
    expect(html).toContain(
      'href="https://dexscreener.com/search?q=0x1111111111111111111111111111111111111111"',
    );
    expect(html).toContain('<a href="https://dexscreener.com/search?q=0x1111111111111111111111111111111111111111">Buy</a>');
  });

  it("shows the live pair and links Buy to it once a Dexscreener pair is found", () => {
    const html = substituteFreeSitePlatformFacts(markerPage(), {
      contractAddress: "0x1111111111111111111111111111111111111111",
      chart: FOUND,
      lpLockedAt: null,
    });

    expect(html).toContain("uniswap");
    expect(html).toContain("£12K liquidity");
    expect(html).toContain('<a href="https://dexscreener.com/robinhood/pair-1">Open</a>');
    expect(html).toContain('<a href="https://dexscreener.com/robinhood/pair-1">Buy</a>');
    expect(html).not.toContain("Search</a>");
  });

  it("shows the LP-locked fact only once a lock date is present, with no coming-soon state", () => {
    const withoutLock = substituteFreeSitePlatformFacts(markerPage(), {
      contractAddress: "",
      chart: NOT_FOUND,
      lpLockedAt: null,
    });
    expect(withoutLock).not.toContain("LP Locked");

    const withLock = substituteFreeSitePlatformFacts(markerPage(), {
      contractAddress: "",
      chart: NOT_FOUND,
      lpLockedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(withLock).toContain("LP Locked 2026-03-01");
  });

  it("HTML-escapes a substituted contract address", () => {
    const html = substituteFreeSitePlatformFacts(markerPage(), {
      contractAddress: '"><script>alert(1)</script>',
      chart: NOT_FOUND,
      lpLockedAt: null,
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("passes through unchanged when the marker pairs are absent, such as a bespoke-pipeline page", () => {
    const bespoke = page("<p>hand-authored bespoke page with no markers</p>");
    const html = substituteFreeSitePlatformFacts(bespoke, {
      contractAddress: "0xabc",
      chart: FOUND,
      lpLockedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(html).toBe(bespoke);
  });
});
