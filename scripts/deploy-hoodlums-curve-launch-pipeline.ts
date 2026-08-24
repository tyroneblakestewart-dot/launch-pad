// Deploys HoodlumsCurveLaunchPipeline to Robinhood Chain Testnet.
//
// This script never runs on its own and is never invoked by CI or the app —
// see README.md "Curve launch pipeline deployment" for the exact command. It
// does not accept, read, or print a private key directly: the deployer key
// comes from hardhat.config.ts's `robinhoodTestnetCurveLaunchPipelineDeploy`
// network via configVariable(), which Hardhat resolves from
// HOODLUMS_CURVE_LAUNCH_PIPELINE_DEPLOYER_PRIVATE_KEY at run time.
//
// Reuses the same treasury/Uniswap V3 address env vars as
// scripts/deploy-hoodlums-bonding-curve.ts, since every curve this pipeline
// deploys graduates the same way a manually-deployed curve does.
import hre, { network } from "hardhat";
import { createPublicClient, createWalletClient, custom, isAddress, type Address, type Hex } from "viem";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "../lib/chains";

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
  const treasuryAddress = requireAddress("HOODLUMS_BONDING_CURVE_TREASURY_ADDRESS");
  const positionManagerAddress = requireAddress("HOODLUMS_BONDING_CURVE_POSITION_MANAGER_ADDRESS");
  const uniswapV3FactoryAddress = requireAddress("HOODLUMS_BONDING_CURVE_UNISWAP_V3_FACTORY_ADDRESS");
  const weth9Address = requireAddress("HOODLUMS_BONDING_CURVE_WETH9_ADDRESS");

  const artifact = await hre.artifacts.readArtifact("HoodlumsCurveLaunchPipeline");
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
      "No deployer account resolved from HOODLUMS_CURVE_LAUNCH_PIPELINE_DEPLOYER_PRIVATE_KEY. " +
        "Set it in the environment before running this script.",
    );
  }

  console.log(
    `Deploying HoodlumsCurveLaunchPipeline to Robinhood Chain Testnet (chain id ${ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL})`,
  );
  console.log(`  Deployer:  ${deployer}`);
  console.log(`  Treasury:  ${treasuryAddress}`);
  console.log(`  Uniswap NonfungiblePositionManager: ${positionManagerAddress}`);
  console.log(`  Uniswap V3Factory:                  ${uniswapV3FactoryAddress}`);
  console.log(`  WETH9:                              ${weth9Address}`);

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as Hex,
    account: deployer,
    chain,
    args: [treasuryAddress, positionManagerAddress, uniswapV3FactoryAddress, weth9Address],
  });
  console.log(`Deployment transaction submitted: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error("Deployment receipt did not include a contract address.");
  }

  console.log("");
  console.log("HoodlumsCurveLaunchPipeline deployed:");
  console.log(`  Address:  ${receipt.contractAddress}`);
  console.log(`  Chain ID: ${ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL}`);
  console.log("");
  console.log("Constructor arguments (for explorer verification):");
  console.log(`  treasury_:         ${treasuryAddress}`);
  console.log(`  positionManager_:  ${positionManagerAddress}`);
  console.log(`  uniswapV3Factory_: ${uniswapV3FactoryAddress}`);
  console.log(`  weth9_:            ${weth9Address}`);
  console.log("");
  console.log(
    "Once verified, add the address to NEXT_PUBLIC_HOODLUMS_CURVE_LAUNCH_PIPELINE_ADDRESSES, e.g.:",
  );
  console.log(`  {"${ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL}":"${receipt.contractAddress}"}`);
  console.log("");
  console.log(
    "The /testnet launch flow only offers a curve-backed launch once this address is configured; " +
      "until then it keeps using the token-only factory/direct-deploy path.",
  );

  await connection.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
