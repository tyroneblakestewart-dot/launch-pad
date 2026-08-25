// Deploys a testnet-only Uniswap V3 stack (WETH9, UniswapV3Factory,
// NFTDescriptor library, NonfungibleTokenPositionDescriptor,
// NonfungiblePositionManager) to Robinhood Chain Testnet (issue #414).
//
// Why this script exists: Milestone A's curve graduation path
// (HoodlumsTestBondingCurve._graduate()) calls a live Uniswap V3
// NonfungiblePositionManager. Uniswap's official docs and Robinhood's own
// chain docs only list Uniswap V3 deployments for Robinhood Chain MAINNET
// (4663) — see README.md "Bonding curve deployment (drill)" for that
// mainnet table (issue #227). There is no documented official Uniswap V3
// deployment on Robinhood Chain Testnet (46630), so without this script the
// final graduation buy on testnet reverts.
//
// Every contract this script deploys is Uniswap's own canonical, unmodified
// bytecode, loaded directly from Uniswap's published npm package artifacts
// (never hand-compiled from vendored source, never edited) — see
// README.md "Uniswap V3 testnet deployment" for the exact package versions
// this script was written against and the install step. WETH9 comes from
// @uniswap/v2-periphery's published build artifact, the same canonical WETH9
// bytecode Uniswap itself has reused across every deployment since 2018.
//
// This script never runs on its own and is never invoked by CI or the app.
// It does not accept, read, or print a private key directly: the deployer
// key comes from hardhat.config.ts's `robinhoodTestnetUniswapV3Deploy`
// network via configVariable(), which Hardhat resolves from
// HOODLUMS_UNISWAP_V3_DEPLOYER_PRIVATE_KEY at run time.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { network } from "hardhat";
import { createPublicClient, createWalletClient, custom, type Abi, type Address, type Hex } from "viem";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "../lib/chains";
import {
  hasUnresolvedLibraryPlaceholder,
  linkLibraryReferences,
  normalizeArtifactBytecodeHex,
  resolveUniswapV3TestnetDeployConfig,
  type SolidityLinkReferences,
} from "../lib/uniswap-v3-artifact-linking";

const requireFromHere = createRequire(import.meta.url);

// Package/artifact paths this script was written against — see README.md
// "Uniswap V3 testnet deployment" for the exact pinned versions, which were
// NOT verified against the live npm registry while writing this script (no
// network access in that session). Confirm the installed package's actual
// artifact layout before relying on these paths; loadExternalArtifact below
// fails loudly rather than silently if a path doesn't resolve or the file
// doesn't look like a compiled artifact.
const WETH9_ARTIFACT_PATH = "@uniswap/v2-periphery/build/WETH9.json";
const UNISWAP_V3_FACTORY_ARTIFACT_PATH =
  "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
const NFT_DESCRIPTOR_ARTIFACT_PATH =
  "@uniswap/v3-periphery/artifacts/contracts/libraries/NFTDescriptor.sol/NFTDescriptor.json";
const NONFUNGIBLE_TOKEN_POSITION_DESCRIPTOR_ARTIFACT_PATH =
  "@uniswap/v3-periphery/artifacts/contracts/NonfungibleTokenPositionDescriptor.sol/NonfungibleTokenPositionDescriptor.json";
const NONFUNGIBLE_POSITION_MANAGER_ARTIFACT_PATH =
  "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";

interface ExternalArtifact {
  abi: Abi;
  bytecode: Hex;
  linkReferences?: SolidityLinkReferences;
}

function loadExternalArtifact(specifier: string): ExternalArtifact {
  let resolvedPath: string;
  try {
    resolvedPath = requireFromHere.resolve(specifier);
  } catch (error) {
    throw new Error(
      `Could not resolve "${specifier}". Install the pinned Uniswap npm packages first — see ` +
        `README.md "Uniswap V3 testnet deployment". Underlying error: ${(error as Error).message}`,
    );
  }

  const raw: unknown = JSON.parse(readFileSync(resolvedPath, "utf8"));
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`"${specifier}" did not parse to a JSON object.`);
  }
  const artifact = raw as Record<string, unknown>;
  const bytecode = normalizeArtifactBytecodeHex(artifact.bytecode);
  if (bytecode === null) {
    throw new Error(
      `"${specifier}" does not look like a compiled contract artifact (its "bytecode" field is ` +
        "missing, or isn't hex once any \"0x\" prefix and solc library placeholders are accounted for) " +
        "— the installed package version may not match the artifact layout this script expects. Open " +
        "the file and adjust this script's path/extraction if the shape differs.",
    );
  }
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`"${specifier}" is missing its "abi" array.`);
  }
  return {
    abi: artifact.abi as Abi,
    bytecode,
    linkReferences: artifact.linkReferences as SolidityLinkReferences | undefined,
  };
}

