import { describe, expect, it } from "vitest";
import {
  verifyTokenLaunchOnChain,
  type TokenLaunchVerifyClient,
  type VerifyTokenLaunchInput,
} from "@/lib/server/token-launch-reconciliation";

const TOKEN = "0x1111111111111111111111111111111111111111";
const CURVE = "0x2222222222222222222222222222222222222222";
const CREATOR = "0x3333333333333333333333333333333333333333";

const VALID_INPUT: VerifyTokenLaunchInput = {
  chainId: 46630,
  tokenAddress: TOKEN,
  curveAddress: CURVE,
  creatorWalletAddress: CREATOR,
  tokenName: "Test Token",
  ticker: "TEST",
  decimals: 18,
  wholeTokenSupply: "1000000",
  graduationTargetWei: "4000000000000000000",
};

type ReadContractCall = { address: string; functionName: string };

function makeClient(overrides: Partial<Record<string, unknown>> = {}): TokenLaunchVerifyClient {
  const defaults: Record<string, unknown> = {
    token: TOKEN,
    creator: CREATOR,
    graduationTarget: 4000000000000000000n,
    name: "Test Token",
    symbol: "TEST",
    decimals: 18,
    totalSupply: 1000000n * 10n ** 18n,
  };
  const values = { ...defaults, ...overrides };
  return {
    readContract: (async (args: ReadContractCall) => {
      if (!(args.functionName in values)) throw new Error(`unexpected functionName ${args.functionName}`);
      return values[args.functionName];
    }) as TokenLaunchVerifyClient["readContract"],
  };
}

describe("verifyTokenLaunchOnChain", () => {
  it("accepts a launch whose on-chain reads exactly match the claim", async () => {
    const result = await verifyTokenLaunchOnChain(VALID_INPUT, { client: makeClient() });
    expect(result).toEqual({ ok: true });
  });

  it("rejects an unsupported chain without making any RPC call", async () => {
    const result = await verifyTokenLaunchOnChain(
      { ...VALID_INPUT, chainId: 10143 },
      { client: makeClient() },
    );
    expect(result.ok).toBe(false);
  });

  it("rejects malformed addresses", async () => {
    const result = await verifyTokenLaunchOnChain(
      { ...VALID_INPUT, tokenAddress: "not-an-address" },
      { client: makeClient() },
    );
    expect(result.ok).toBe(false);
  });

  it("rejects when the curve is wired to a different token", async () => {
    const result = await verifyTokenLaunchOnChain(VALID_INPUT, {
      client: makeClient({ token: "0x9999999999999999999999999999999999999999" }),
    });
    expect(result).toEqual({ ok: false, reason: "The curve is not wired to the claimed token address." });
  });

  it("rejects when the curve's creator doesn't match the wallet recording the launch", async () => {
    const result = await verifyTokenLaunchOnChain(VALID_INPUT, {
      client: makeClient({ creator: "0x9999999999999999999999999999999999999999" }),
    });
    expect(result).toEqual({ ok: false, reason: "The curve's creator does not match the wallet recording this launch." });
  });

  it("rejects when the claimed graduation target doesn't match the curve's", async () => {
    const result = await verifyTokenLaunchOnChain(VALID_INPUT, {
      client: makeClient({ graduationTarget: 1n }),
    });
    expect(result).toEqual({ ok: false, reason: "The curve's graduation target does not match the claimed value." });
  });

  it("rejects when the on-chain token name doesn't match", async () => {
    const result = await verifyTokenLaunchOnChain(VALID_INPUT, {
      client: makeClient({ name: "Different Name" }),
    });
    expect(result).toEqual({ ok: false, reason: "The token's on-chain name does not match the claimed name." });
  });

  it("accepts a case-insensitive ticker match", async () => {
    const result = await verifyTokenLaunchOnChain(VALID_INPUT, {
      client: makeClient({ symbol: "test" }),
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects when the on-chain ticker doesn't match", async () => {
    const result = await verifyTokenLaunchOnChain(VALID_INPUT, {
      client: makeClient({ symbol: "OTHER" }),
    });
    expect(result).toEqual({ ok: false, reason: "The token's on-chain ticker does not match the claimed ticker." });
  });

  it("rejects when the on-chain decimals don't match", async () => {
    const result = await verifyTokenLaunchOnChain(VALID_INPUT, {
      client: makeClient({ decimals: 6 }),
    });
    expect(result).toEqual({ ok: false, reason: "The token's on-chain decimals do not match the claimed decimals." });
  });

  it("rejects when the on-chain total supply doesn't match wholeTokenSupply * 10**decimals", async () => {
    const result = await verifyTokenLaunchOnChain(VALID_INPUT, {
      client: makeClient({ totalSupply: 1n }),
    });
    expect(result).toEqual({ ok: false, reason: "The token's on-chain total supply does not match the claimed supply." });
  });

  it("fails closed when the curve contract read throws (e.g. it doesn't exist yet)", async () => {
    const client: TokenLaunchVerifyClient = {
      readContract: (async () => {
        throw new Error("no code at address");
      }) as TokenLaunchVerifyClient["readContract"],
    };
    const result = await verifyTokenLaunchOnChain(VALID_INPUT, { client });
    expect(result).toEqual({ ok: false, reason: "Could not read the curve contract on-chain. It may not exist yet." });
  });
});
