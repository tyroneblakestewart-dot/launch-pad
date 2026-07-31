// Optional, manual drill script: funds an already-deployed
// HoodlumsTestBondingCurve with the creator's complete token supply, then
// buys up toward the graduation target so `_graduate()` fires and seeds the
// locked pool.
//
// This script never runs on its own and is never invoked by CI or the app —
// see README.md "Bonding curve deployment (drill)" for the exact command. It
// does not accept, read, or print a private key directly: the creator key
// comes from hardhat.config.ts's `robinhoodTestnetBondingCurveCreator`
// network via configVariable(), which Hardhat resolves from
// HOODLUMS_BONDING_CURVE_CREATOR_PRIVATE_KEY at run time. The connected
// wallet must already hold the token's complete current supply, since
// `fundCurve()` requires it.
import hre, { network } from "hardhat";
import { createPublicClient, createWalletClient, custom, type Address } from "viem";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "../lib/chains";
import { resolveBondingCurveGraduateConfig } from "../lib/bonding-curve-graduate-config";
import { grossNativeInForExactNet } from "../lib/bonding-curve-fee-math";

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Safety backstop against an unexpected infinite loop; a real drive to
// graduation should finish in far fewer steps than this.
const MAX_BUY_STEPS = 500;

const DEADLINE_BUFFER_SECONDS = 3600n;

async function main() {
  const config = resolveBondingCurveGraduateConfig(process.env);

  const curveArtifact = await hre.artifacts.readArtifact("HoodlumsTestBondingCurve");
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

  const [creator] = await walletClient.getAddresses();
  if (!creator) {
    throw new Error(
      "No account resolved from HOODLUMS_BONDING_CURVE_CREATOR_PRIVATE_KEY. " +
        "Set it in the environment before running this script.",
    );
  }

  console.log(`Driving HoodlumsTestBondingCurve at ${config.curveAddress} toward graduation`);
  console.log(`  Creator: ${creator}`);
  console.log(`  Buy step: ${config.buyStepWei.toString()} wei (gross, per intermediate buy)`);

  const readCurve = <T>(functionName: string, args: readonly unknown[] = []) =>
    publicClient.readContract({
      address: config.curveAddress,
      abi: curveArtifact.abi,
      functionName,
      args,
    }) as Promise<T>;

  const writeCurve = (functionName: string, args: readonly unknown[], value?: bigint) =>
    walletClient.writeContract({
      address: config.curveAddress,
      abi: curveArtifact.abi,
      functionName,
      args,
      value,
      account: creator,
      chain,
    });

  const alreadyGraduated = await readCurve<boolean>("graduated");
  if (alreadyGraduated) {
    const pool = await readCurve<Address>("liquidityPool");
    console.log(`Curve already graduated. Locked pool: ${pool}`);
    await connection.close();
    return;
  }

  const funded = await readCurve<boolean>("funded");
  if (!funded) {
    const tokenAddress = await readCurve<Address>("token");
    const totalSupply = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "totalSupply",
    });
    const creatorBalance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [creator],
    });
    if (creatorBalance !== totalSupply) {
      throw new Error(
        `Creator wallet ${creator} must hold the token's complete current supply ` +
          `(${totalSupply.toString()}) before funding; it currently holds ${creatorBalance.toString()}.`,
      );
    }

    console.log(`Approving curve to pull the complete token supply (${totalSupply.toString()})...`);
    const approveHash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [config.curveAddress, totalSupply],
      account: creator,
      chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    console.log("Calling fundCurve()...");
    const fundHash = await writeCurve("fundCurve", []);
    await publicClient.waitForTransactionReceipt({ hash: fundHash });
    console.log("Curve funded with the complete token supply.");
  }

  let steps = 0;
  while (true) {
    const graduated = await readCurve<boolean>("graduated");
    if (graduated) break;

    const remaining = await readCurve<bigint>("remainingNativeToGraduate");
    if (remaining <= 0n) {
      throw new Error(
        "remainingNativeToGraduate() is zero but the curve has not graduated. " +
          "This should not happen — inspect the curve on-chain before retrying.",
      );
    }

    steps += 1;
    if (steps > MAX_BUY_STEPS) {
      throw new Error(`Exceeded ${MAX_BUY_STEPS} buy steps without reaching graduation. Aborting.`);
    }

    const isFinalStep = remaining <= config.buyStepWei;
    const grossValue = isFinalStep ? grossNativeInForExactNet(remaining) : config.buyStepWei;

    const block = await publicClient.getBlock();
    const deadline = block.timestamp + DEADLINE_BUFFER_SECONDS;

    console.log(
      `Buy ${steps}: sending ${grossValue.toString()} wei gross ` +
        `(${isFinalStep ? "final, exact" : "intermediate"} step; ${remaining.toString()} wei remaining to graduate)`,
    );
    const buyHash = await writeCurve("buy", [0n, deadline], grossValue);
    await publicClient.waitForTransactionReceipt({ hash: buyHash });
  }

  const pool = await readCurve<Address>("liquidityPool");
  console.log("");
  console.log("Graduated. _graduate() fired and seeded the locked pool.");
  console.log(`  Locked pool address: ${pool}`);

  await connection.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
