import { createPublicClient, getAddress, http, parseAbi } from "viem";
import { ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";

// Server-side on-chain verification for a claimed token launch (Milestone A,
// issue #409 Part 2). A wallet-signed POST /api/token-launches request only
// proves who is asking; this module independently re-derives the same facts
// from a live chain read before the row is ever inserted, so a row can never
// exist for a launch that didn't really happen (per the issue's own "read
// the chain server-side to verify before inserting" option — chosen over
// indexing the factory's events, because HoodlumsCurveLaunchPipeline
// deliberately bypasses HoodlumsTokenFactory entirely, see
// contracts/HoodlumsCurveLaunchPipeline.sol's top comment, so there is no
// factory event to index for this launch path; a direct read of the curve
// and token contracts is simpler than standing up log indexing for a single
// new event and is just as authoritative, at the cost of one extra RPC round
// trip per launch — acceptable at testnet launch volume).

const CURVE_VERIFY_ABI = parseAbi([
  "function token() view returns (address)",
  "function creator() view returns (address)",
  "function graduationTarget() view returns (uint256)",
]);

const TOKEN_VERIFY_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);

const VERIFY_TIMEOUT_MS = 10_000;

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), VERIFY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type VerifyTokenLaunchInput = {
  chainId: number;
  tokenAddress: string;
  curveAddress: string;
  creatorWalletAddress: string;
  tokenName: string;
  ticker: string;
  decimals: number;
  wholeTokenSupply: string;
  graduationTargetWei: string;
};

export type VerifyTokenLaunchResult = { ok: true } | { ok: false; reason: string };

/** Minimal slice of viem's PublicClient this module needs — narrow enough to stub with a plain object in tests. */
export type TokenLaunchVerifyClient = {
  readContract: ReturnType<typeof createPublicClient>["readContract"];
};

export type VerifyTokenLaunchDeps = {
  client?: TokenLaunchVerifyClient;
};

function robinhoodTestnetPublicClient() {
  const rpcUrl = ROBINHOOD_TESTNET.rpcUrls[0];
  return createPublicClient({
    chain: {
      id: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
      name: "Robinhood Chain Testnet",
      nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl),
  });
}

/**
 * Confirms a claimed launch by reading the curve and token contracts
 * directly, rather than trusting the request body. Only Robinhood Chain
 * Testnet is supported today — the only chain with a curve/token RPC read
 * configured anywhere server-side (see lib/server/admin-operations.ts's
 * money snapshot for the same pattern).
 */
export async function verifyTokenLaunchOnChain(
  input: VerifyTokenLaunchInput,
  deps: VerifyTokenLaunchDeps = {},
): Promise<VerifyTokenLaunchResult> {
  if (input.chainId !== ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL) {
    return { ok: false, reason: "Only Robinhood Chain Testnet launches can be verified today." };
  }

  let claimedToken: `0x${string}`;
  let claimedCurve: `0x${string}`;
  let claimedCreator: `0x${string}`;
  try {
    claimedToken = getAddress(input.tokenAddress);
    claimedCurve = getAddress(input.curveAddress);
    claimedCreator = getAddress(input.creatorWalletAddress);
  } catch {
    return { ok: false, reason: "The token, curve, or creator address is not a valid EVM address." };
  }

  const client = deps.client ?? robinhoodTestnetPublicClient();

  let onChainToken: `0x${string}`;
  let onChainCreator: `0x${string}`;
  let onChainGraduationTarget: bigint;
  try {
    [onChainToken, onChainCreator, onChainGraduationTarget] = await withTimeout(
      Promise.all([
        client.readContract({ address: claimedCurve, abi: CURVE_VERIFY_ABI, functionName: "token" }),
        client.readContract({ address: claimedCurve, abi: CURVE_VERIFY_ABI, functionName: "creator" }),
        client.readContract({ address: claimedCurve, abi: CURVE_VERIFY_ABI, functionName: "graduationTarget" }),
      ]),
      "Timed out reading the curve contract.",
    );
  } catch {
    return { ok: false, reason: "Could not read the curve contract on-chain. It may not exist yet." };
  }

  if (getAddress(onChainToken) !== claimedToken) {
    return { ok: false, reason: "The curve is not wired to the claimed token address." };
  }
  if (getAddress(onChainCreator) !== claimedCreator) {
    return { ok: false, reason: "The curve's creator does not match the wallet recording this launch." };
  }
  let claimedGraduationTargetWei: bigint;
  try {
    claimedGraduationTargetWei = BigInt(input.graduationTargetWei);
  } catch {
    return { ok: false, reason: "The graduation target is not a valid amount." };
  }
  if (onChainGraduationTarget !== claimedGraduationTargetWei) {
    return { ok: false, reason: "The curve's graduation target does not match the claimed value." };
  }

  let onChainName: string;
  let onChainSymbol: string;
  let onChainDecimals: number;
  let onChainTotalSupply: bigint;
  try {
    [onChainName, onChainSymbol, onChainDecimals, onChainTotalSupply] = await withTimeout(
      Promise.all([
        client.readContract({ address: claimedToken, abi: TOKEN_VERIFY_ABI, functionName: "name" }),
        client.readContract({ address: claimedToken, abi: TOKEN_VERIFY_ABI, functionName: "symbol" }),
        client.readContract({ address: claimedToken, abi: TOKEN_VERIFY_ABI, functionName: "decimals" }),
        client.readContract({ address: claimedToken, abi: TOKEN_VERIFY_ABI, functionName: "totalSupply" }),
      ]),
      "Timed out reading the token contract.",
    );
  } catch {
    return { ok: false, reason: "Could not read the token contract on-chain. It may not exist yet." };
  }

  if (onChainName !== input.tokenName) {
    return { ok: false, reason: "The token's on-chain name does not match the claimed name." };
  }
  if (onChainSymbol.toUpperCase() !== input.ticker.toUpperCase()) {
    return { ok: false, reason: "The token's on-chain ticker does not match the claimed ticker." };
  }
  if (onChainDecimals !== input.decimals) {
    return { ok: false, reason: "The token's on-chain decimals do not match the claimed decimals." };
  }

  let claimedWholeSupply: bigint;
  try {
    claimedWholeSupply = BigInt(input.wholeTokenSupply);
  } catch {
    return { ok: false, reason: "The whole-token supply is not a valid integer." };
  }
  const expectedTotalSupply = claimedWholeSupply * 10n ** BigInt(input.decimals);
  if (onChainTotalSupply !== expectedTotalSupply) {
    return { ok: false, reason: "The token's on-chain total supply does not match the claimed supply." };
  }

  return { ok: true };
}
