import { afterEach, describe, expect, it, vi } from "vitest";
import { notFound } from "next/navigation";
import TokenPage, { generateMetadata } from "@/app/token/[chain]/[address]/page";
import { TokenPageView, type TokenPageViewProps } from "@/components/token-page/token-page-view";
import { BONDING_CURVE_ADDRESSES_ENV_VAR } from "@/lib/bonding-curve-config";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import {
  resetTokenLaunchesStoreForTests,
  setTokenLaunchesStoreForTests,
  type TokenLaunch,
  type TokenLaunchesStore,
} from "@/lib/server/token-launches-store";

const ADDRESS = "0x3bf7447cd055f1475a8b09090c7b062abc9d3798";
const CURVE_ADDRESS = "0x1234567890123456789012345678901234567890";
const ORIGINAL_CURVE_ENV = process.env[BONDING_CURVE_ADDRESSES_ENV_VAR];

afterEach(() => {
  vi.unstubAllGlobals();
  resetTokenLaunchesStoreForTests();
  if (ORIGINAL_CURVE_ENV === undefined) delete process.env[BONDING_CURVE_ADDRESSES_ENV_VAR];
  else process.env[BONDING_CURVE_ADDRESSES_ENV_VAR] = ORIGINAL_CURVE_ENV;
});

function fakeLaunchesStore(overrides: Partial<TokenLaunchesStore> = {}): TokenLaunchesStore {
  return {
    async record() {
      throw new Error("not used");
    },
    async list() {
      return [];
    },
    async listForAdmin() {
      return [];
    },
    async findByTokenAddress() {
      return null;
    },
    async markGraduated() {},
    async countLast24h() {
      return 0;
    },
    async tableExists() {
      return true;
    },
    ...overrides,
  };
}

function notFoundDigest(): string {
  try {
    notFound();
  } catch (error) {
    return (error as { digest?: string }).digest || "";
  }
  throw new Error("notFound() did not throw");
}

function stubFetch(options: { pairs?: unknown[]; dataOk?: boolean } = {}) {
  const { pairs = [], dataOk = false } = options;
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
      return new Response(dataOk ? JSON.stringify({ items: [] }) : null, { status: dataOk ? 200 : 404 });
    }),
  );
}

async function renderTokenPage(chain: string, address: string): Promise<TokenPageViewProps> {
  const element = await TokenPage({ params: Promise.resolve({ chain, address }) });
  if (element.type !== TokenPageView) throw new Error("expected TokenPage to render TokenPageView");
  return element.props as TokenPageViewProps;
}

describe("TokenPage", () => {
  it("renders TokenPageView with chain, address and chainInfo", async () => {
    stubFetch();
    delete process.env[BONDING_CURVE_ADDRESSES_ENV_VAR];

    const props = await renderTokenPage("robinhood", ADDRESS);

    expect(props.chain).toBe("robinhood");
    expect(props.address).toBe(ADDRESS);
    expect(props.chainInfo.shortLabel).toBe("RHC TEST");
  });

  it("returns no trade-terminal links while the page still operates on testnet 46630 (issue #308)", async () => {
    stubFetch();

    const props = await renderTokenPage("robinhood", ADDRESS);

    expect(props.tradeLinks).toEqual([]);
  });

  it("has chart: passes a found chart and non-null liquidity through from a live Dexscreener pair", async () => {
    stubFetch({
      pairs: [
        {
          chainId: "robinhood",
          dexId: "uniswap",
          pairAddress: "0xpair1",
          url: "https://dexscreener.com/robinhood/pair-1",
          liquidity: { usd: 5_000 },
        },
      ],
    });

    const props = await renderTokenPage("robinhood", ADDRESS);

    expect(props.marketStats).toMatchObject({ supported: true, liquidityUsd: 5_000 });
    if (!props.marketStats.supported) throw new Error("expected supported market stats");
    expect(props.marketStats.chart).toMatchObject({ found: true });
  });

  it("no liquidity: passes an unfound chart and null liquidity when no Dexscreener pair exists yet", async () => {
    stubFetch({ pairs: [] });

    const props = await renderTokenPage("robinhood", ADDRESS);

    expect(props.marketStats).toMatchObject({ supported: true, liquidityUsd: null, chart: { found: false } });
  });

  it("no curve configured: passes a null curveAddress when the bonding-curve env var is unset", async () => {
    stubFetch();
    delete process.env[BONDING_CURVE_ADDRESSES_ENV_VAR];

    const props = await renderTokenPage("robinhood", ADDRESS);

    expect(props.curveAddress).toBeNull();
  });

  it("passes the configured curve address through when one is set for Robinhood Chain Testnet", async () => {
    stubFetch();
    process.env[BONDING_CURVE_ADDRESSES_ENV_VAR] = JSON.stringify({
      [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: CURVE_ADDRESS,
    });

    const props = await renderTokenPage("robinhood", ADDRESS);

    expect(props.curveAddress).toBe(CURVE_ADDRESS);
  });

  it("prefers the curve recorded in token_launches for this token over the legacy env var (issue #412 Part 2)", async () => {
    stubFetch();
    process.env[BONDING_CURVE_ADDRESSES_ENV_VAR] = JSON.stringify({
      [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: CURVE_ADDRESS,
    });
    const recordedCurve = `0x${"9".repeat(40)}`;
    setTokenLaunchesStoreForTests(
      fakeLaunchesStore({
        findByTokenAddress: async () =>
          ({
            id: "id-1",
            chainId: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
            tokenAddress: ADDRESS,
            curveAddress: recordedCurve,
            creatorWalletAddress: "0x4444444444444444444444444444444444444444",
            tokenName: "Test",
            ticker: "TEST",
            decimals: 18,
            wholeTokenSupply: "1000000",
            graduationTargetWei: "4000000000000000000",
            graduated: false,
            graduatedAt: null,
            launchedAt: new Date().toISOString(),
          }) satisfies TokenLaunch,
      }),
    );

    const props = await renderTokenPage("robinhood", ADDRESS);

    expect(props.curveAddress).toBe(recordedCurve);
  });

  it("never configures a curve for a non-EVM chain, and reports unsupported market stats", async () => {
    stubFetch();
    process.env[BONDING_CURVE_ADDRESSES_ENV_VAR] = JSON.stringify({
      [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: CURVE_ADDRESS,
    });

    const props = await renderTokenPage("solana", "So11111111111111111111111111111111111111112");

    expect(props.curveAddress).toBeNull();
    expect(props.marketStats).toEqual({ supported: false });
    expect(props.tradeLinks).toEqual([]);
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
