import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "./chains";
import type { SupportedChain } from "./types";

export type TradeTerminalId = "gmgn" | "axiom" | "maestro" | "ave";

export type TradeTerminalLink = {
  id: TradeTerminalId;
  label: string;
  url: string;
};

type TerminalDefinition = {
  id: TradeTerminalId;
  label: string;
  /** Chains this terminal is confirmed (per issue #203's research) to support with a referral-coded link. */
  chains: SupportedChain[];
  buildUrl: (address: string, refCode: string) => string;
};

/**
 * Referral codes are PUBLIC config baked into outbound links a visitor's
 * browser follows directly — never secrets, and never confused with the
 * server-only `GMGN_API_KEY` used by `lib/server/robinhood-trending.ts`.
 * Each is read from a `NEXT_PUBLIC_*` var; an unset code degrades every
 * builder below to a plain, un-refcoded link rather than a broken one.
 *
 * URL shapes reflect each platform's commonly documented referral
 * convention; confirm against each platform's current affiliate program
 * before relying on attribution, and adjust the relevant `buildUrl` below
 * if a format has changed — nothing else in this module needs to change.
 */
const TERMINALS: TerminalDefinition[] = [
  {
    id: "gmgn",
    label: "GMGN",
    chains: ["robinhood"],
    buildUrl: (address, ref) => `https://gmgn.ai/robinhood/token/${ref ? `${ref}_` : ""}${address}`,
  },
  {
    id: "axiom",
    label: "Axiom",
    chains: ["robinhood"],
    buildUrl: (address, ref) => `https://axiom.trade/meme/${address}${ref ? `?ref=${ref}` : ""}`,
  },
  {
    id: "maestro",
    label: "Maestro",
    chains: ["robinhood"],
    buildUrl: (address, ref) => `https://t.me/maestro?start=${ref ? `${ref}-` : ""}${address}`,
  },
  {
    id: "ave",
    label: "Ave.ai",
    chains: ["robinhood"],
    buildUrl: (address, ref) => `https://ave.ai/token/${address}-robinhood${ref ? `?ref=${ref}` : ""}`,
  },
];

function readRefCode(envVar: string): string {
  return process.env[envVar]?.trim() || "";
}

// Read per-call (not cached at module load) so tests can set/unset the env
// vars between cases without needing to reset a module cache, matching the
// pattern in `lib/server/robinhood-trending.ts`.
const REF_CODE_ENV_VARS: Record<TradeTerminalId, string> = {
  gmgn: "NEXT_PUBLIC_GMGN_REF_CODE",
  axiom: "NEXT_PUBLIC_AXIOM_REF_CODE",
  maestro: "NEXT_PUBLIC_MAESTRO_REF_CODE",
  ave: "NEXT_PUBLIC_AVE_REF_CODE",
};

/**
 * Trade-terminal links available for a given chain/address, in a fixed
 * display order. Empty for a chain with no confirmed-supporting terminal
 * (e.g. `solana` today) rather than guessing at unconfirmed support.
 *
 * Also network-aware (issue #308): every token page currently switches the
 * connected wallet to Robinhood Chain Testnet (46630), where none of these
 * terminals index or trade anything, so the links stay empty whenever
 * `chainId` is that testnet id. The referral-coded builders above are left
 * untouched so the links populate automatically once callers pass a real
 * Robinhood Chain mainnet id.
 */
export function getTradeTerminalLinks(chain: SupportedChain, address: string, chainId: number): TradeTerminalLink[] {
  if (chain === "robinhood" && chainId === ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL) return [];

  return TERMINALS.filter((terminal) => terminal.chains.includes(chain)).map((terminal) => ({
    id: terminal.id,
    label: terminal.label,
    url: terminal.buildUrl(address, readRefCode(REF_CODE_ENV_VARS[terminal.id])),
  }));
}
