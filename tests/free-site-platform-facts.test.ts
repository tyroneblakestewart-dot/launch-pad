import { describe, expect, it } from "vitest";
import {
  buildContractExplorerUrl,
  buildDexscreenerSearchUrl,
  buildHoodlumsTradeUrl,
  formatLiquidityLabel,
  isFreeSiteTemplateHtml,
  substituteFreeSitePlatformFacts,
  type FreeSitePlatformFacts,
} from "@/lib/free-site-platform-facts";
import { CHART_EMBED_PLACEHOLDER } from "@/lib/generated-site-page";

function page(inner: string): string {
  return `<!doctype html><html><body>${inner}</body></html>`;
}

const NOT_FOUND: FreeSitePlatformFacts["chart"] = { found: false };
const FOUND: FreeSitePlatformFacts["chart"] = {
  found: true,
  url: "https://dexscreener.com/robinhood/pair-1",
  embedUrl: "https://dexscreener.com/robinhood/pair-1?embed=1&theme=dark&trades=0&info=0",
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

describe("buildHoodlumsTradeUrl", () => {
  it("builds the token's Hoodlums trade page for either supported chain and empty string for blank input", () => {
    expect(buildHoodlumsTradeUrl("robinhood", " 0xabc ")).toBe("https://hoodlums.dev/token/robinhood/0xabc");
    expect(buildHoodlumsTradeUrl("solana", "So11111111111111111111111111111111111111112")).toBe(
      "https://hoodlums.dev/token/solana/So11111111111111111111111111111111111111112",
    );
    expect(buildHoodlumsTradeUrl("robinhood", "   ")).toBe("");
  });
});

describe("buildContractExplorerUrl", () => {
  it("uses the shared chain config's explorer base and empty string for blank input", () => {
    expect(buildContractExplorerUrl("robinhood", "0xabc")).toBe(
      "https://explorer.testnet.chain.robinhood.com/address/0xabc",
    );
    expect(buildContractExplorerUrl("solana", "So1")).toBe("https://explorer.solana.com/address/So1");
    expect(buildContractExplorerUrl("robinhood", "")).toBe("");
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
        `<!--CHART_FOUND_START--><div>{{CHART_DEX_ID}} · {{CHART_LIQUIDITY}} <iframe src="${CHART_EMBED_PLACEHOLDER}"></iframe> <a href="{{CHART_URL}}">Open</a></div><!--CHART_FOUND_END-->`,
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
    // No pair found means the whole CHART_FOUND block, including its
    // iframe and the unresolved embed placeholder, is dropped entirely.
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain(CHART_EMBED_PLACEHOLDER);
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
    // A stored page from before the Hoodlums-chart change carries the old
    // Dexscreener search link-out; its label is honest, so it still points there.
    expect(html).toContain(
      'href="https://dexscreener.com/search?q=0x1111111111111111111111111111111111111111"',
    );
    // Buy goes to the token's own Hoodlums trade page — the only place a
    // bonding-curve token can be bought — never to a Dexscreener search.
    expect(html).toContain(
      '<a href="https://hoodlums.dev/token/robinhood/0x1111111111111111111111111111111111111111">Buy</a>',
    );
  });

  it("builds the Buy link for the site's own chain, defaulting to robinhood when no chain is given", () => {
    const solana = substituteFreeSitePlatformFacts(markerPage(), {
      contractAddress: "So11111111111111111111111111111111111111112",
      chain: "solana",
      chart: NOT_FOUND,
      lpLockedAt: null,
    });
    expect(solana).toContain('<a href="https://hoodlums.dev/token/solana/So11111111111111111111111111111111111111112">Buy</a>');
  });

  function currentTemplatePage(): string {
    return page(
      [
        '<!--CONTRACT_KNOWN_START--><span id="ca-value">{{CONTRACT_ADDRESS}}</span><a class="explorer-link" href="{{EXPLORER_URL}}">Explorer</a><!--CONTRACT_KNOWN_END-->',
        '<!--CONTRACT_PENDING_START--><span>Coming soon</span><!--CONTRACT_PENDING_END-->',
        '<!--CHART_UNKNOWN_START--><div>',
        '<!--CHART_TRADE_LINK_START--><strong>Live chart on Hoodlums</strong><a href="{{TRADE_URL}}">Open live chart</a><!--CHART_TRADE_LINK_END-->',
        "<!--CHART_PRELAUNCH_START--><strong>Chart goes live at launch</strong><!--CHART_PRELAUNCH_END-->",
        "</div><!--CHART_UNKNOWN_END-->",
      ].join(""),
    );
  }

  it("with a contract: links the chart panel and the contract row to the Hoodlums trade page and the block explorer", () => {
    const html = substituteFreeSitePlatformFacts(currentTemplatePage(), {
      contractAddress: "0x1111111111111111111111111111111111111111",
      chain: "robinhood",
      chart: NOT_FOUND,
      lpLockedAt: null,
    });
    expect(html).toContain('<a href="https://hoodlums.dev/token/robinhood/0x1111111111111111111111111111111111111111">Open live chart</a>');
    expect(html).toContain(
      '<a class="explorer-link" href="https://explorer.testnet.chain.robinhood.com/address/0x1111111111111111111111111111111111111111">Explorer</a>',
    );
    expect(html).toContain("Live chart on Hoodlums");
    expect(html).not.toContain("Chart goes live at launch");
    expect(html).not.toContain("{{TRADE_URL}}");
    expect(html).not.toContain("{{EXPLORER_URL}}");
  });

  it("without a contract: shows the goes-live-at-launch note, no trade link, no explorer link and no unresolved placeholders", () => {
    const html = substituteFreeSitePlatformFacts(currentTemplatePage(), {
      contractAddress: "",
      chart: NOT_FOUND,
      lpLockedAt: null,
    });
    expect(html).toContain("Chart goes live at launch");
    expect(html).not.toContain("Live chart on Hoodlums");
    expect(html).not.toContain("Open live chart");
    expect(html).not.toContain("explorer-link");
    expect(html).not.toContain("{{TRADE_URL}}");
    expect(html).not.toContain("{{EXPLORER_URL}}");
  });

  it("shows the live pair and links Buy to it once a Dexscreener pair is found", () => {
    const html = substituteFreeSitePlatformFacts(markerPage(), {
      contractAddress: "0x1111111111111111111111111111111111111111",
      chart: FOUND,
      lpLockedAt: null,
    });

    expect(html).toContain("uniswap");
    expect(html).toContain("£12K liquidity");
    expect(html).toContain(
      '<iframe src="https://dexscreener.com/robinhood/pair-1?embed=1&amp;theme=dark&amp;trades=0&amp;info=0"></iframe>',
    );
    expect(html).not.toContain(CHART_EMBED_PLACEHOLDER);
    expect(html).toContain('<a href="https://dexscreener.com/robinhood/pair-1">Open</a>');
    // Buy stays on the Hoodlums trade page even once a pair exists: after
    // graduation that page links on to the locked pool itself.
    expect(html).toContain(
      '<a href="https://hoodlums.dev/token/robinhood/0x1111111111111111111111111111111111111111">Buy</a>',
    );
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
