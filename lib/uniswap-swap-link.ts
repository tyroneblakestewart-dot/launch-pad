import type { SupportedChain } from "@/lib/types";

/**
 * Uniswap swap deep links for graduated tokens (owner direction, 13 Sep
 * 2026: "how to buy is meant to go to Uniswap with the live token address
 * once contracts live").
 *
 * A Hoodlums token trades on its bonding curve until graduation, when the
 * curve seeds a permanently locked Uniswap V3 pool
 * (contracts/HoodlumsTestBondingCurve.sol). Before that moment Uniswap has
 * no market for the token, so the only honest Buy destination is the
 * token's Hoodlums trade page; after it, the honest destination is the
 * Uniswap app itself with the token pre-filled — which is what this module
 * builds.
 *
 * The Uniswap web app pre-fills a swap from URL query parameters
 * (`chain`, `outputCurrency`; the input currency defaults to the chain's
 * native currency). The value the app expects for `chain` is the network's
 * own slug in Uniswap's interface, and Uniswap's docs could not be read from
 * the session that wrote this (the same egress block
 * docs/uniswap-robinhood-chain.md hit), so the slug is an owner-set public
 * env value rather than a guess:
 *
 *   NEXT_PUBLIC_UNISWAP_SWAP_CHAIN_SLUGS={"robinhood":"<slug>"}
 *
 * Unset (the default, and the right value while the "robinhood" chain key
 * still means Robinhood Chain Testnet, which the Uniswap app does not list)
 * means no Uniswap link is ever built and Buy keeps pointing at the token's
 * Hoodlums trade page even after graduation — the pre-existing behaviour.
 * Turning it on is an owner decision, not a code change (rule 3).
 */
export const UNISWAP_SWAP_CHAIN_SLUGS_ENV_VAR = "NEXT_PUBLIC_UNISWAP_SWAP_CHAIN_SLUGS";

export const UNISWAP_SWAP_BASE_URL = "https://app.uniswap.org/swap";

const SUPPORTED_CHAINS: readonly SupportedChain[] = ["robinhood", "solana"];
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export type UniswapSwapChainSlugs = Partial<Record<SupportedChain, string>>;

/**
 * Parses the JSON map of chain key -> Uniswap interface chain slug. Anything
 * malformed — not JSON, not an object, an unknown chain key, a slug that is
 * not a plain lowercase token — is dropped rather than trusted, so a typo in
 * Vercel can never put an unexpected string into a link.
 */
export function parseUniswapSwapChainSlugs(raw: string | undefined | null): UniswapSwapChainSlugs {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const slugs: UniswapSwapChainSlugs = {};
  for (const chain of SUPPORTED_CHAINS) {
    const value = (parsed as Record<string, unknown>)[chain];
    if (typeof value !== "string") continue;
    const slug = value.trim().toLowerCase();
    if (SLUG_PATTERN.test(slug)) slugs[chain] = slug;
  }
  return slugs;
}

/**
 * The configured slugs. The default argument is the static
 * `process.env.NEXT_PUBLIC_…` literal on purpose: Next.js inlines that
 * exact expression into client bundles at build time (the token page's
 * trading-closed panel is a client component), while a dynamic
 * `env[name]` lookup would read `undefined` in the browser.
 */
export function readUniswapSwapChainSlugs(
  raw: string | undefined = process.env.NEXT_PUBLIC_UNISWAP_SWAP_CHAIN_SLUGS,
): UniswapSwapChainSlugs {
  return parseUniswapSwapChainSlugs(raw);
}

/** The Uniswap app swap URL with the token pre-filled as the output currency. */
export function buildUniswapSwapUrl(slug: string, tokenAddress: string): string {
  const address = tokenAddress.trim();
  if (!address) return "";
  const params = new URLSearchParams({ chain: slug, outputCurrency: address });
  return `${UNISWAP_SWAP_BASE_URL}?${params.toString()}`;
}

/**
 * The Uniswap swap link for a token on `chain`, or `null` when no slug is
 * configured for that chain (or the address is blank). Callers decide
 * whether the token has actually graduated; this only answers "where would
 * Uniswap be, if so".
 */
export function resolveUniswapSwapUrl(
  chain: SupportedChain,
  tokenAddress: string,
  slugs: UniswapSwapChainSlugs = readUniswapSwapChainSlugs(),
): string | null {
  const slug = slugs[chain];
  if (!slug) return null;
  const url = buildUniswapSwapUrl(slug, tokenAddress);
  return url || null;
}
