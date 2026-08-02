// Deploys HoodlumsTestBondingCurve to Robinhood Chain Testnet for a single,
// already-deployed token.
//
// This script never runs on its own and is never invoked by CI or the app —
// see README.md "Bonding curve deployment (drill)" for the exact command. It
// does not accept, read, or print a private key directly: the deployer key
// comes from hardhat.config.ts's `robinhoodTestnetBondingCurveDeploy` network
// via configVariable(), which Hardhat resolves from
// HOODLUMS_BONDING_CURVE_DEPLOYER_PRIVATE_KEY at run time.
import hre, { network } from "hardhat";
import { createPublicClient, createWalletClient, custom, type Hex } from "viem";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "../lib/chains";
import { resolveBondingCurveDeployConfig } from "../lib/bonding-curve-deploy-config";

const ERC20_DECIMALS_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

async function main() {
  const config = resolveBondingCurveDeployConfig(process.env);

  const artifact = await hre.artifacts.readArtifact("HoodlumsTestBondingCurve");
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
      "No deployer account resolved from HOODLUMS_BONDING_CURVE_DEPLOYER_PRIVATE_KEY. " +
        "Set it in the environment before running this script.",
    );
  }

  const onChainDecimals = await publicClient.readContract({
    address: config.tokenAddress,
    abi: ERC20_DECIMALS_ABI,
    functionName: "decimals",
  });
  if (onChainDecimals !== config.tokenDecimals) {
    throw new Error(
      `Token at ${config.tokenAddress} reports ${onChainDecimals} decimals, but ` +
        `HOODLUMS_BONDING_CURVE_TOKEN_DECIMALS is ${config.tokenDecimals}. Fix the env var — the ` +
        "virtual token reserve below would otherwise be scaled incorrectly.",
    );
  }

  console.log(`Deploying HoodlumsTestBondingCurve to Robinhood Chain Testnet (chain id ${ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL})`);
  console.log(`  Deployer: ${deployer}`);
  console.log(`  Token:    ${config.tokenAddress}`);
  console.log(`  Creator:  ${config.creatorAddress}`);
  console.log(`  Treasury: ${config.treasuryAddress}`);
  console.log(`  Graduation target:      ${config.graduationTargetWei.toString()} wei`);
  console.log(`  Virtual native reserve:  ${config.virtualEthReserveWei.toString()} wei`);
  console.log(`  Virtual token reserve:   ${config.virtualTokenReserveRaw.toString()} raw units`);
  console.log(`  Uniswap V3 position manager: ${config.positionManagerAddress}`);
  console.log(`  Uniswap V3 factory:          ${config.uniswapV3FactoryAddress}`);
  console.log(`  WETH9:                       ${config.weth9Address}`);
  console.log("  Trading fee: 1% per trade, split 60% treasury / 40% creator (contract constants, not constructor args)");

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as Hex,
    account: deployer,
    chain,
    args: [
      config.tokenAddress,
      config.creatorAddress,
      config.treasuryAddress,
      config.virtualTokenReserveRaw,
      config.virtualEthReserveWei,
      config.graduationTargetWei,
      config.positionManagerAddress,
      config.uniswapV3FactoryAddress,
      config.weth9Address,
    ],
  });
  console.log(`Deployment transaction submitted: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error("Deployment receipt did not include a contract address.");
  }

  const minimumCurveFunding = (await publicClient.readContract({
    address: receipt.contractAddress,
    abi: artifact.abi,
    functionName: "minimumCurveFunding",
  })) as bigint;

  console.log("");
  console.log("HoodlumsTestBondingCurve deployed:");
  console.log(`  Address:  ${receipt.contractAddress}`);
  console.log(`  Chain ID: ${ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL}`);
  console.log("");
  console.log("Constructor arguments (for explorer verification):");
  console.log(`  token_:                 ${config.tokenAddress}`);
  console.log(`  creator_:               ${config.creatorAddress}`);
  console.log(`  treasury_:              ${config.treasuryAddress}`);
  console.log(`  virtualTokenReserve_:   ${config.virtualTokenReserveRaw.toString()}`);
  console.log(`  virtualEthReserve_:     ${config.virtualEthReserveWei.toString()}`);
  console.log(`  graduationTarget_:      ${config.graduationTargetWei.toString()}`);
  console.log(`  positionManager_:       ${config.positionManagerAddress}`);
  console.log(`  uniswapV3Factory_:      ${config.uniswapV3FactoryAddress}`);
  console.log(`  weth9_:                 ${config.weth9Address}`);
  console.log("");
  console.log(
    `Minimum curve funding required (raw token units): ${minimumCurveFunding.toString()}. ` +
      "The creator wallet must hold and approve the token's complete current supply before " +
      "calling fundCurve() — anything less reverts.",
  );
  console.log("");
  console.log(
    "Next step (optional, manual): run scripts/graduate-hoodlums-bonding-curve.ts to fund the " +
      "curve and buy up toward the graduation target — see README.md " +
      '"Bonding curve deployment (drill)".',
  );

  await connection.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
