import { afterEach, describe, expect, it } from "vitest";
import {
  getPublicGeneratedSiteBySlug,
  resetPublicGeneratedSiteAdapterForTests,
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

  it("restores the no-records default after resetPublicGeneratedSiteAdapterForTests", async () => {
    setPublicGeneratedSiteAdapter(async () => FIXTURE);
    resetPublicGeneratedSiteAdapterForTests();
    expect(await getPublicGeneratedSiteBySlug("hoodlums")).toBeNull();
  });
});
