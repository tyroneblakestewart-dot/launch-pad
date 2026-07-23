// Deploys HoodlumsTokenFactory to Robinhood Chain Testnet.
//
// This script never runs on its own and is never invoked by CI or the app —
// see README.md "Factory deployment" for the exact command. It does not
// accept, read, or print a private key directly: the deployer key comes from
// hardhat.config.ts's `robinhoodTestnet` network via configVariable(), which
// Hardhat resolves from HOODLUMS_FACTORY_DEPLOYER_PRIVATE_KEY at run time.
import hre, { network } from "hardhat";
import { createPublicClient, createWalletClient, custom, isAddress, type Address, type Hex } from "viem";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "../lib/chains";

const LAUNCH_FEE = 0n;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireAddress(name: string): Address {
  const value = requireEnv(name);
  if (!isAddress(value)) {
    throw new Error(`${name} must be a valid 0x address, got: ${value}`);
  }
  return value;
}

async function main() {
  const ownerAddress = requireAddress("HOODLUMS_FACTORY_OWNER_ADDRESS");
  const treasuryAddress = requireAddress("HOODLUMS_FACTORY_TREASURY_ADDRESS");

  const artifact = await hre.artifacts.readArtifact("HoodlumsTokenFactory");
  // The npm script invokes `hardhat run --network robinhoodTestnet`, which
  // already selects the network; `network.create()` (no args) picks that
  // CLI-selected network up. `network.connect("robinhoodTestnet")` is
  // deprecated and would open a second, redundant connection.
  const connection = await network.create();

  const chain = {
    id: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
    name: "Robinhood Chain Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [] as string[] } },
  } as const;

  const transport = custom(connection.provider);
  const walletClient = createWalletClient({ chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  const [deployer] = await walletClient.getAddresses();
  if (!deployer) {
    throw new Error(
      "No deployer account resolved from HOODLUMS_FACTORY_DEPLOYER_PRIVATE_KEY. " +
        "Set it in the environment before running this script.",
    );
  }

  console.log(`Deploying HoodlumsTokenFactory to Robinhood Chain Testnet (chain id ${ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL})`);
  console.log(`  Deployer: ${deployer}`);
  console.log(`  Owner:    ${ownerAddress}`);
  console.log(`  Treasury: ${treasuryAddress}`);
  console.log(`  Launch fee: ${LAUNCH_FEE.toString()} (zero, per this deployment)`);

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as Hex,
    account: deployer,
    chain,
    args: [ownerAddress, treasuryAddress, LAUNCH_FEE],
  });
  console.log(`Deployment transaction submitted: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error("Deployment receipt did not include a contract address.");
  }

  console.log("");
  console.log("HoodlumsTokenFactory deployed:");
  console.log(`  Address:  ${receipt.contractAddress}`);
  console.log(`  Chain ID: ${ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL}`);
  console.log("");
  console.log("Constructor arguments (for explorer verification):");
  console.log(`  initialOwner:        ${ownerAddress}`);
  console.log(`  initialFeeRecipient: ${treasuryAddress}`);
  console.log(`  initialLaunchFee:    ${LAUNCH_FEE.toString()}`);
  console.log("");
  console.log("Once verified, add the address to NEXT_PUBLIC_HOODLUMS_FACTORY_ADDRESSES, e.g.:");
  console.log(`  {"${ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL}":"${receipt.contractAddress}"}`);

  await connection.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
