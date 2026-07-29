import { afterEach, describe, expect, it, vi } from "vitest";
import PublicGeneratedSitePage, { generateMetadata } from "@/app/[slug]/page";
import { notFound } from "next/navigation";
import { FREE_SITE_TEMPLATE_MARKER } from "@/lib/free-site-platform-facts";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import {
  resetPublicGeneratedSiteAdapterForTests,
  setPublicGeneratedSiteAdapter,
} from "@/lib/server/public-generated-sites";
import type { PublicGeneratedSite } from "@/lib/public-site";
import { PublicDexscreenerSection } from "@/components/public-dexscreener-section";
import { PublicSiteFrame } from "@/components/public-site-frame";
import { PublicTokenFallback } from "@/components/public-token-fallback";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=";
const ARTWORK_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

function validGeneratedHtml(): string {
  const padding = "Original responsive campaign card content. ".repeat(110);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Original token page</title>
<style>body{margin:0}</style>
</head>
<body>
<header><nav>Home</nav></header>
<section id="hero"><h1>Hero</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Uploaded artwork"></section>
<section id="about"><p>${padding}</p></section>
<section id="tokenomics"><h2>Tokenomics</h2></section>
<section id="roadmap"><h2>Roadmap</h2></section>
<section id="how-to-buy"><h2>How to buy</h2></section>
<section id="community"><h2>Community</h2></section>
<script>1;</script>
</body>
</html>`;
}

function freeSiteGeneratedHtml(): string {
  const padding = "Original responsive campaign card content. ".repeat(110);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Free-site token page</title>
<style>body{margin:0}</style>
</head>
<body>
${FREE_SITE_TEMPLATE_MARKER}
<header><nav>Home</nav></header>
<section id="hero">
  <h1>Hero</h1>
  <img src="${ARTWORK_PLACEHOLDER}" alt="Uploaded artwork">
  <!--CONTRACT_KNOWN_START--><span id="ca-value">{{CONTRACT_ADDRESS}}</span><!--CONTRACT_KNOWN_END-->
  <!--CONTRACT_PENDING_START--><span class="contract-pending">Coming soon</span><!--CONTRACT_PENDING_END-->
  <!--BUY_KNOWN_START--><a href="{{BUY_HREF}}">Buy</a><!--BUY_KNOWN_END-->
  <!--BUY_PENDING_START--><span class="btn-pending">Coming soon</span><!--BUY_PENDING_END-->
</section>
<section id="about"><p>${padding}</p></section>
<section id="tokenomics">
  <h2>Tokenomics</h2>
  <!--LP_LOCKED_START--><div class="stat">LP Locked {{LP_LOCKED_DATE}}</div><!--LP_LOCKED_END-->
</section>
<section id="chart">
  <!--CHART_FOUND_START--><div>{{CHART_DEX_ID}} · {{CHART_LIQUIDITY}} <a href="{{CHART_URL}}">Open</a></div><!--CHART_FOUND_END-->
  <!--CHART_UNKNOWN_START--><div>Chart coming soon<!--CHART_SEARCH_LINK_START--><a href="{{CHART_SEARCH_URL}}">Search</a><!--CHART_SEARCH_LINK_END--></div><!--CHART_UNKNOWN_END-->
</section>
<section id="roadmap"><h2>Roadmap</h2></section>
<section id="how-to-buy"><h2>How to buy</h2></section>
<section id="community"><h2>Community</h2></section>
<footer>
  <!--FOOTER_CONTRACT_KNOWN_START--><div>CA: {{CONTRACT_ADDRESS}}</div><!--FOOTER_CONTRACT_KNOWN_END-->
  <!--FOOTER_CONTRACT_PENDING_START--><div>CA: Coming soon</div><!--FOOTER_CONTRACT_PENDING_END-->
</footer>
<script>1;</script>
</body>
</html>`;
}

