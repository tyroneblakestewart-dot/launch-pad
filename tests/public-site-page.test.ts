import { afterEach, describe, expect, it } from "vitest";
import PublicGeneratedSitePage, { generateMetadata } from "@/app/[slug]/page";
import { notFound } from "next/navigation";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import {
  resetPublicGeneratedSiteAdapterForTests,
  setPublicGeneratedSiteAdapter,
} from "@/lib/server/public-generated-sites";
import type { PublicGeneratedSite } from "@/lib/public-site";
import { PublicDexscreenerSection } from "@/components/public-dexscreener-section";
import { PublicSiteFrame } from "@/components/public-site-frame";
import { PublicTokenFallback } from "@/components/public-token-fallback";

const PNG_BASE64 = Buffer.from("fake-png-bytes").toString("base64");
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
});

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
