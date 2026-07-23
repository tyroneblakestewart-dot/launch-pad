import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "./chains";

// Mirrors the public interface of contracts/HoodlumsTokenFactory.sol
// (Ownable2Step + ReentrancyGuard), solc 0.8.24, optimizer runs=200.
export const HOODLUMS_TOKEN_FACTORY_ABI = [
  {
    type: "constructor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "initialOwner", type: "address", internalType: "address" },
      { name: "initialFeeRecipient", type: "address", internalType: "address" },
      { name: "initialLaunchFee", type: "uint256", internalType: "uint256" },
    ],
  },
  {
    type: "receive",
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "MAX_LAUNCH_FEE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
  },
  {
    type: "function",
    name: "acceptOwnership",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "creatorLaunchAt",
    stateMutability: "view",
    inputs: [
      { name: "creator", type: "address", internalType: "address" },
      { name: "index", type: "uint256", internalType: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct HoodlumsTokenFactory.LaunchRecord",
        components: [
          { name: "token", type: "address", internalType: "address" },
          { name: "creator", type: "address", internalType: "address" },
          { name: "recipient", type: "address", internalType: "address" },
          { name: "wholeTokenSupply", type: "uint256", internalType: "uint256" },
          { name: "feePaid", type: "uint256", internalType: "uint256" },
          { name: "launchedAt", type: "uint64", internalType: "uint64" },
          { name: "decimals", type: "uint8", internalType: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "creatorLaunchCount",
    stateMutability: "view",
    inputs: [{ name: "creator", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
  },
  {
    type: "function",
    name: "feeRecipient",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
  },
  {
    type: "function",
    name: "isFactoryToken",
    stateMutability: "view",
    inputs: [{ name: "", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
  },
  {
    type: "function",
    name: "launchAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct HoodlumsTokenFactory.LaunchRecord",
        components: [
          { name: "token", type: "address", internalType: "address" },
          { name: "creator", type: "address", internalType: "address" },
          { name: "recipient", type: "address", internalType: "address" },
          { name: "wholeTokenSupply", type: "uint256", internalType: "uint256" },
          { name: "feePaid", type: "uint256", internalType: "uint256" },
          { name: "launchedAt", type: "uint64", internalType: "uint64" },
          { name: "decimals", type: "uint8", internalType: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "launchCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
  },
  {
    type: "function",
    name: "launchFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
  },
  {
    type: "function",
    name: "launchToken",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string", internalType: "string" },
      { name: "symbol", type: "string", internalType: "string" },
      { name: "wholeTokenSupply", type: "uint256", internalType: "uint256" },
      { name: "decimals", type: "uint8", internalType: "uint8" },
      { name: "recipient", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "tokenAddress", type: "address", internalType: "address" }],
  },
  {
    type: "function",
    name: "launches",
    stateMutability: "view",
    inputs: [{ name: "", type: "address", internalType: "address" }],
    outputs: [
      { name: "token", type: "address", internalType: "address" },
      { name: "creator", type: "address", internalType: "address" },
      { name: "recipient", type: "address", internalType: "address" },
      { name: "wholeTokenSupply", type: "uint256", internalType: "uint256" },
      { name: "feePaid", type: "uint256", internalType: "uint256" },
      { name: "launchedAt", type: "uint64", internalType: "uint64" },
      { name: "decimals", type: "uint8", internalType: "uint8" },
    ],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
  },
  {
    type: "function",
    name: "pendingOwner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
  },
  {
    type: "function",
    name: "renounceOwnership",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "setFeeRecipient",
    stateMutability: "nonpayable",
    inputs: [{ name: "newRecipient", type: "address", internalType: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setLaunchFee",
    stateMutability: "nonpayable",
    inputs: [{ name: "newFee", type: "uint256", internalType: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "transferOwnership",
    stateMutability: "nonpayable",
    inputs: [{ name: "newOwner", type: "address", internalType: "address" }],
    outputs: [],
  },
  {
    type: "event",
    name: "FeeRecipientUpdated",
    inputs: [
      { name: "previousRecipient", type: "address", indexed: true, internalType: "address" },
      { name: "newRecipient", type: "address", indexed: true, internalType: "address" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LaunchFeeUpdated",
    inputs: [
      { name: "previousFee", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "newFee", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "OwnershipTransferStarted",
    inputs: [
      { name: "previousOwner", type: "address", indexed: true, internalType: "address" },
      { name: "newOwner", type: "address", indexed: true, internalType: "address" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "OwnershipTransferred",
    inputs: [
      { name: "previousOwner", type: "address", indexed: true, internalType: "address" },
      { name: "newOwner", type: "address", indexed: true, internalType: "address" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TokenLaunched",
    inputs: [
      { name: "launchIndex", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "token", type: "address", indexed: true, internalType: "address" },
      { name: "creator", type: "address", indexed: true, internalType: "address" },
      { name: "recipient", type: "address", indexed: false, internalType: "address" },
      { name: "wholeTokenSupply", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "decimals", type: "uint8", indexed: false, internalType: "uint8" },
      { name: "feePaid", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "DirectPaymentNotAccepted",
    inputs: [],
  },
  {
    type: "error",
    name: "FeeTransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "IncorrectLaunchFee",
    inputs: [
      { name: "expected", type: "uint256", internalType: "uint256" },
      { name: "received", type: "uint256", internalType: "uint256" },
    ],
  },
  {
    type: "error",
    name: "InvalidAddress",
    inputs: [],
  },
  {
    type: "error",
    name: "LaunchFeeTooHigh",
    inputs: [
      { name: "requested", type: "uint256", internalType: "uint256" },
      { name: "maximum", type: "uint256", internalType: "uint256" },
    ],
  },
  {
    type: "error",
    name: "LaunchIndexOutOfBounds",
    inputs: [],
  },
  {
    type: "error",
    name: "OwnableInvalidOwner",
    inputs: [{ name: "owner", type: "address", internalType: "address" }],
  },
  {
    type: "error",
    name: "OwnableUnauthorizedAccount",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
  },
] as const;

/**
 * The frontend reads deployed factory addresses from a single env var so a new
 * deployment (or a redeploy on another chain) never requires a code change:
 *
 *   NEXT_PUBLIC_HOODLUMS_FACTORY_ADDRESSES={"46630":"0xYourDeployedAddress"}
 *
 * The value is public JSON, safe to expose to the browser. Entries in this
 * env var override the public defaults below for the same chain id, which
 * lets a fork or local deployment point at a different factory without a
 * code change.
 */
export const FACTORY_ADDRESSES_ENV_VAR = "NEXT_PUBLIC_HOODLUMS_FACTORY_ADDRESSES";

export type FactoryAddressMap = Partial<Record<number, `0x${string}`>>;

/**
 * Publicly known factory deployments, baked in so the production build works
 * without requiring every deployer to set the env var above. See README.md
 * "Factory deployment" for deployment details (owner, treasury, fee).
 */
export const DEFAULT_FACTORY_ADDRESSES: FactoryAddressMap = {
  [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: "0x39207baa4d0a30a5194770563ec586978c9fbcb3",
};

function isHexAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Parses the raw env var value into a chainId -> factory address map.
 * Malformed JSON, non-object shapes, and individual invalid entries are
 * dropped rather than thrown, since this runs at module load / render time.
 */
export function parseFactoryAddressMap(raw: string | undefined): FactoryAddressMap {
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

  const map: FactoryAddressMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const chainId = Number(key);
    if (!Number.isInteger(chainId) || chainId <= 0) continue;
    if (!isHexAddress(value)) continue;
    map[chainId] = value;
  }
  return map;
}

/**
 * Reads the deployed factory address for a given chain id: an env var
 * override takes priority, falling back to the public default deployment
 * for that chain (if any). Pass `env` explicitly in tests; defaults to
 * `process.env`.
 */
export function getFactoryAddress(
  chainId: number,
  env: Record<string, string | undefined> = process.env,
): `0x${string}` | undefined {
  const fromEnv = parseFactoryAddressMap(env[FACTORY_ADDRESSES_ENV_VAR])[chainId];
  return fromEnv ?? DEFAULT_FACTORY_ADDRESSES[chainId];
}

/** Convenience accessor for the chain this factory is being prepared for. */
export function getRobinhoodTestnetFactoryAddress(
  env: Record<string, string | undefined> = process.env,
): `0x${string}` | undefined {
  return getFactoryAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, env);
}
