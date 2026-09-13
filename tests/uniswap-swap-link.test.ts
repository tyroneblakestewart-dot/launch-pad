// Owner direction, 13 Sep 2026: "how to buy is meant to go to Uniswap with
// the live token address once contracts live". A token trades on its bonding
// curve until graduation, when the curve seeds a locked Uniswap V3 pool — so
// Buy stays on the Hoodlums trade page while bonding (Uniswap has no market
// yet) and goes to the Uniswap app with the token pre-filled once graduated.
// The Uniswap chain slug is an owner-set env value, off by default.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BESPOKE_LINKS_MARKER, substituteBespokePlatformFacts } from "@/lib/bespoke-site-links";
import type { BondingCurveGraduationStatus } from "@/lib/bonding-curve-status";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { substituteFreeSitePlatformFacts } from "@/lib/free-site-platform-facts";
import { resolvePublishedSiteBuyHref } from "@/lib/server/token-buy-venue";
import {
  UNISWAP_SWAP_BASE_URL,
  UNISWAP_SWAP_CHAIN_SLUGS_ENV_VAR,
  buildUniswapSwapUrl,
  parseUniswapSwapChainSlugs,
  readUniswapSwapChainSlugs,
  resolveUniswapSwapUrl,
} from "@/lib/uniswap-swap-link";

const TOKEN = "0x1111111111111111111111111111111111111111";
const CURVE = "0x2222222222222222222222222222222222222222" as const;
const POOL = "0x3333333333333333333333333333333333333333" as const;
const HOODLUMS_TRADE = `https://hoodlums.dev/token/robinhood/${TOKEN}`;
const UNISWAP = `${UNISWAP_SWAP_BASE_URL}?chain=robinhood&outputCurrency=${TOKEN}`;

function status(state: BondingCurveGraduationStatus["state"]): BondingCurveGraduationStatus {
  return state === "graduated"
    ? { state, progressBps: 10_000n, raisedWei: 4n, targetWei: 4n, liquidityPool: POOL }
    : { state, progressBps: 5_000n, raisedWei: 2n, targetWei: 4n, liquidityPool: null };
}

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("Uniswap swap link config", () => {
  it("is off by default: an unset or blank env value yields no slugs and no link", () => {
    expect(parseUniswapSwapChainSlugs(undefined)).toEqual({});
    expect(parseUniswapSwapChainSlugs("")).toEqual({});
    expect(parseUniswapSwapChainSlugs("   ")).toEqual({});
    expect(resolveUniswapSwapUrl("robinhood", TOKEN, {})).toBeNull();
    expect(readUniswapSwapChainSlugs(undefined)).toEqual({});
  });

  it("reads a JSON map of chain key -> slug, lower-casing and trimming", () => {
    expect(parseUniswapSwapChainSlugs('{"robinhood":" Robinhood "}')).toEqual({ robinhood: "robinhood" });
    expect(parseUniswapSwapChainSlugs('{"robinhood":"robinhood","solana":"solana"}')).toEqual({
      robinhood: "robinhood",
      solana: "solana",
    });
  });

  it("drops anything that is not a plain slug for a known chain rather than trusting it", () => {
    expect(parseUniswapSwapChainSlugs("not json")).toEqual({});
    expect(parseUniswapSwapChainSlugs('["robinhood"]')).toEqual({});
    expect(parseUniswapSwapChainSlugs('{"ethereum":"mainnet"}')).toEqual({});
    expect(parseUniswapSwapChainSlugs('{"robinhood":"a b"}')).toEqual({});
    expect(parseUniswapSwapChainSlugs('{"robinhood":"x?y=1"}')).toEqual({});
    expect(parseUniswapSwapChainSlugs('{"robinhood":42}')).toEqual({});
    expect(parseUniswapSwapChainSlugs('{"robinhood":""}')).toEqual({});
  });

  it("builds the Uniswap app swap URL with the token as the output currency", () => {
    expect(buildUniswapSwapUrl("robinhood", ` ${TOKEN} `)).toBe(UNISWAP);
    expect(buildUniswapSwapUrl("robinhood", "   ")).toBe("");
    expect(resolveUniswapSwapUrl("robinhood", TOKEN, { robinhood: "robinhood" })).toBe(UNISWAP);
    expect(resolveUniswapSwapUrl("solana", TOKEN, { robinhood: "robinhood" })).toBeNull();
    expect(resolveUniswapSwapUrl("robinhood", "", { robinhood: "robinhood" })).toBeNull();
  });

  it("reads the static NEXT_PUBLIC literal so the client bundle inlines it, and .env.example documents it", () => {
    const lib = source("lib/uniswap-swap-link.ts");
    expect(lib).toContain("raw: string | undefined = process.env.NEXT_PUBLIC_UNISWAP_SWAP_CHAIN_SLUGS");
    expect(UNISWAP_SWAP_CHAIN_SLUGS_ENV_VAR).toBe("NEXT_PUBLIC_UNISWAP_SWAP_CHAIN_SLUGS");
    expect(source(".env.example")).toContain("NEXT_PUBLIC_UNISWAP_SWAP_CHAIN_SLUGS=");
  });
});

