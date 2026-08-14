import { afterEach, describe, expect, it } from "vitest";
import { generateMetadata } from "@/app/[slug]/page";
import { LAUNCH_PATH_OPTIONS } from "@/lib/launch-paths";
import type { PublicGeneratedSite } from "@/lib/public-site";
import {
  resetPublicGeneratedSiteAdapterForTests,
  setPublicGeneratedSiteAdapter,
} from "@/lib/server/public-generated-sites";
import {
  resetPublicSiteSubdomainAccessAdapterForTests,
  setPublicSiteSubdomainAccessAdapterForTests,
} from "@/lib/server/public-site-subdomain";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=";

const SITE: PublicGeneratedSite = {
  slug: "goldenhour",
  name: "Golden Hour",
  ticker: "GOLD",
  description: "A published token site with a paid Hoodlums subdomain.",
  supply: "1000000000",
  decimals: 18,
  chain: "robinhood",
  heroImage: `data:image/png;base64,${PNG_BASE64}`,
  generatedSiteHtml: null,
  contractAddress: "",
  xHandle: "",
  telegram: "",
  status: "prepared",
  visibility: "live",
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
};

function entitled() {
  setPublicSiteSubdomainAccessAdapterForTests(async (slug) => ({
    status: "entitled",
    slug,
    ownerWalletAddress: "0x1111111111111111111111111111111111111111",
    tier: "bond_pro_site",
    permanent: true,
  }));
}

function pathOnly() {
  setPublicSiteSubdomainAccessAdapterForTests(async (slug) => ({
    status: "path-only",
    slug,
    ownerWalletAddress: "0x2222222222222222222222222222222222222222",
  }));
}

afterEach(() => {
  resetPublicGeneratedSiteAdapterForTests();
  resetPublicSiteSubdomainAccessAdapterForTests();
  delete process.env.HOODLUMS_SUBDOMAINS_ENABLED;
});

describe("public-site canonical URLs", () => {
  it("keeps the existing path canonical while wildcard routing is dormant", async () => {
    setPublicGeneratedSiteAdapter(async () => SITE);
    entitled();

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: SITE.slug }),
    });

    expect(metadata.alternates?.canonical).toBe(
      "https://hoodlums.dev/goldenhour",
    );
    expect(metadata.openGraph?.url).toBe(
      "https://hoodlums.dev/goldenhour",
    );
    expect(metadata.openGraph?.images).toEqual(["/goldenhour/artwork"]);
  });

  it("uses one subdomain canonical and absolute OG image on both public entry points", async () => {
    process.env.HOODLUMS_SUBDOMAINS_ENABLED = "true";
    setPublicGeneratedSiteAdapter(async () => SITE);
    entitled();

    const fromPath = await generateMetadata({
      params: Promise.resolve({ slug: SITE.slug }),
    });
    const fromSubdomainRewrite = await generateMetadata({
      params: Promise.resolve({ slug: SITE.slug }),
    });

    for (const metadata of [fromPath, fromSubdomainRewrite]) {
      expect(metadata.alternates?.canonical).toBe(
        "https://goldenhour.hoodlums.dev",
      );
      expect(metadata.openGraph?.url).toBe(
        "https://goldenhour.hoodlums.dev",
      );
      expect(metadata.openGraph?.images).toEqual([
        "https://goldenhour.hoodlums.dev/artwork",
      ]);
      expect(metadata.twitter).toMatchObject({
        images: ["https://goldenhour.hoodlums.dev/artwork"],
      });
    }
  });

  it("keeps a free owner canonical at hoodlums.dev/slug", async () => {
    process.env.HOODLUMS_SUBDOMAINS_ENABLED = "true";
    setPublicGeneratedSiteAdapter(async () => SITE);
    pathOnly();

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: SITE.slug }),
    });
    expect(metadata.alternates?.canonical).toBe(
      "https://hoodlums.dev/goldenhour",
    );
    expect(metadata.openGraph?.images).toEqual(["/goldenhour/artwork"]);
  });

  it("never canonicalises a draft preview to a public subdomain", async () => {
    process.env.HOODLUMS_SUBDOMAINS_ENABLED = "true";
    setPublicGeneratedSiteAdapter(async () => ({
      ...SITE,
      visibility: "draft",
      draftToken: "draft-secret",
    }));
    entitled();

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: SITE.slug }),
      searchParams: Promise.resolve({ preview: "draft-secret" }),
    });
    expect(metadata.alternates?.canonical).toBe(
      "https://hoodlums.dev/goldenhour",
    );
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("Bond + Pro Site pricing promise", () => {
  it("marks the real subdomain feature live without changing the price", () => {
    const plan = LAUNCH_PATH_OPTIONS.find(
      (option) => option.id === "bond-pro-site",
    );
    expect(plan?.price).toBe("$10 · one-off");
    expect(plan?.bullets).toContain("[token].hoodlums.dev subdomain");
    expect(plan?.bullets).not.toContain(
      "[token].hoodlums.dev subdomain — coming soon",
    );
  });
});
