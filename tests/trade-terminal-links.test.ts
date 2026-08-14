import { afterEach, describe, expect, it } from "vitest";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getTradeTerminalLinks } from "@/lib/trade-terminal-links";

const ENV_VARS = [
  "NEXT_PUBLIC_GMGN_REF_CODE",
  "NEXT_PUBLIC_AXIOM_REF_CODE",
  "NEXT_PUBLIC_MAESTRO_REF_CODE",
  "NEXT_PUBLIC_AVE_REF_CODE",
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_VARS.map((key) => [key, process.env[key]]));
const ADDRESS = "0x3bf7447cd055f1475a8b09090c7b062abc9d3798";
const MAINNET_CHAIN_ID = 999999;

afterEach(() => {
  for (const key of ENV_VARS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

describe("getTradeTerminalLinks", () => {
  it("returns GMGN, Axiom, Maestro and Ave.ai links for a Robinhood Chain address on a mainnet chain id", () => {
    for (const key of ENV_VARS) delete process.env[key];

    const links = getTradeTerminalLinks("robinhood", ADDRESS, MAINNET_CHAIN_ID);

    expect(links.map((link) => link.id)).toEqual(["gmgn", "axiom", "maestro", "ave"]);
    expect(links.every((link) => link.url.includes(ADDRESS))).toBe(true);
  });

  it("bakes each platform's configured referral code into its link", () => {
    process.env.NEXT_PUBLIC_GMGN_REF_CODE = "hoodlums-gmgn";
    process.env.NEXT_PUBLIC_AXIOM_REF_CODE = "hoodlums-axiom";
    process.env.NEXT_PUBLIC_MAESTRO_REF_CODE = "hoodlums-maestro";
    process.env.NEXT_PUBLIC_AVE_REF_CODE = "hoodlums-ave";

    const links = getTradeTerminalLinks("robinhood", ADDRESS, MAINNET_CHAIN_ID);
    const byId = Object.fromEntries(links.map((link) => [link.id, link.url]));

    expect(byId.gmgn).toBe(`https://gmgn.ai/robinhood/token/hoodlums-gmgn_${ADDRESS}`);
    expect(byId.axiom).toBe(`https://axiom.trade/meme/${ADDRESS}?ref=hoodlums-axiom`);
    expect(byId.maestro).toBe(`https://t.me/maestro?start=hoodlums-maestro-${ADDRESS}`);
    expect(byId.ave).toBe(`https://ave.ai/token/${ADDRESS}-robinhood?ref=hoodlums-ave`);
  });

  it("degrades to a plain, un-refcoded link when no code is configured", () => {
    for (const key of ENV_VARS) delete process.env[key];

    const links = getTradeTerminalLinks("robinhood", ADDRESS, MAINNET_CHAIN_ID);
    const gmgn = links.find((link) => link.id === "gmgn");

    expect(gmgn?.url).toBe(`https://gmgn.ai/robinhood/token/${ADDRESS}`);
    expect(links.some((link) => link.url.includes("undefined"))).toBe(false);
  });

  it("returns no links for a chain with no confirmed-supporting terminal", () => {
    expect(getTradeTerminalLinks("solana", ADDRESS, MAINNET_CHAIN_ID)).toEqual([]);
  });

  it("returns no links for Robinhood Chain while operating on the testnet chain id (issue #308)", () => {
    const links = getTradeTerminalLinks("robinhood", ADDRESS, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL);

    expect(links).toEqual([]);
  });

  it("populates links again once a non-testnet Robinhood Chain id is passed", () => {
    const links = getTradeTerminalLinks("robinhood", ADDRESS, MAINNET_CHAIN_ID);

    expect(links.length).toBe(4);
  });
});