describe("published-site Buy venue (server)", () => {
  it("is a no-op — no curve lookup, no RPC — while no Uniswap slug is configured", async () => {
    const resolveCurveAddress = vi.fn();
    const readProgress = vi.fn();
    await expect(
      resolvePublishedSiteBuyHref({ chain: "robinhood", contractAddress: TOKEN }, { slugs: {}, resolveCurveAddress, readProgress }),
    ).resolves.toBeUndefined();
    expect(resolveCurveAddress).not.toHaveBeenCalled();
    expect(readProgress).not.toHaveBeenCalled();
  });

  it("keeps Buy on the Hoodlums trade page while the token is still bonding or not yet funded", async () => {
    for (const state of ["bonding", "not-funded"] as const) {
      await expect(
        resolvePublishedSiteBuyHref(
          { chain: "robinhood", contractAddress: TOKEN },
          {
            slugs: { robinhood: "robinhood" },
            resolveCurveAddress: async () => CURVE,
            readProgress: async () => status(state),
          },
        ),
      ).resolves.toBeUndefined();
    }
  });

  it("sends Buy to Uniswap with the live token address once the curve reports graduated", async () => {
    const resolveCurveAddress = vi.fn(async () => CURVE);
    const readProgress = vi.fn(async () => status("graduated"));
    await expect(
      resolvePublishedSiteBuyHref(
        { chain: "robinhood", contractAddress: ` ${TOKEN} ` },
        { slugs: { robinhood: "robinhood" }, resolveCurveAddress, readProgress },
      ),
    ).resolves.toBe(UNISWAP);
    expect(resolveCurveAddress).toHaveBeenCalledWith(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN);
    expect(readProgress).toHaveBeenCalledWith(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE);
  });

  it("degrades to the Hoodlums trade page on no contract, another chain, no curve, a null read or a thrown error — never to a Uniswap link", async () => {
    const slugs = { robinhood: "robinhood", solana: "solana" };
    await expect(resolvePublishedSiteBuyHref({ chain: "robinhood", contractAddress: "  " }, { slugs })).resolves.toBeUndefined();
    await expect(resolvePublishedSiteBuyHref({ chain: "solana", contractAddress: TOKEN }, { slugs })).resolves.toBeUndefined();
    await expect(
      resolvePublishedSiteBuyHref(
        { chain: "robinhood", contractAddress: TOKEN },
        { slugs, resolveCurveAddress: async () => null, readProgress: vi.fn() },
      ),
    ).resolves.toBeUndefined();
    await expect(
      resolvePublishedSiteBuyHref(
        { chain: "robinhood", contractAddress: TOKEN },
        { slugs, resolveCurveAddress: async () => CURVE, readProgress: async () => null },
      ),
    ).resolves.toBeUndefined();
    await expect(
      resolvePublishedSiteBuyHref(
        { chain: "robinhood", contractAddress: TOKEN },
        {
          slugs,
          resolveCurveAddress: async () => {
            throw new Error("db down");
          },
        },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("Buy placeholder substitution honours the resolved venue", () => {
  const freeSite = [
    "<!doctype html><html><body>",
    '<!--BUY_KNOWN_START--><a href="{{BUY_HREF}}">Buy</a><!--BUY_KNOWN_END-->',
    '<!--BUY_PENDING_START--><span>Coming soon</span><!--BUY_PENDING_END-->',
    '<!--CHART_TRADE_LINK_START--><a href="{{TRADE_URL}}">Open live chart</a><!--CHART_TRADE_LINK_END-->',
    "</body></html>",
  ].join("");
  const bespoke = `<body>${BESPOKE_LINKS_MARKER}<a href="{{BUY_HREF}}">Buy</a><a href="{{TRADE_URL}}">Trade</a></body>`;

  it("free site: Buy goes to the given venue while the chart link stays on the Hoodlums trade page", () => {
    const html = substituteFreeSitePlatformFacts(freeSite, {
      contractAddress: TOKEN,
      chain: "robinhood",
      chart: { found: false },
      lpLockedAt: null,
      buyHref: UNISWAP,
    });
    expect(html).toContain(`<a href="${UNISWAP.replaceAll("&", "&amp;")}">Buy</a>`);
    expect(html).toContain(`<a href="${HOODLUMS_TRADE}">Open live chart</a>`);
  });

  it("free site: an omitted or blank venue is the pre-existing Hoodlums trade page, and no venue applies before a contract exists", () => {
    for (const buyHref of [undefined, "", "   "]) {
      const html = substituteFreeSitePlatformFacts(freeSite, {
        contractAddress: TOKEN,
        chain: "robinhood",
        chart: { found: false },
        lpLockedAt: null,
        buyHref,
      });
      expect(html).toContain(`<a href="${HOODLUMS_TRADE}">Buy</a>`);
    }
    const pending = substituteFreeSitePlatformFacts(freeSite, {
      contractAddress: "",
      chain: "robinhood",
      chart: { found: false },
      lpLockedAt: null,
      buyHref: UNISWAP,
    });
    expect(pending).toContain("Coming soon");
    expect(pending).not.toContain("uniswap");
  });

  it("bespoke: the same rule — venue for Buy, Hoodlums trade page for Trade, '#' before a contract", () => {
    const out = substituteBespokePlatformFacts(bespoke, { contractAddress: TOKEN, chain: "robinhood", buyHref: UNISWAP });
    expect(out).toContain(`href="${UNISWAP.replaceAll("&", "&amp;")}">Buy`);
    expect(out).toContain(`href="${HOODLUMS_TRADE}">Trade`);
    expect(substituteBespokePlatformFacts(bespoke, { contractAddress: TOKEN, chain: "robinhood" })).toContain(
      `href="${HOODLUMS_TRADE}">Buy`,
    );
    expect(substituteBespokePlatformFacts(bespoke, { contractAddress: "", buyHref: UNISWAP })).toContain('href="#">Buy');
  });
});

describe("wiring", () => {
  it("the served /[slug] page resolves the venue once and passes it to both pipelines", () => {
    const page = source("app/[slug]/page.tsx");
    expect(page).toContain('import { resolvePublishedSiteBuyHref } from "@/lib/server/token-buy-venue";');
    expect(page).toContain("await resolvePublishedSiteBuyHref({ chain: site.chain, contractAddress: site.contractAddress })");
    const bespokeCall = page.slice(page.indexOf("substituteBespokePlatformFacts(site.generatedSiteHtml"));
    expect(bespokeCall.slice(0, bespokeCall.indexOf("});"))).toContain("buyHref,");
    const freeCall = page.slice(page.indexOf("substituteFreeSitePlatformFacts(site.generatedSiteHtml"));
    expect(freeCall.slice(0, freeCall.indexOf("});"))).toContain("buyHref,");
  });

  it("the token page's trading-closed panel offers Swap on Uniswap only when a slug is configured, keeping the pool link", () => {
    const component = source("components/token-page/token-left-column.tsx");
    expect(component).toContain('import { resolveUniswapSwapUrl } from "@/lib/uniswap-swap-link";');
    expect(component).toContain("const uniswapSwapUrl = resolveUniswapSwapUrl(chainId, address);");
    const closed = component.slice(component.indexOf("Trading closed"));
    const panel = closed.slice(0, closed.indexOf("View liquidity pool"));
    expect(panel).toContain("{uniswapSwapUrl && (");
    expect(panel).toContain("Swap on Uniswap ↗");
    expect(closed).toContain("View liquidity pool ↗");
  });

  it("the studio preview keeps the Hoodlums trade page (no graduation knowledge client-side)", () => {
    const studio = source("components/full-website-generator.tsx");
    expect(studio).not.toContain("buyHref");
    expect(studio).not.toContain("uniswap");
  });
});
