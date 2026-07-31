import { describe, expect, it } from "vitest";
import { normaliseTrendingRank } from "@/lib/gmgn-trending";

describe("GMGN Robinhood trending normalisation", () => {
  it("keeps only safe, known market fields from the ranked response", () => {
    const snapshot = normaliseTrendingRank(
      {
        code: 0,
        data: {
          rank: [
            {
              address: "0xabc",
              symbol: "HOOD",
              name: "Hood Test",
              logo: "https://images.example/hood.png",
              market_cap: "1250000",
              liquidity: 240000,
              volume: "81000",
              swaps: 932,
              holder_count: "4120",
              price_change_percent5m: "12.5",
              launchpad_platform: "hoodlums",
              rank: 1,
              ignored_secret_field: "do not copy",
            },
          ],
        },
      },
      1_800_000_000_000,
    );

    expect(snapshot).toEqual({
      chain: "robinhood",
      interval: "5m",
      fetchedAt: "2027-01-15T08:00:00.000Z",
      tokens: [
        {
          address: "0xabc",
          symbol: "HOOD",
          name: "Hood Test",
          logoUrl: "https://images.example/hood.png",
          marketCap: 1_250_000,
          liquidity: 240_000,
          volume5m: 81_000,
          swaps5m: 932,
          holders: 4_120,
          change5m: 12.5,
          launchpad: "hoodlums",
          rank: 1,
        },
      ],
    });
  });

  it("rejects entries without an address and non-https artwork URLs", () => {
    const snapshot = normaliseTrendingRank({
      data: {
        rank: [
          { symbol: "NOADDRESS" },
          {
            address: "0xdef",
            symbol: "SAFE",
            logo: "http://insecure.example/token.png",
          },
        ],
      },
    });

    expect(snapshot.tokens).toHaveLength(1);
    expect(snapshot.tokens[0]).toMatchObject({
      address: "0xdef",
      symbol: "SAFE",
      name: "SAFE",
      logoUrl: null,
    });
  });
});
