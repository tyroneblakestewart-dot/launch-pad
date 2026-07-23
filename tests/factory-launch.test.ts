import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Log } from "viem";
import { HOODLUMS_TOKEN_FACTORY_ABI } from "../lib/factory-config";
import { extractLaunchedTokenAddress } from "../lib/factory-launch";

const FACTORY_ADDRESS: Address = "0x39207baa4d0a30a5194770563ec586978c9fbcb3";
const TOKEN_ADDRESS: Address = "0x1111111111111111111111111111111111111111";
const OTHER_TOKEN_ADDRESS: Address = "0x4444444444444444444444444444444444444444";
const CREATOR_ADDRESS: Address = "0x2222222222222222222222222222222222222222";
const RECIPIENT_ADDRESS: Address = "0x3333333333333333333333333333333333333333";

function buildTokenLaunchedLog(token: Address, launchIndex = 0n): Log {
  const topics = encodeEventTopics({
    abi: HOODLUMS_TOKEN_FACTORY_ABI,
    eventName: "TokenLaunched",
    args: { launchIndex, token, creator: CREATOR_ADDRESS },
  });
  const data = encodeAbiParameters(
    [
      { name: "recipient", type: "address" },
      { name: "wholeTokenSupply", type: "uint256" },
      { name: "decimals", type: "uint8" },
      { name: "feePaid", type: "uint256" },
    ],
    [RECIPIENT_ADDRESS, 1_000_000n, 18, 0n],
  );

  return {
    address: FACTORY_ADDRESS,
    blockHash: `0x${"a".repeat(64)}`,
    blockNumber: 1n,
    data,
    logIndex: 0,
    transactionHash: `0x${"b".repeat(64)}`,
    transactionIndex: 0,
    removed: false,
    topics,
  } as Log;
}

describe("extractLaunchedTokenAddress", () => {
  it("decodes the created token address from a TokenLaunched log", () => {
    const log = buildTokenLaunchedLog(TOKEN_ADDRESS);
    expect(extractLaunchedTokenAddress([log])).toBe(TOKEN_ADDRESS);
  });

  it("returns undefined when no log matches the TokenLaunched signature", () => {
    const unrelated: Log = {
      ...buildTokenLaunchedLog(TOKEN_ADDRESS),
      topics: [`0x${"c".repeat(64)}`],
    };
    expect(extractLaunchedTokenAddress([unrelated])).toBeUndefined();
  });

  it("returns undefined for an empty logs array", () => {
    expect(extractLaunchedTokenAddress([])).toBeUndefined();
  });

  it("picks the first TokenLaunched log when a receipt has several logs", () => {
    const first = buildTokenLaunchedLog(TOKEN_ADDRESS, 0n);
    const second = buildTokenLaunchedLog(OTHER_TOKEN_ADDRESS, 1n);
    expect(extractLaunchedTokenAddress([first, second])).toBe(TOKEN_ADDRESS);
  });
});
