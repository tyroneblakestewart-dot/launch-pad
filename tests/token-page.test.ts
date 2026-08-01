import { afterEach, describe, expect, it, vi } from "vitest";
import { notFound } from "next/navigation";
import TokenPage, { generateMetadata } from "@/app/token/[chain]/[address]/page";
import { PublicDexscreenerSection } from "@/components/public-dexscreener-section";
import { TokenHolderStats } from "@/components/token-holder-stats";
import { TokenTradeButtons } from "@/components/token-trade-buttons";

const ADDRESS = "0x3bf7447cd055f1475a8b09090c7b062abc9d3798";

function notFoundDigest(): string {
  try {
    notFound();
  } catch (error) {
    return (error as { digest?: string }).digest || "";
  }
  throw new Error("notFound() did not throw");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(options: { pairs?: unknown[]; holdersOk?: boolean } = {}) {
  const { pairs = [], holdersOk = false } = options;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.dexscreener.com")) {
        return new Response(JSON.stringify({ pairs }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(holdersOk ? JSON.stringify({ items: [] }) : null, {
        status: holdersOk ? 200 : 404,
      });
    }),
  );
}

describe("TokenPage", () => {
  it("renders the chart section, trade buttons and holder stats for a valid Robinhood Chain address", async () => {
    stubFetch();

    const element = await TokenPage({
      params: Promise.resolve({ chain: "robinhood", address: ADDRESS }),
    });
    const children = element.props.children as unknown[];
    // [header, TokenTradeButtons, PublicDexscreenerSection, TokenHolderStats]
    const tradeButtons = children[1] as { type: unknown; props: { links: unknown[] } };
    const chart = children[2] as { type: unknown; props: { address: string } };
    const holders = children[3] as { type: unknown };

    expect(tradeButtons.type).toBe(TokenTradeButtons);
    expect(tradeButtons.props.links.length).toBeGreaterThan(0);
    expect(chart.type).toBe(PublicDexscreenerSection);
    expect(chart.props.address).toBe(ADDRESS);
    expect(holders.type).toBe(TokenHolderStats);
  });

  it("passes the address straight through to the reused Dexscreener chart component (no rebuilt embed logic)", async () => {
    stubFetch({
      pairs: [
        {
          chainId: "robinhood",
          dexId: "uniswap",
          pairAddress: "pair-1",
          url: "https://dexscreener.com/robinhood/pair-1",
          liquidity: { usd: 5_000 },
        },
      ],
    });

    const element = await TokenPage({
      params: Promise.resolve({ chain: "robinhood", address: ADDRESS }),
    });
    const children = element.props.children as unknown[];
    const chart = children[2] as { type: unknown; props: { address: string } };

    expect(chart.type).toBe(PublicDexscreenerSection);
    expect(chart.props.address).toBe(ADDRESS);
  });

  it("shows no trade-terminal buttons for a chain with no confirmed-supporting terminal", async () => {
    stubFetch();

    const element = await TokenPage({
      params: Promise.resolve({ chain: "solana", address: "So11111111111111111111111111111111111111112" }),
    });
    const children = element.props.children as unknown[];
    const tradeButtons = children[1] as { props: { links: unknown[] } };

    expect(tradeButtons.props.links).toEqual([]);
  });

  it("calls notFound() for an unsupported chain segment", async () => {
    const digest = notFoundDigest();

    await expect(
      TokenPage({ params: Promise.resolve({ chain: "ethereum", address: ADDRESS }) }),
    ).rejects.toMatchObject({ digest });
  });

  it("calls notFound() for an invalid address segment", async () => {
    const digest = notFoundDigest();

    await expect(
      TokenPage({ params: Promise.resolve({ chain: "robinhood", address: "short" }) }),
    ).rejects.toMatchObject({ digest });
  });
});

describe("generateMetadata for the token page route", () => {
  it("builds a title and description for a valid chain/address", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ chain: "robinhood", address: ADDRESS }),
    });

    expect(metadata.title).toContain("RHC TEST");
    expect(metadata.description).toContain(ADDRESS);
    expect(metadata.alternates?.canonical).toBe(`https://hoodlums.dev/token/robinhood/${ADDRESS}`);
  });

  it("returns empty metadata for an invalid chain or address instead of crashing", async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ chain: "ethereum", address: ADDRESS }) }),
    ).resolves.toEqual({});
    await expect(
      generateMetadata({ params: Promise.resolve({ chain: "robinhood", address: "short" }) }),
    ).resolves.toEqual({});
  });
});
