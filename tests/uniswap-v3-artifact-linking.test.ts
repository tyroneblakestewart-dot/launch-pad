import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  DEFAULT_NATIVE_CURRENCY_LABEL,
  NATIVE_CURRENCY_LABEL_ENV_VAR,
  encodeNativeCurrencyLabel,
  hasUnresolvedLibraryPlaceholder,
  linkLibraryReferences,
  normalizeArtifactBytecodeHex,
  resolveUniswapV3TestnetDeployConfig,
  type SolidityLinkReferences,
} from "../lib/uniswap-v3-artifact-linking";

const LIBRARY_ADDRESS: Address = "0x1234567890123456789012345678901234567890";

describe("linkLibraryReferences", () => {
  it("replaces the placeholder slot with the deployed library address, leaving surrounding bytes untouched", () => {
    // "6000" (2 bytes) + a 20-byte placeholder slot + "6001" (2 bytes).
    const bytecode = `0x6000${"00".repeat(20)}6001` as Hex;
    const linkReferences: SolidityLinkReferences = {
      "contracts/Foo.sol": { Bar: [{ start: 2, length: 20 }] },
    };

    const linked = linkLibraryReferences(bytecode, linkReferences, { Bar: LIBRARY_ADDRESS });

    expect(linked).toBe(`0x6000${LIBRARY_ADDRESS.slice(2)}6001`);
  });

  it("links multiple references to the same library", () => {
    const bytecode = `0x${"00".repeat(20)}ff${"00".repeat(20)}` as Hex;
    const linkReferences: SolidityLinkReferences = {
      "contracts/Foo.sol": {
        Bar: [
          { start: 0, length: 20 },
          { start: 21, length: 20 },
        ],
      },
    };

    const linked = linkLibraryReferences(bytecode, linkReferences, { Bar: LIBRARY_ADDRESS });

    expect(linked).toBe(`0x${LIBRARY_ADDRESS.slice(2)}ff${LIBRARY_ADDRESS.slice(2)}`);
  });

  it("throws when no address is supplied for a referenced library", () => {
    const bytecode = `0x${"00".repeat(20)}` as Hex;
    const linkReferences: SolidityLinkReferences = {
      "contracts/Foo.sol": { Bar: [{ start: 0, length: 20 }] },
    };

    expect(() => linkLibraryReferences(bytecode, linkReferences, {})).toThrow(
      /no deployed address supplied for library "Bar"/,
    );
  });

  it("throws on non-hex bytecode", () => {
    expect(() =>
      linkLibraryReferences("not-hex" as Hex, {}, {}),
    ).toThrow(/0x-prefixed hex bytecode/);
  });
});

describe("hasUnresolvedLibraryPlaceholder", () => {
  it("detects an unresolved solc placeholder", () => {
    const placeholder = `__$${"a".repeat(34)}$__`;
    expect(hasUnresolvedLibraryPlaceholder(`0x1234${placeholder}5678` as Hex)).toBe(true);
  });

  it("returns false for fully linked bytecode", () => {
    expect(hasUnresolvedLibraryPlaceholder(`0x${LIBRARY_ADDRESS.slice(2)}` as Hex)).toBe(false);
  });
});

describe("encodeNativeCurrencyLabel", () => {
  it("left-aligns and zero-right-pads a short ASCII label into bytes32", () => {
    expect(encodeNativeCurrencyLabel("ETH")).toMatch(/^0x455448(0{58})$/);
  });

  it("throws on an empty label", () => {
    expect(() => encodeNativeCurrencyLabel("")).toThrow(/must not be empty/);
  });

  it("throws on a non-ASCII label", () => {
    expect(() => encodeNativeCurrencyLabel("€TH")).toThrow(/must be ASCII/);
  });

  it("throws on a label longer than 31 characters", () => {
    expect(() => encodeNativeCurrencyLabel("A".repeat(32))).toThrow(/31 characters or fewer/);
  });
});

describe("normalizeArtifactBytecodeHex", () => {
  it("prepends 0x to unprefixed hex (the @uniswap/v2-periphery WETH9.json shape)", () => {
    expect(normalizeArtifactBytecodeHex("60c06040")).toBe("0x60c06040");
  });

  it("passes already-0x-prefixed hex through unchanged (the Hardhat artifact shape)", () => {
    expect(normalizeArtifactBytecodeHex("0x60c06040")).toBe("0x60c06040");
  });

  it("returns null for non-hex garbage", () => {
    expect(normalizeArtifactBytecodeHex("not-hex")).toBeNull();
    expect(normalizeArtifactBytecodeHex("0xnot-hex")).toBeNull();
  });

  it("returns null for a non-string value", () => {
    expect(normalizeArtifactBytecodeHex(undefined)).toBeNull();
    expect(normalizeArtifactBytecodeHex(1234)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(normalizeArtifactBytecodeHex("")).toBeNull();
  });
});

describe("resolveUniswapV3TestnetDeployConfig", () => {
  it("defaults to ETH when unset", () => {
    const config = resolveUniswapV3TestnetDeployConfig({});
    expect(config.nativeCurrencyLabel).toBe(DEFAULT_NATIVE_CURRENCY_LABEL);
    expect(config.nativeCurrencyLabelBytes).toMatch(/^0x455448(0{58})$/);
  });

  it("respects an override", () => {
    const config = resolveUniswapV3TestnetDeployConfig({ [NATIVE_CURRENCY_LABEL_ENV_VAR]: "RBH" });
    expect(config.nativeCurrencyLabel).toBe("RBH");
  });

  it("propagates validation errors from an invalid override", () => {
    expect(() =>
      resolveUniswapV3TestnetDeployConfig({ [NATIVE_CURRENCY_LABEL_ENV_VAR]: "" }),
    ).toThrow(/must not be empty/);
  });
});