async function main() {
  const config = resolveUniswapV3TestnetDeployConfig(process.env);

  const weth9Artifact = loadExternalArtifact(WETH9_ARTIFACT_PATH);
  const factoryArtifact = loadExternalArtifact(UNISWAP_V3_FACTORY_ARTIFACT_PATH);
  const nftDescriptorArtifact = loadExternalArtifact(NFT_DESCRIPTOR_ARTIFACT_PATH);
  const tokenDescriptorArtifact = loadExternalArtifact(NONFUNGIBLE_TOKEN_POSITION_DESCRIPTOR_ARTIFACT_PATH);
  const positionManagerArtifact = loadExternalArtifact(NONFUNGIBLE_POSITION_MANAGER_ARTIFACT_PATH);

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
      "No deployer account resolved from HOODLUMS_UNISWAP_V3_DEPLOYER_PRIVATE_KEY. " +
        "Set it in the environment before running this script.",
    );
  }

  console.log(
    `Deploying a testnet-only Uniswap V3 stack to Robinhood Chain Testnet (chain id ${ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL})`,
  );
  console.log(`  Deployer:               ${deployer}`);
  console.log(`  Native currency label:  ${config.nativeCurrencyLabel}`);
  console.log("");

  async function deployContract(label: string, abi: Abi, bytecode: Hex, args: unknown[] = []): Promise<Address> {
    console.log(`Deploying ${label}...`);
    const hash = await walletClient.deployContract({
      abi,
      bytecode,
      account: deployer,
      chain,
      args,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) {
      throw new Error(`${label} deployment receipt did not include a contract address.`);
    }
    console.log(`  ${label}: ${receipt.contractAddress}  (tx ${hash})`);
    return receipt.contractAddress;
  }

  const weth9Address = await deployContract("WETH9", weth9Artifact.abi, weth9Artifact.bytecode);
  const factoryAddress = await deployContract(
    "UniswapV3Factory",
    factoryArtifact.abi,
    factoryArtifact.bytecode,
  );
  const nftDescriptorAddress = await deployContract(
    "NFTDescriptor (library)",
    nftDescriptorArtifact.abi,
    nftDescriptorArtifact.bytecode,
  );

  if (!tokenDescriptorArtifact.linkReferences) {
    throw new Error(
      "NonfungibleTokenPositionDescriptor artifact has no linkReferences field — cannot link the " +
        "NFTDescriptor library. The installed @uniswap/v3-periphery version may not match what this " +
        "script expects.",
    );
  }
  const linkedTokenDescriptorBytecode = linkLibraryReferences(
    tokenDescriptorArtifact.bytecode,
    tokenDescriptorArtifact.linkReferences,
    { NFTDescriptor: nftDescriptorAddress },
  );
  if (hasUnresolvedLibraryPlaceholder(linkedTokenDescriptorBytecode)) {
    throw new Error(
      "NonfungibleTokenPositionDescriptor bytecode still has an unresolved library placeholder after " +
        "linking — aborting rather than deploying broken code.",
    );
  }

  const tokenDescriptorAddress = await deployContract(
    "NonfungibleTokenPositionDescriptor",
    tokenDescriptorArtifact.abi,
    linkedTokenDescriptorBytecode,
    [weth9Address, config.nativeCurrencyLabelBytes],
  );

  const positionManagerAddress = await deployContract(
    "NonfungiblePositionManager",
    positionManagerArtifact.abi,
    positionManagerArtifact.bytecode,
    [factoryAddress, weth9Address, tokenDescriptorAddress],
  );

  console.log("");
  console.log("Verifying the deployed stack is wired together correctly...");

  const factoryOwner = (await publicClient.readContract({
    address: factoryAddress,
    abi: factoryArtifact.abi,
    functionName: "owner",
  })) as Address;
  if (factoryOwner.toLowerCase() !== deployer.toLowerCase()) {
    throw new Error(
      `UniswapV3Factory.owner() is ${factoryOwner}, expected the deploying account ${deployer}. ` +
        "Aborting — do not use this deployment.",
    );
  }

  const readPositionManagerFactory = (await publicClient.readContract({
    address: positionManagerAddress,
    abi: positionManagerArtifact.abi,
    functionName: "factory",
  })) as Address;
  if (readPositionManagerFactory.toLowerCase() !== factoryAddress.toLowerCase()) {
    throw new Error(
      `NonfungiblePositionManager.factory() is ${readPositionManagerFactory}, expected ${factoryAddress}. ` +
        "Aborting — do not use this deployment.",
    );
  }

  const readPositionManagerWeth9 = (await publicClient.readContract({
    address: positionManagerAddress,
    abi: positionManagerArtifact.abi,
    functionName: "WETH9",
  })) as Address;
  if (readPositionManagerWeth9.toLowerCase() !== weth9Address.toLowerCase()) {
    throw new Error(
      `NonfungiblePositionManager.WETH9() is ${readPositionManagerWeth9}, expected ${weth9Address}. ` +
        "Aborting — do not use this deployment.",
    );
  }

  console.log("  factory.owner() == deployer:              OK");
  console.log("  positionManager.factory() == factory:      OK");
  console.log("  positionManager.WETH9() == weth9:          OK");
  console.log("");
  console.log(
    "Testnet-only Uniswap V3 stack deployed. These are OUR deployments standing in for the absent " +
      "official Uniswap V3 contracts on Robinhood Chain Testnet (46630) — replace with official " +
      "addresses on any chain that documents them (see README.md's Robinhood Chain mainnet, chain ID " +
      "4663, table).",
  );
  console.log("");
  console.log(
    "Add these to your .env.local — exactly the env vars scripts/deploy-hoodlums-bonding-curve.ts and " +
      "scripts/deploy-hoodlums-curve-launch-pipeline.ts read:",
  );
  console.log(`  HOODLUMS_BONDING_CURVE_POSITION_MANAGER_ADDRESS=${positionManagerAddress}`);
  console.log(`  HOODLUMS_BONDING_CURVE_UNISWAP_V3_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`  HOODLUMS_BONDING_CURVE_WETH9_ADDRESS=${weth9Address}`);
  console.log("");
  console.log("For explorer verification only (not read by any other script in this repo):");
  console.log(`  NFTDescriptor library:               ${nftDescriptorAddress}`);
  console.log(`  NonfungibleTokenPositionDescriptor:   ${tokenDescriptorAddress}`);
  console.log("");
  console.log(
    'Before relying on this deployment for a real curve graduation, run the manual smoke test in ' +
      'README.md "Uniswap V3 testnet deployment" — create a pool and mint a minimal position against a ' +
      "throwaway token to prove mint() actually works on this live testnet deployment.",
  );

  await connection.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
