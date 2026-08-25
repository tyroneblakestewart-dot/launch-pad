import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isHex, type Address, type Hex } from "viem";
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

  it("links the real NonfungibleTokenPositionDescriptor artifact's NFTDescriptor placeholder end to end", () => {
    const requireFromHere = createRequire(import.meta.url);
    const artifactPath = requireFromHere.resolve(
      "@uniswap/v3-periphery/artifacts/contracts/NonfungibleTokenPositionDescriptor.sol/NonfungibleTokenPositionDescriptor.json",
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      bytecode: string;
      linkReferences: SolidityLinkReferences;
    };
    const dummyLibraryAddress = `0x${"11".repeat(20)}` as Address;

    const linked = linkLibraryReferences(artifact.bytecode as Hex, artifact.linkReferences, {
      NFTDescriptor: dummyLibraryAddress,
    });

    expect(isHex(linked, { strict: true })).toBe(true);
    expect(hasUnresolvedLibraryPlaceholder(linked)).toBe(false);
    expect(linked.length).toBe(artifact.bytecode.length);
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

describe("normalizeArtifactBytecodeHex", () => {
  it("accepts unprefixed hex and returns it 0x-prefixed", () => {
    expect(normalizeArtifactBytecodeHex("60c06040")).toBe("0x60c06040");
  });

  it("passes already-0x-prefixed hex through unchanged", () => {
    expect(normalizeArtifactBytecodeHex("0x60c06040")).toBe("0x60c06040");
  });

  it("accepts 0x-prefixed hex containing one solc library placeholder, returned unchanged with the placeholder intact", () => {
    const placeholder = `__$${"a".repeat(34)}$__`;
    const bytecode = `0x1234${placeholder}5678`;
    expect(normalizeArtifactBytecodeHex(bytecode)).toBe(bytecode);
  });

  it("accepts unprefixed hex containing a placeholder, returned 0x-prefixed with the placeholder intact", () => {
    const placeholder = `__$${"a".repeat(34)}$__`;
    const bytecode = `1234${placeholder}5678`;
    expect(normalizeArtifactBytecodeHex(bytecode)).toBe(`0x${bytecode}`);
  });

  it("rejects a placeholder with the wrong inner length", () => {
    const badPlaceholder = `__$${"a".repeat(33)}$__`;
    expect(normalizeArtifactBytecodeHex(`0x1234${badPlaceholder}5678`)).toBeNull();
  });

  it("rejects a placeholder with non-hex inner content", () => {
    const badPlaceholder = `__$${"z".repeat(34)}$__`;
    expect(normalizeArtifactBytecodeHex(`0x1234${badPlaceholder}5678`)).toBeNull();
  });

  it("rejects non-hex garbage", () => {
    expect(normalizeArtifactBytecodeHex("not hex at all")).toBeNull();
    expect(normalizeArtifactBytecodeHex("0xnot-hex")).toBeNull();
  });

  it("rejects a non-string value", () => {
    expect(normalizeArtifactBytecodeHex(undefined)).toBeNull();
    expect(normalizeArtifactBytecodeHex(null)).toBeNull();
    expect(normalizeArtifactBytecodeHex(123)).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(normalizeArtifactBytecodeHex("")).toBeNull();
  });

  it("accepts every real artifact file scripts/deploy-uniswap-v3-testnet.ts loads", () => {
    const requireFromHere = createRequire(import.meta.url);
    const artifactPaths = [
      "@uniswap/v2-periphery/build/WETH9.json",
      "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json",
      "@uniswap/v3-periphery/artifacts/contracts/libraries/NFTDescriptor.sol/NFTDescriptor.json",
      "@uniswap/v3-periphery/artifacts/contracts/NonfungibleTokenPositionDescriptor.sol/NonfungibleTokenPositionDescriptor.json",
      "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json",
    ];

    for (const specifier of artifactPaths) {
      const resolvedPath = requireFromHere.resolve(specifier);
      const artifact = JSON.parse(readFileSync(resolvedPath, "utf8")) as Record<string, unknown>;
      const normalized = normalizeArtifactBytecodeHex(artifact.bytecode);
      expect(normalized, `${specifier} should normalize to valid hex bytecode`).not.toBeNull();
      expect(normalized).toMatch(/^0x[0-9a-fA-F$_]+$/);
    }
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
