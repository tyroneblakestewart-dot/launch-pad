import { isHex, stringToHex, type Address, type Hex } from "viem";

// Pure helpers for scripts/deploy-uniswap-v3-testnet.ts (issue #414). Kept
// free of Hardhat/network/filesystem imports so the bytecode-linking and
// native-currency-label logic can be unit tested directly, mirroring
// lib/bonding-curve-deploy-config.ts and lib/curve-launch-pipeline-config.ts.

export type SolidityLinkReferences = Record<string, Record<string, { start: number; length: number }[]>>;

export const NATIVE_CURRENCY_LABEL_ENV_VAR = "HOODLUMS_UNISWAP_V3_NATIVE_CURRENCY_LABEL";
export const DEFAULT_NATIVE_CURRENCY_LABEL = "ETH";

// solc's standard unlinked-library placeholder: "__$" + a 34-hex-char
// (17-byte) hash of the fully qualified library name + "$__" — exactly 40
// hex characters, the same width as the 20-byte address it gets replaced
// with.
const LIBRARY_PLACEHOLDER_PATTERN = /__\$[0-9a-fA-F]{34}\$__/;

/**
 * Patches solc's standard unlinked-library placeholder bytes in `bytecode`
 * with `libraries`' deployed addresses, per Hardhat/solc's `linkReferences`
 * artifact field (byte offsets counted from the start of the bytecode, not
 * from the "0x" prefix). Needed for NonfungibleTokenPositionDescriptor,
 * which links against the NFTDescriptor library.
 */
export function linkLibraryReferences(
  bytecode: Hex,
  linkReferences: SolidityLinkReferences,
  libraries: Record<string, Address>,
): Hex {
  if (!isHex(bytecode)) {
    throw new Error("linkLibraryReferences expects a 0x-prefixed hex bytecode string.");
  }
  let linked: string = bytecode;
  for (const fileReferences of Object.values(linkReferences)) {
    for (const [libraryName, references] of Object.entries(fileReferences)) {
      const libraryAddress = libraries[libraryName];
      if (!libraryAddress) {
        throw new Error(
          `linkLibraryReferences: no deployed address supplied for library "${libraryName}" ` +
            "referenced in this bytecode's linkReferences.",
        );
      }
      const addressHex = libraryAddress.slice(2).toLowerCase();
      for (const { start, length } of references) {
        const startHexIndex = 2 + start * 2;
        const lengthHexChars = length * 2;
        if (addressHex.length > lengthHexChars) {
          throw new Error(
            `linkLibraryReferences: library "${libraryName}" address is wider than its placeholder slot.`,
          );
        }
        linked =
          linked.slice(0, startHexIndex) +
          addressHex.padStart(lengthHexChars, "0") +
          linked.slice(startHexIndex + lengthHexChars);
      }
    }
  }
  return linked as Hex;
}

/**
 * Whether `bytecode` still contains an unresolved solc library placeholder
 * — i.e. linkLibraryReferences was skipped, or was given the wrong library
 * name and left the real reference untouched. The deploy script checks
 * this immediately before sending the deployment transaction rather than
 * letting a malformed CALL silently deploy broken code.
 */
export function hasUnresolvedLibraryPlaceholder(bytecode: Hex): boolean {
  return LIBRARY_PLACEHOLDER_PATTERN.test(bytecode);
}

/**
 * Encodes a short ASCII currency label (e.g. "ETH") into the left-aligned,
 * zero-right-padded bytes32 that NonfungibleTokenPositionDescriptor's
 * constructor expects for `_nativeCurrencyLabelBytes` — the same encoding
 * ethers' formatBytes32String produces.
 */
export function encodeNativeCurrencyLabel(label: string): Hex {
  if (!label) {
    throw new Error(`${NATIVE_CURRENCY_LABEL_ENV_VAR} must not be empty.`);
  }
  if (!/^[\x00-\x7F]*$/.test(label)) {
    throw new Error(`${NATIVE_CURRENCY_LABEL_ENV_VAR} must be ASCII, got: ${label}`);
  }
  if (label.length > 31) {
    throw new Error(
      `${NATIVE_CURRENCY_LABEL_ENV_VAR} must be 31 characters or fewer (bytes32-encoded), got: ${label}`,
    );
  }
  return stringToHex(label, { size: 32 });
}

type Env = Record<string, string | undefined>;

export interface UniswapV3TestnetDeployConfig {
  nativeCurrencyLabel: string;
  nativeCurrencyLabelBytes: Hex;
}

/**
 * Resolves the one owner-overridable setting for
 * scripts/deploy-uniswap-v3-testnet.ts — everything else about the deploy
 * (which contracts, in which order, pointed at which prior addresses) is
 * fixed by the script itself, not environment-configurable.
 */
export function resolveUniswapV3TestnetDeployConfig(env: Env = process.env): UniswapV3TestnetDeployConfig {
  const nativeCurrencyLabel = env[NATIVE_CURRENCY_LABEL_ENV_VAR] ?? DEFAULT_NATIVE_CURRENCY_LABEL;
  return {
    nativeCurrencyLabel,
    nativeCurrencyLabelBytes: encodeNativeCurrencyLabel(nativeCurrencyLabel),
  };
}
