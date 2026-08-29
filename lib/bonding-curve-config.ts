import { parseAbi } from "viem";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "./chains";

/**
 * Minimal read-only slice of contracts/HoodlumsTestBondingCurve.sol's public
 * interface: only the state needed to render graduation progress/status in
 * the UI (not-funded / bonding / graduated, plus the locked pool address).
 * Trading (buy/sell/withdrawFees) is out of scope for this read-only view.
 */
export const HOODLUMS_BONDING_CURVE_READ_ABI = parseAbi([
  "function funded() view returns (bool)",
  "function graduated() view returns (bool)",
  "function realNativeReserve() view returns (uint256)",
  "function graduationTarget() view returns (uint256)",
  "function liquidityPool() view returns (address)",
]);

/**
 * Trading slice of contracts/HoodlumsTestBondingCurve.sol's public interface,
 * kept separate from `HOODLUMS_BONDING_CURVE_READ_ABI` (which is locked to
 * exactly the read-only graduation-status fields by
 * tests/bonding-curve-config.test.ts). Used by the token page's swap panel
 * (issue #225) to confirm which token a configured curve trades
 * (`token()`), quote a trade before submitting it, and submit the wallet-
 * signed buy/sell itself. `quoteSellFee` and `remainingNativeToGraduate`
 * were added for issue #412 Part 2's honest fee breakdown and graduation
 * clamp — a sell's fee depends on the curve's current virtual reserves
 * (not something the client can derive from `quoteSell`'s net-of-fee
 * output alone), so it's read directly rather than re-derived client-side;
 * a buy's fee is a pure function of its gross input and is instead computed
 * with lib/bonding-curve-fee-math.ts's `tradingFee()`, with no extra call.
 */
export const HOODLUMS_BONDING_CURVE_TRADE_ABI = parseAbi([
  "function token() view returns (address)",
  "function quoteBuy(uint256 grossNativeIn) view returns (uint256 tokensOut)",
  "function quoteSell(uint256 tokensIn) view returns (uint256 nativeOut)",
  "function quoteSellFee(uint256 tokensIn) view returns (uint256)",
  "function remainingNativeToGraduate() view returns (uint256)",
  "function buy(uint256 minTokensOut, uint256 deadline) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minNativeOut, uint256 deadline) returns (uint256 nativeOut)",
]);

/**
 * Fee-claim slice of the contract, kept separate from the trade ABI above
 * since it's used by a distinct piece of UI — the creator fee panel (issue
 * #412 Part 2) — gated on the connected wallet being the curve's creator,
 * not on trading state.
 */
export const HOODLUMS_BONDING_CURVE_FEES_ABI = parseAbi([
  "function creator() view returns (address)",
  "function claimableFees(address recipient) view returns (uint256 amount)",
  "function withdrawFees() returns (uint256 amount)",
]);

/**
 * Minimal ERC-20 slice needed to sell curve tokens: `sell()` pulls tokens via
 * `transferFrom`, so the swap panel must read/raise the curve's allowance
 * before calling it. `totalSupply` was added for issue #443 part 1's market
 * cap figure (last price × total supply).
 */
export const ERC20_MIN_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

/**
 * Read-only slice for the token page's header band (issue #443 part 1),
 * kept separate from `HOODLUMS_BONDING_CURVE_READ_ABI` (locked to exactly
 * the graduation-status fields by tests/bonding-curve-config.test.ts) and
 * from `HOODLUMS_BONDING_CURVE_TRADE_ABI`/`HOODLUMS_BONDING_CURVE_FEES_ABI`
 * (each locked the same way by tests/bonding-curve-trade-config.test.ts).
 * The header band reads its own independent copy of curve state — rather
 * than sharing components/token-page/token-left-column.tsx's swap-panel
 * state — since this issue scopes the swap panel as "unchanged internally";
 * `initialVirtualTokenReserve`/`initialVirtualEthReserve` (for the
 * pre-first-trade starting price) and `creator` (for the DROP ART
 * creator check) are the two fields no other ABI slice already exposes.
 */
export const HOODLUMS_BONDING_CURVE_HEADER_ABI = parseAbi([
  "function token() view returns (address)",
  "function funded() view returns (bool)",
  "function graduated() view returns (bool)",
  "function realNativeReserve() view returns (uint256)",
  "function graduationTarget() view returns (uint256)",
  "function liquidityPool() view returns (address)",
  "function remainingNativeToGraduate() view returns (uint256)",
  "function creator() view returns (address)",
  "function initialVirtualTokenReserve() view returns (uint256)",
  "function initialVirtualEthReserve() view returns (uint256)",
]);

/**
 * The frontend reads a deployed bonding-curve address from a single env var,
 * mirroring FACTORY_ADDRESSES_ENV_VAR / getFactoryAddress in
 * lib/factory-config.ts, so wiring a newly deployed curve into the UI never
 * requires a code change:
 *
 *   NEXT_PUBLIC_HOODLUMS_BONDING_CURVE_ADDRESSES={"46630":"0xYourDeployedCurve"}
 *
 * The value is public JSON, safe to expose to the browser. Unlike the
 * factory, there is no public default yet — per README.md "Bonding curve
 * deployment (drill)" the curve is not deployed on any live network, so an
 * unset/empty env var means no curve is configured for that chain and the
 * UI must show a "not deployed" state rather than guessing an address.
 */
export const BONDING_CURVE_ADDRESSES_ENV_VAR = "NEXT_PUBLIC_HOODLUMS_BONDING_CURVE_ADDRESSES";

export type BondingCurveAddressMap = Partial<Record<number, `0x${string}`>>;

function isHexAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Parses the raw env var value into a chainId -> bonding curve address map.
 * Malformed JSON, non-object shapes, and individual invalid entries are
 * dropped rather than thrown, since this runs at module load / render time.
 */
export function parseBondingCurveAddressMap(raw: string | undefined): BondingCurveAddressMap {
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const map: BondingCurveAddressMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const chainId = Number(key);
    if (!Number.isInteger(chainId) || chainId <= 0) continue;
    if (!isHexAddress(value)) continue;
    map[chainId] = value;
  }
  return map;
}

/**
 * Reads the deployed bonding-curve address for a given chain id from
 * NEXT_PUBLIC_HOODLUMS_BONDING_CURVE_ADDRESSES. Pass `env` explicitly in
 * tests; defaults to `process.env`. Returns `undefined` when no curve is
 * configured for that chain — callers must treat that as "not deployed yet",
 * not as an error.
 */
export function getBondingCurveAddress(
  chainId: number,
  env: Record<string, string | undefined> = process.env,
): `0x${string}` | undefined {
  return parseBondingCurveAddressMap(env[BONDING_CURVE_ADDRESSES_ENV_VAR])[chainId];
}

/** Convenience accessor for the chain the reference curve deployment drill targets. */
export function getRobinhoodTestnetBondingCurveAddress(
  env: Record<string, string | undefined> = process.env,
): `0x${string}` | undefined {
  return getBondingCurveAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, env);
}
