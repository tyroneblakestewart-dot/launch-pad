import { afterEach, describe, expect, it } from "vitest";
import {
  getPublicGeneratedSiteBySlug,
  listLiveGeneratedSites,
  resetLiveGeneratedSitesAdapterForTests,
  resetPublicGeneratedSiteAdapterForTests,
  setLiveGeneratedSitesAdapterForTests,
  setPublicGeneratedSiteAdapter,
} from "@/lib/server/public-generated-sites";
import type { PublicGeneratedSite } from "@/lib/public-site";

const FIXTURE: PublicGeneratedSite = {
  slug: "hoodlums",
  name: "Hoodlums",
  ticker: "HOOD",
  description: "The code-running crew.",
  supply: "1000000000",
  decimals: 18,
  chain: "robinhood",
  heroImage: "",
  generatedSiteHtml: null,
  contractAddress: "",
  xHandle: "",
  telegram: "",
  status: "draft",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  resetPublicGeneratedSiteAdapterForTests();
  resetLiveGeneratedSitesAdapterForTests();
});

describe("public generated site repository boundary", () => {
  it("returns no record for any slug by default instead of faking persistence", async () => {
    expect(await getPublicGeneratedSiteBySlug("hoodlums")).toBeNull();
    expect(await getPublicGeneratedSiteBySlug("anything-else")).toBeNull();
  });

  it("still returns null after repeated lookups (no accidental in-memory store)", async () => {
    await getPublicGeneratedSiteBySlug("hoodlums");
    await getPublicGeneratedSiteBySlug("hoodlums");
    expect(await getPublicGeneratedSiteBySlug("hoodlums")).toBeNull();
  });

  it("uses an injected adapter when tests set one", async () => {
    setPublicGeneratedSiteAdapter(async (slug) => (slug === FIXTURE.slug ? FIXTURE : null));
    expect(await getPublicGeneratedSiteBySlug("hoodlums")).toEqual(FIXTURE);
    expect(await getPublicGeneratedSiteBySlug("unknown")).toBeNull();
  });

  it("rejects an injected adapter record whose slug does not match the lookup", async () => {
    setPublicGeneratedSiteAdapter(async () => FIXTURE);
    expect(await getPublicGeneratedSiteBySlug("different-slug")).toBeNull();
  });

  it("restores the no-records default after resetPublicGeneratedSiteAdapterForTests", async () => {
    setPublicGeneratedSiteAdapter(async () => FIXTURE);
    resetPublicGeneratedSiteAdapterForTests();
    expect(await getPublicGeneratedSiteBySlug("hoodlums")).toBeNull();
  });
});

describe("listLiveGeneratedSites", () => {
  it("returns no records by default instead of faking data for the token grid", async () => {
    expect(await listLiveGeneratedSites(24)).toEqual([]);
  });

  it("uses an injected adapter when tests set one", async () => {
    setLiveGeneratedSitesAdapterForTests(async (limit) => [FIXTURE].slice(0, limit));
    expect(await listLiveGeneratedSites(24)).toEqual([FIXTURE]);
    expect(await listLiveGeneratedSites(0)).toEqual([]);
  });

  it("restores the no-records default after resetLiveGeneratedSitesAdapterForTests", async () => {
    setLiveGeneratedSitesAdapterForTests(async () => [FIXTURE]);
    resetLiveGeneratedSitesAdapterForTests();
    expect(await listLiveGeneratedSites(24)).toEqual([]);
  });
});
