import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hash } from "viem";
import { HOODLUMS_TOKEN_FACTORY_ABI } from "../lib/factory-config";
import { launchTokenViaFactory } from "../lib/factory-launch";

const FACTORY_ADDRESS = "0x1111111111111111111111111111111111111111" as Address;
const ACCOUNT = "0x2222222222222222222222222222222222222222" as Address;
const TOKEN_ADDRESS = "0x3333333333333333333333333333333333333333" as Address;
const TRANSACTION_HASH = `0x${"4".repeat(64)}` as Hash;

const TOKEN_LAUNCHED_EVENT = HOODLUMS_TOKEN_FACTORY_ABI.find(
  (item) => item.type === "event" && item.name === "TokenLaunched",
);

// Builds a real (topics/data) log for the TokenLaunched event so the test
// exercises the actual viem decoding path in launchTokenViaFactory, rather
// than mocking decoding away.
function buildTokenLaunchedLog(overrides: { token?: Address } = {}) {
  const token = overrides.token ?? TOKEN_ADDRESS;
  const topics = encodeEventTopics({
    abi: [TOKEN_LAUNCHED_EVENT],
    eventName: "TokenLaunched",
    args: { launchIndex: 0n, token, creator: ACCOUNT },
  });
  const data = encodeAbiParameters(
    [
      { name: "recipient", type: "address" },
      { name: "wholeTokenSupply", type: "uint256" },
      { name: "decimals", type: "uint8" },
      { name: "feePaid", type: "uint256" },
    ],
    [ACCOUNT, 1_000_000n, 18, 0n],
  );
  return { address: FACTORY_ADDRESS, topics, data };
}

describe("launchTokenViaFactory", () => {
  it("reads launchFee immediately before submitting and sends exactly that value with launchToken", async () => {
    const launchFee = 12345n;
    const readContract = vi.fn().mockResolvedValue(launchFee);
    const writeContract = vi.fn().mockResolvedValue(TRANSACTION_HASH);
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({
      logs: [buildTokenLaunchedLog()],
    });

    const publicClient = { readContract, waitForTransactionReceipt } as never;
    const walletClient = { writeContract, chain: undefined } as never;

    const result = await launchTokenViaFactory(
      walletClient,
      publicClient,
      FACTORY_ADDRESS,
      ACCOUNT,
      {
        name: "Hoodlums Test",
        symbol: "HOODT",
        wholeTokenSupply: 1_000_000n,
        decimals: 18,
        recipient: ACCOUNT,
      },
    );

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: FACTORY_ADDRESS, functionName: "launchFee" }),
    );

    // The fee must be read before the write is submitted, and the write
    // must carry exactly that fee as its value - not a hardcoded amount.
    expect(readContract.mock.invocationCallOrder[0]).toBeLessThan(
      writeContract.mock.invocationCallOrder[0],
    );
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        account: ACCOUNT,
        address: FACTORY_ADDRESS,
        functionName: "launchToken",
        args: ["Hoodlums Test", "HOODT", 1_000_000n, 18, ACCOUNT],
        value: launchFee,
      }),
    );

    expect(result).toEqual({
      address: TOKEN_ADDRESS,
      transactionHash: TRANSACTION_HASH,
      feePaid: launchFee,
    });
  });

  it("sends a different exact fee when the factory reports a different launchFee", async () => {
    const launchFee = 999_000_000_000_000n;
    const writeContract = vi.fn().mockResolvedValue(TRANSACTION_HASH);
    const publicClient = {
      readContract: vi.fn().mockResolvedValue(launchFee),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        logs: [buildTokenLaunchedLog()],
      }),
    } as never;
    const walletClient = { writeContract, chain: undefined } as never;

    await launchTokenViaFactory(walletClient, publicClient, FACTORY_ADDRESS, ACCOUNT, {
      name: "Hoodlums Test",
      symbol: "HOODT",
      wholeTokenSupply: 1_000_000n,
      decimals: 18,
      recipient: ACCOUNT,
    });

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ value: launchFee }),
    );
  });

  it("resolves the launched token address from the TokenLaunched event, not a guessed receipt field", async () => {
    const distinctToken = "0x9999999999999999999999999999999999999999" as Address;
    const publicClient = {
      readContract: vi.fn().mockResolvedValue(0n),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        logs: [buildTokenLaunchedLog({ token: distinctToken })],
      }),
    } as never;
    const walletClient = {
      writeContract: vi.fn().mockResolvedValue(TRANSACTION_HASH),
      chain: undefined,
    } as never;

    const result = await launchTokenViaFactory(
      walletClient,
      publicClient,
      FACTORY_ADDRESS,
      ACCOUNT,
      {
        name: "Hoodlums Test",
        symbol: "HOODT",
        wholeTokenSupply: 1n,
        decimals: 18,
        recipient: ACCOUNT,
      },
    );

    expect(result.address).toBe(distinctToken);
  });

  it("throws when the receipt does not contain a TokenLaunched event", async () => {
    const publicClient = {
      readContract: vi.fn().mockResolvedValue(0n),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ logs: [] }),
    } as never;
    const walletClient = {
      writeContract: vi.fn().mockResolvedValue(TRANSACTION_HASH),
      chain: undefined,
    } as never;

    await expect(
      launchTokenViaFactory(walletClient, publicClient, FACTORY_ADDRESS, ACCOUNT, {
        name: "Hoodlums Test",
        symbol: "HOODT",
        wholeTokenSupply: 1n,
        decimals: 18,
        recipient: ACCOUNT,
      }),
    ).rejects.toThrow(/TokenLaunched/);
  });
});
