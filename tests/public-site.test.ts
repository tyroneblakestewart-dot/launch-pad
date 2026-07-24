import { describe, expect, it } from "vitest";
import { buildPublicGeneratedSiteFromProject } from "@/lib/public-site";
import type { TokenProject } from "@/lib/types";

const PROJECT: TokenProject = {
  id: "project-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  status: "prepared",
  chain: "robinhood",
  name: "Hoodlums",
  ticker: "HOOD",
  description: "The code-running crew.",
  supply: "1000000000",
  decimals: 18,
  websiteSlug: "hoodlums",
  contractAddress: "0x3bf7447cd055f1475a8b09090c7b062abc9d3798",
  xHandle: "@hoodlums",
  telegram: "t.me/hoodlums",
  heroImage: "data:image/png;base64,AAAA",
  theme: "hoodlums",
  generatedSiteHtml: "<!doctype html><html></html>",
  generatedSiteVersion: 2,
  generatedSiteVariantId: "editorial-poster",
  generatedSiteVariantLabel: "Editorial Poster",
};

describe("buildPublicGeneratedSiteFromProject", () => {
  it("maps every field the chosen public record needs from a saved project", () => {
    expect(buildPublicGeneratedSiteFromProject(PROJECT)).toEqual({
      slug: "hoodlums",
      name: "Hoodlums",
      ticker: "HOOD",
      description: "The code-running crew.",
      supply: "1000000000",
      decimals: 18,
      chain: "robinhood",
      heroImage: "data:image/png;base64,AAAA",
      generatedSiteHtml: "<!doctype html><html></html>",
      generatedSiteVariantId: "editorial-poster",
      generatedSiteVariantLabel: "Editorial Poster",
      contractAddress: "0x3bf7447cd055f1475a8b09090c7b062abc9d3798",
      xHandle: "@hoodlums",
      telegram: "t.me/hoodlums",
      status: "prepared",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("normalises missing generated design fields to null", () => {
    const result = buildPublicGeneratedSiteFromProject({
      ...PROJECT,
      generatedSiteHtml: undefined,
      generatedSiteVariantId: undefined,
      generatedSiteVariantLabel: undefined,
    });
    expect(result.generatedSiteHtml).toBeNull();
    expect(result.generatedSiteVariantId).toBeNull();
    expect(result.generatedSiteVariantLabel).toBeNull();

    const withNull = buildPublicGeneratedSiteFromProject({
      ...PROJECT,
      generatedSiteHtml: null,
      generatedSiteVariantId: null,
      generatedSiteVariantLabel: null,
    });
    expect(withNull.generatedSiteHtml).toBeNull();
    expect(withNull.generatedSiteVariantId).toBeNull();
    expect(withNull.generatedSiteVariantLabel).toBeNull();
  });
});