const BASE_FIXTURE: PublicGeneratedSite = {
  slug: "hoodlums",
  name: "Hoodlums",
  ticker: "HOOD",
  description: "The code-running crew taking meme culture to a new chain.",
  supply: "1000000000",
  decimals: 18,
  chain: "robinhood",
  heroImage: ARTWORK_DATA_URL,
  generatedSiteHtml: validGeneratedHtml(),
  contractAddress: "0x3bf7447cd055f1475a8b09090c7b062abc9d3798",
  xHandle: "@hoodlums",
  telegram: "t.me/hoodlums",
  status: "launched",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function notFoundDigest(): string {
  try {
    notFound();
  } catch (error) {
    return (error as { digest?: string }).digest || "";
  }
  throw new Error("notFound() did not throw");
}

afterEach(() => {
  resetPublicGeneratedSiteAdapterForTests();
  vi.unstubAllGlobals();
});

function stubDexscreenerFetch(pairs: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ pairs }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

describe("PublicGeneratedSitePage", () => {
  it("renders the generated site frame and the Dexscreener section for a known fixture with a contract address", async () => {
    setPublicGeneratedSiteAdapter(async (slug) => (slug === "hoodlums" ? BASE_FIXTURE : null));

    const element = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const children = element.props.children as unknown[];

    const frame = children[0] as { type: unknown; props: { html: string } };
    expect(frame.type).toBe(PublicSiteFrame);
    expect(frame.props.html).toContain(ARTWORK_DATA_URL);
    expect(frame.props.html).not.toContain(ARTWORK_PLACEHOLDER);

    const dexscreener = children[1] as { type: unknown; props: { address: string } };
    expect(dexscreener.type).toBe(PublicDexscreenerSection);
    expect(dexscreener.props.address).toBe(BASE_FIXTURE.contractAddress);
  });

  it("omits the Dexscreener section when no contract address is saved", async () => {
    setPublicGeneratedSiteAdapter(async () => ({ ...BASE_FIXTURE, contractAddress: "" }));

    const element = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const children = element.props.children as unknown[];
    expect(children[1]).toBeNull();
  });

  it("renders the safe fallback when the generated HTML is missing", async () => {
    setPublicGeneratedSiteAdapter(async () => ({ ...BASE_FIXTURE, generatedSiteHtml: null }));

    const element = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const children = element.props.children as unknown[];
    const fallback = children[0] as { type: unknown; props: { site: PublicGeneratedSite } };
    expect(fallback.type).toBe(PublicTokenFallback);
    expect(fallback.props.site.name).toBe("Hoodlums");
  });

  it("renders the safe fallback when the generated HTML is corrupt", async () => {
    setPublicGeneratedSiteAdapter(async () => ({ ...BASE_FIXTURE, generatedSiteHtml: "<html>not complete</html>" }));

    const element = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const children = element.props.children as unknown[];
    const fallback = children[0] as { type: unknown };
    expect(fallback.type).toBe(PublicTokenFallback);
  });

  it("renders the safe fallback when artwork is missing even if the HTML is valid", async () => {
    setPublicGeneratedSiteAdapter(async () => ({ ...BASE_FIXTURE, heroImage: "" }));

    const element = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const children = element.props.children as unknown[];
    const fallback = children[0] as { type: unknown };
    expect(fallback.type).toBe(PublicTokenFallback);
  });

  it("calls notFound() for an unknown slug", async () => {
    setPublicGeneratedSiteAdapter(async () => null);
    const digest = notFoundDigest();

    await expect(
      PublicGeneratedSitePage({ params: Promise.resolve({ slug: "does-not-exist" }) }),
    ).rejects.toMatchObject({ digest });
  });

  it("calls notFound() for an invalid path slug without looking up a record", async () => {
    setPublicGeneratedSiteAdapter(async () => BASE_FIXTURE);
    const digest = notFoundDigest();

    await expect(
      PublicGeneratedSitePage({ params: Promise.resolve({ slug: "Not Valid" }) }),
    ).rejects.toMatchObject({ digest });
  });
});

// Platform facts (contract address, chart, LP locked) are stored as
// placeholders and substituted fresh on every request instead of being
// baked into generated_html, so a stored page updates when the token
// launches with no regeneration and no republish (issue #173).
describe("PublicGeneratedSitePage free-site platform-fact substitution", () => {
  const FREE_SITE_FIXTURE: PublicGeneratedSite = {
    ...BASE_FIXTURE,
    generatedSiteHtml: freeSiteGeneratedHtml(),
    contractAddress: "",
  };

  it("stores placeholders, not final values, for platform facts", () => {
    expect(FREE_SITE_FIXTURE.generatedSiteHtml).toContain("{{CONTRACT_ADDRESS}}");
    expect(FREE_SITE_FIXTURE.generatedSiteHtml).toContain("{{BUY_HREF}}");
    expect(FREE_SITE_FIXTURE.generatedSiteHtml).toContain("{{CHART_URL}}");
    expect(FREE_SITE_FIXTURE.generatedSiteHtml).toContain("{{LP_LOCKED_DATE}}");
  });

  it("substitutes the coming-soon state when no contract address is saved, without a live Dexscreener call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setPublicGeneratedSiteAdapter(async () => FREE_SITE_FIXTURE);

    const element = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const children = element.props.children as unknown[];
    const frame = children[0] as { type: unknown; props: { html: string } };

    expect(frame.type).toBe(PublicSiteFrame);
    expect(frame.props.html).toContain("Coming soon");
    expect(frame.props.html).not.toContain("{{CONTRACT_ADDRESS}}");
    expect(frame.props.html).not.toContain("{{BUY_HREF}}");
    expect(frame.props.html).not.toContain('id="ca-value"');
    // The free-site template renders its own chart section in-document, so
    // the separate, unthemed PublicDexscreenerSection is not also rendered.
    expect(children[1]).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("substitutes the known contract, buy link and a Dexscreener search link-out once a contract address is saved", async () => {
    stubDexscreenerFetch([]);
    const address = "0x3bf7447cd055f1475a8b09090c7b062abc9d3798";
    setPublicGeneratedSiteAdapter(async () => ({ ...FREE_SITE_FIXTURE, contractAddress: address }));

    const element = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const children = element.props.children as unknown[];
    const frame = children[0] as { type: unknown; props: { html: string } };

    expect(frame.props.html).toContain(`id="ca-value">${address}<`);
    expect(frame.props.html).toContain(`CA: ${address}`);
    expect(frame.props.html).toContain(`href="https://dexscreener.com/search?q=${address}"`);
    expect(children[1]).toBeNull();
  });

  it("shows the live pair once Dexscreener reports one, with no regeneration or republish", async () => {
    const address = "0x3bf7447cd055f1475a8b09090c7b062abc9d3798";
    stubDexscreenerFetch([
      {
        chainId: "robinhood",
        dexId: "uniswap",
        pairAddress: "pair-1",
        url: "https://dexscreener.com/robinhood/pair-1",
        liquidity: { usd: 5_000 },
      },
    ]);
    setPublicGeneratedSiteAdapter(async () => ({ ...FREE_SITE_FIXTURE, contractAddress: address }));

    const element = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const children = element.props.children as unknown[];
    const frame = children[0] as { type: unknown; props: { html: string } };

    expect(frame.props.html).toContain("uniswap");
    expect(frame.props.html).toContain('href="https://dexscreener.com/robinhood/pair-1"');
  });

  it("changes what /[slug] serves when contractAddress differs between requests, with the exact same stored HTML", async () => {
    stubDexscreenerFetch([]);
    let currentAddress = "";
    setPublicGeneratedSiteAdapter(async () => ({ ...FREE_SITE_FIXTURE, contractAddress: currentAddress }));

    const before = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const beforeHtml = (before.props.children as unknown[])[0] as { props: { html: string } };
    expect(beforeHtml.props.html).toContain("Coming soon");

    currentAddress = "0x3bf7447cd055f1475a8b09090c7b062abc9d3798";
    const after = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const afterHtml = (after.props.children as unknown[])[0] as { props: { html: string } };
    expect(afterHtml.props.html).toContain(currentAddress);
    expect(afterHtml.props.html).not.toContain("Coming soon");
  });

  it("shows the LP-locked fact only once lpLockedAt is set on the row", async () => {
    stubDexscreenerFetch([]);
    setPublicGeneratedSiteAdapter(async () => ({ ...FREE_SITE_FIXTURE, lpLockedAt: null }));

    const withoutLock = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const withoutLockHtml = (withoutLock.props.children as unknown[])[0] as { props: { html: string } };
    expect(withoutLockHtml.props.html).not.toContain("LP Locked");

    setPublicGeneratedSiteAdapter(async () => ({
      ...FREE_SITE_FIXTURE,
      lpLockedAt: "2026-03-01T00:00:00.000Z",
    }));
    const withLock = await PublicGeneratedSitePage({ params: Promise.resolve({ slug: "hoodlums" }) });
    const withLockHtml = (withLock.props.children as unknown[])[0] as { props: { html: string } };
    expect(withLockHtml.props.html).toContain("LP Locked 2026-03-01");
  });
});

describe("generateMetadata for the public site route", () => {
  it("builds a title, description, canonical URL and OG/Twitter image from a fixture", async () => {
    setPublicGeneratedSiteAdapter(async (slug) => (slug === "hoodlums" ? BASE_FIXTURE : null));

    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "hoodlums" }) });

    expect(metadata.title).toBe("Hoodlums ($HOOD)");
    expect(metadata.description).toBe(BASE_FIXTURE.description);
    expect(metadata.alternates?.canonical).toBe("https://hoodlums.dev/hoodlums");
    expect(metadata.openGraph?.images).toEqual(["/hoodlums/artwork"]);
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("omits image metadata when there is no valid artwork", async () => {
    setPublicGeneratedSiteAdapter(async () => ({ ...BASE_FIXTURE, heroImage: "" }));

    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "hoodlums" }) });
    expect(metadata.openGraph?.images).toBeUndefined();
    expect(metadata.twitter).toMatchObject({ card: "summary" });
  });

  it("returns empty metadata for an unknown slug instead of crashing", async () => {
    setPublicGeneratedSiteAdapter(async () => null);
    await expect(generateMetadata({ params: Promise.resolve({ slug: "does-not-exist" }) })).resolves.toEqual({});
  });

  it("returns empty metadata for an invalid path slug", async () => {
    setPublicGeneratedSiteAdapter(async () => BASE_FIXTURE);
    await expect(generateMetadata({ params: Promise.resolve({ slug: "Not Valid" }) })).resolves.toEqual({});
  });
});
