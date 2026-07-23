import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Log } from "viem";
import { HOODLUMS_TOKEN_FACTORY_ABI } from "../lib/factory-config";
import type { TokenProject } from "../lib/types";
import {
  deployDirect,
  deployViaFactory,
  type DeployClients,
} from "../components/robinhood-testnet-deployment-controller";

const ROOT = process.cwd();

const FACTORY_ADDRESS = "0x1234567890123456789012345678901234567890" as Address;
const RECIPIENT = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;
const LAUNCHED_TOKEN = `0x${"0".repeat(34)}c0ffee` as Address;
const TX_HASH = `0x${"a".repeat(64)}` as `0x${string}`;

const project: TokenProject = {
  id: "proj-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  status: "draft",
  chain: "robinhood",
  name: "Hoodlums Test Token",
  ticker: "hdlm",
  description: "",
  supply: "1000000",
  decimals: 18,
  websiteSlug: "",
  contractAddress: "",
  xHandle: "",
  telegram: "",
  heroImage: "",
} as TokenProject;

function tokenLaunchedLog(token: Address, feePaid: bigint): Log {
  const topics = encodeEventTopics({
    abi: HOODLUMS_TOKEN_FACTORY_ABI,
    eventName: "TokenLaunched",
    args: { launchIndex: 0n, token, creator: RECIPIENT },
  });
  const data = encodeAbiParameters(
    [
      { name: "recipient", type: "address" },
      { name: "wholeTokenSupply", type: "uint256" },
      { name: "decimals", type: "uint8" },
      { name: "feePaid", type: "uint256" },
    ],
    [RECIPIENT, BigInt(project.supply), project.decimals, feePaid],
  );

  return {
    address: FACTORY_ADDRESS,
    topics,
    data,
    blockHash: `0x${"1".repeat(64)}` as `0x${string}`,
    blockNumber: 1n,
    logIndex: 0,
    removed: false,
    transactionHash: TX_HASH,
    transactionIndex: 0,
  } as unknown as Log;
}

describe("HoodlumsTokenFactory launch path", () => {
  it("reads launchFee() immediately before submitting and sends exactly that value with launchToken()", async () => {
    const launchFee = 4_200_000_000_000n;
    const readContract = vi.fn().mockResolvedValue(launchFee);
    const writeContract = vi.fn().mockResolvedValue(TX_HASH);
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({
      logs: [tokenLaunchedLog(LAUNCHED_TOKEN, launchFee)],
    });

    const clients = {
      account: RECIPIENT,
      walletClient: { writeContract } as unknown as DeployClients["walletClient"],
      publicClient: { readContract, waitForTransactionReceipt } as unknown as DeployClients["publicClient"],
    } satisfies DeployClients;

    const onStatus = vi.fn();
    const result = await deployViaFactory(FACTORY_ADDRESS, project, clients, onStatus);

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: FACTORY_ADDRESS, functionName: "launchFee" }),
    );
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FACTORY_ADDRESS,
        functionName: "launchToken",
        args: [
          project.name.trim(),
          project.ticker.trim().toUpperCase(),
          BigInt(project.supply),
          project.decimals,
          RECIPIENT,
        ],
        value: launchFee,
      }),
    );
    expect(result.contractAddress.toLowerCase()).toBe(LAUNCHED_TOKEN.toLowerCase());
    expect(result.transactionHash).toBe(TX_HASH);
  });

  it("resolves the launched token address from the TokenLaunched event, not the transaction receipt", async () => {
    const launchFee = 0n;
    const readContract = vi.fn().mockResolvedValue(launchFee);
    const writeContract = vi.fn().mockResolvedValue(TX_HASH);
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({
      logs: [tokenLaunchedLog(LAUNCHED_TOKEN, launchFee)],
    });

    const clients = {
      account: RECIPIENT,
      walletClient: { writeContract } as unknown as DeployClients["walletClient"],
      publicClient: { readContract, waitForTransactionReceipt } as unknown as DeployClients["publicClient"],
    } satisfies DeployClients;

    const result = await deployViaFactory(FACTORY_ADDRESS, project, clients, vi.fn());
    expect(result.contractAddress.toLowerCase()).toBe(LAUNCHED_TOKEN.toLowerCase());
  });

  it("throws instead of silently succeeding when no TokenLaunched event is found", async () => {
    const readContract = vi.fn().mockResolvedValue(0n);
    const writeContract = vi.fn().mockResolvedValue(TX_HASH);
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({ logs: [] });

    const clients = {
      account: RECIPIENT,
      walletClient: { writeContract } as unknown as DeployClients["walletClient"],
      publicClient: { readContract, waitForTransactionReceipt } as unknown as DeployClients["publicClient"],
    } satisfies DeployClients;

    await expect(deployViaFactory(FACTORY_ADDRESS, project, clients, vi.fn())).rejects.toThrow(
      "TokenLaunched",
    );
  });
});

describe("direct-deploy fallback (no factory configured)", () => {
  it("deploys FixedSupplyMemeToken directly and resolves the address from the receipt", async () => {
    const deployContract = vi.fn().mockResolvedValue(TX_HASH);
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({
      contractAddress: LAUNCHED_TOKEN,
    });

    const clients = {
      account: RECIPIENT,
      walletClient: { deployContract } as unknown as DeployClients["walletClient"],
      publicClient: { waitForTransactionReceipt } as unknown as DeployClients["publicClient"],
    } satisfies DeployClients;

    const result = await deployDirect(project, clients, vi.fn());

    expect(deployContract).toHaveBeenCalledWith(
      expect.objectContaining({
        account: RECIPIENT,
        args: [
          project.name.trim(),
          project.ticker.trim().toUpperCase(),
          BigInt(project.supply),
          project.decimals,
          RECIPIENT,
        ],
      }),
    );
    expect(result).toEqual({ contractAddress: LAUNCHED_TOKEN, transactionHash: TX_HASH });
  });
});

describe("/testnet deploy routing wiring", () => {
  it("picks the factory path when a factory address is configured, and falls back to direct deploy otherwise", async () => {
    const source = await readFile(
      path.join(ROOT, "components", "robinhood-testnet-deployment-controller.tsx"),
      "utf8",
    );

    expect(source).toContain(
      "const factoryAddress = getFactoryAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL);",
    );
    expect(source).toContain(
      "factoryAddress\n        ? await deployViaFactory(factoryAddress, project, clients, setStatus)\n        : await deployDirect(project, clients, setStatus);",
    );
  });
});
