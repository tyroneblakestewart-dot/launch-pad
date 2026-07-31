import { describe, expect, it } from "vitest";
import { filterTokensForTab, TOKEN_GRID_TABS } from "@/components/hoodlums-token-grid";
import type { PublicGeneratedSite } from "@/lib/public-site";

function site(slug: string): PublicGeneratedSite {
  return {
    slug,
    name: slug,
    ticker: slug.toUpperCase(),
    description: "",
    supply: "1000000000",
    decimals: 18,
    chain: "robinhood",
    heroImage: "",
    generatedSiteHtml: null,
    contractAddress: "",
    xHandle: "",
    telegram: "",
    status: "launched",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("filterTokensForTab", () => {
  const tokens = Array.from({ length: 12 }, (_, index) => site(`token-${index}`));

  it("lists the tab keys in the order the issue specifies", () => {
    expect(TOKEN_GRID_TABS.map((tab) => tab.key)).toEqual(["bonding", "graduated", "new"]);
  });

  it("shows every live token under the bonding tab (nothing has graduated yet)", () => {
    expect(filterTokensForTab(tokens, "bonding")).toEqual(tokens);
  });

  it("is always empty under graduated since the curve isn't deployed", () => {
    expect(filterTokensForTab(tokens, "graduated")).toEqual([]);
    expect(filterTokensForTab([], "graduated")).toEqual([]);
  });

  it("caps the new tab at the 8 most recently published tokens", () => {
    expect(filterTokensForTab(tokens, "new")).toEqual(tokens.slice(0, 8));
  });

  it("returns an empty list for every tab when there are no live tokens", () => {
    expect(filterTokensForTab([], "bonding")).toEqual([]);
    expect(filterTokensForTab([], "new")).toEqual([]);
  });
});
