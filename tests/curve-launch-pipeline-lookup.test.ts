import { describe, expect, it } from "vitest";
import {
  LaunchLookupError,
  resolvePipelineLaunchByTokenAddress,
  type PipelineLaunchLookupClient,
} from "@/lib/curve-launch-pipeline-lookup";

const PIPELINE = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const CURVE = "0x3333333333333333333333333333333333333333" as const;
const CREATOR = "0x4444444444444444444444444444444444444444" as const;

function makeClient(overrides: {
  logs?: ReadonlyArray<Record<string, unknown>>;
  name?: string;
  symbol?: string;
} = {}): PipelineLaunchLookupClient {
  const logs =
    overrides.logs ??
    [
      {
        args: {
          token: TOKEN,
          curve: CURVE,
          creator: CREATOR,
          wholeTokenSupply: 1_000_000n,
          decimals: 18,
          graduationTarget: 4_000_000_000_000_000_000n,
        },
      },
    ];

  return {
    getLogs: (async () => logs) as PipelineLaunchLookupClient["getLogs"],
    readContract: (async (args: { functionName: string }) => {
      if (args.functionName === "name") return overrides.name ?? "Test Token";
      if (args.functionName === "symbol") return overrides.symbol ?? "TEST";
      throw new Error(`unexpected functionName ${args.functionName}`);
    }) as PipelineLaunchLookupClient["readContract"],
  };
}

describe("resolvePipelineLaunchByTokenAddress", () => {
  it("assembles a record payload from the pipeline's launch event and the token contract", async () => {
    const result = await resolvePipelineLaunchByTokenAddress(makeClient(), PIPELINE, TOKEN);
    expect(result).toEqual({
      tokenAddress: TOKEN,
      curveAddress: CURVE,
      tokenName: "Test Token",
      ticker: "TEST",
      decimals: 18,
      wholeTokenSupply: "1000000",
      graduationTargetWei: 4_000_000_000_000_000_000n,
    });
  });

  it("rejects an invalid token address without calling the chain", async () => {
    const client = makeClient();
    await expect(
      resolvePipelineLaunchByTokenAddress(client, PIPELINE, "not-an-address"),
    ).rejects.toBeInstanceOf(LaunchLookupError);
  });

  it("throws a plain-English error when no launch log is found for the token", async () => {
    const client = makeClient({ logs: [] });
    await expect(resolvePipelineLaunchByTokenAddress(client, PIPELINE, TOKEN)).rejects.toThrow(
      "No curve-backed launch was found for that token address on this pipeline.",
    );
  });

  it("uses the most recent matching log when more than one is returned", async () => {
    const olderCurve = "0x5555555555555555555555555555555555555555";
    const client = makeClient({
      logs: [
        {
          args: {
            token: TOKEN,
            curve: olderCurve,
            creator: CREATOR,
            wholeTokenSupply: 1n,
            decimals: 18,
            graduationTarget: 1n,
          },
        },
        {
          args: {
            token: TOKEN,
            curve: CURVE,
            creator: CREATOR,
            wholeTokenSupply: 1_000_000n,
            decimals: 18,
            graduationTarget: 4_000_000_000_000_000_000n,
          },
        },
      ],
    });
    const result = await resolvePipelineLaunchByTokenAddress(client, PIPELINE, TOKEN);
    expect(result.curveAddress).toBe(CURVE);
  });

  it("normalises a lowercase token address to checksum form before querying logs", async () => {
    const checksummed = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    let queriedToken: unknown;
    const client: PipelineLaunchLookupClient = {
      getLogs: (async (args: { args: { token: unknown } }) => {
        queriedToken = args.args.token;
        return [
          {
            args: {
              token: checksummed,
              curve: CURVE,
              creator: CREATOR,
              wholeTokenSupply: 1_000_000n,
              decimals: 18,
              graduationTarget: 4_000_000_000_000_000_000n,
            },
          },
        ];
      }) as PipelineLaunchLookupClient["getLogs"],
      readContract: (async (args: { functionName: string }) =>
        args.functionName === "name" ? "Test Token" : "TEST") as PipelineLaunchLookupClient["readContract"],
    };

    const result = await resolvePipelineLaunchByTokenAddress(client, PIPELINE, checksummed.toLowerCase());
    expect(queriedToken).toBe(checksummed);
    expect(result.tokenAddress).toBe(checksummed);
  });
});
