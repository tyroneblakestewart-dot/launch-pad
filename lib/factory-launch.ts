import { parseEventLogs, type Address, type Hash, type PublicClient, type WalletClient } from "viem";
import { HOODLUMS_TOKEN_FACTORY_ABI } from "./factory-config";

export type FactoryLaunchArgs = {
  name: string;
  symbol: string;
  wholeTokenSupply: bigint;
  decimals: number;
  recipient: Address;
};

export type FactoryLaunchResult = {
  address: Address;
  transactionHash: Hash;
  feePaid: bigint;
};

/**
 * Launches a token through a deployed HoodlumsTokenFactory: reads the
 * current `launchFee()` immediately before submitting so the transaction
 * always sends the exact fee the contract expects, then resolves the new
 * token address from the `TokenLaunched` event rather than assuming a
 * receipt shape (the factory is the deployer of record, not the caller).
 */
export async function launchTokenViaFactory(
  walletClient: WalletClient,
  publicClient: PublicClient,
  factoryAddress: Address,
  account: Address,
  args: FactoryLaunchArgs,
): Promise<FactoryLaunchResult> {
  const launchFee = await publicClient.readContract({
    address: factoryAddress,
    abi: HOODLUMS_TOKEN_FACTORY_ABI,
    functionName: "launchFee",
  });

  const transactionHash = await walletClient.writeContract({
    account,
    chain: walletClient.chain ?? null,
    address: factoryAddress,
    abi: HOODLUMS_TOKEN_FACTORY_ABI,
    functionName: "launchToken",
    args: [args.name, args.symbol, args.wholeTokenSupply, args.decimals, args.recipient],
    value: launchFee,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });

  const [launchedEvent] = parseEventLogs({
    abi: HOODLUMS_TOKEN_FACTORY_ABI,
    eventName: "TokenLaunched",
    logs: receipt.logs,
  });
  if (!launchedEvent) {
    throw new Error("TokenLaunched event was not found in the transaction receipt.");
  }

  return {
    address: launchedEvent.args.token,
    transactionHash,
    feePaid: launchFee,
  };
}
