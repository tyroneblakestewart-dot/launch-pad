import { configVariable, defineConfig } from "hardhat/config";

// Fuzz/invariant tuning for the bonding-curve property test suite (issue
// #408: contracts/HoodlumsTestBondingCurve.fuzz.t.sol and .invariant.t.sol).
// Kept modest by default so `npm run test:contracts` stays fast in CI; crank
// any of these locally for a deeper search without editing this file, e.g.:
//   HOODLUMS_FUZZ_RUNS=5000 HOODLUMS_INVARIANT_RUNS=200 HOODLUMS_INVARIANT_DEPTH=300 npm run test:contracts
// The seed is fixed (sha256 of a constant string) so a failing fuzz/invariant
// run is reproducible byte-for-byte; override HOODLUMS_FUZZ_SEED to explore
// with a different sequence. Shrinking a failing sequence to a minimal
// counterexample is edr's default behaviour and needs no extra config.
const FUZZ_RUNS = Number(process.env.HOODLUMS_FUZZ_RUNS ?? 256);
const FUZZ_SEED =
  process.env.HOODLUMS_FUZZ_SEED ?? "0x12e72c58ec65915fb28e6279618a8969331092da0573b36bd57a4513349d5acc";
const INVARIANT_RUNS = Number(process.env.HOODLUMS_INVARIANT_RUNS ?? 20);
const INVARIANT_DEPTH = Number(process.env.HOODLUMS_INVARIANT_DEPTH ?? 50);

export default defineConfig({
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  test: {
    solidity: {
      fuzz: {
        runs: FUZZ_RUNS,
        seed: FUZZ_SEED,
      },
      invariant: {
        runs: INVARIANT_RUNS,
        depth: INVARIANT_DEPTH,
      },
    },
  },
  networks: {
    // Deployment target for scripts/deploy-hoodlums-factory.ts. Never
    // deployed automatically — see README.md "Factory deployment" for the
    // exact command and required env vars. No private key is ever hardcoded
    // here: configVariable() resolves it from the environment at run time.
    robinhoodTestnet: {
      type: "http",
      chainId: 46630,
      url: configVariable("ROBINHOOD_TESTNET_RPC_URL"),
      accounts: [configVariable("HOODLUMS_FACTORY_DEPLOYER_PRIVATE_KEY")],
    },
    // Deployment target for scripts/deploy-hoodlums-bonding-curve.ts. Never
    // deployed automatically — see README.md "Bonding curve deployment
    // (drill)" for the exact command and required env vars.
    robinhoodTestnetBondingCurveDeploy: {
      type: "http",
      chainId: 46630,
      url: configVariable("ROBINHOOD_TESTNET_RPC_URL"),
      accounts: [configVariable("HOODLUMS_BONDING_CURVE_DEPLOYER_PRIVATE_KEY")],
    },
    // Run target for scripts/graduate-hoodlums-bonding-curve.ts. The
    // connected account must be the curve's `creator` and must already hold
    // the token's complete current supply. Never run automatically — see
    // README.md "Bonding curve deployment (drill)".
    robinhoodTestnetBondingCurveCreator: {
      type: "http",
      chainId: 46630,
      url: configVariable("ROBINHOOD_TESTNET_RPC_URL"),
      accounts: [configVariable("HOODLUMS_BONDING_CURVE_CREATOR_PRIVATE_KEY")],
    },
    // Deployment target for scripts/deploy-hoodlums-curve-launch-pipeline.ts
    // (Milestone A, issue #409). Never deployed automatically — see
    // README.md "Curve launch pipeline deployment" for the exact command and
    // required env vars.
    robinhoodTestnetCurveLaunchPipelineDeploy: {
      type: "http",
      chainId: 46630,
      url: configVariable("ROBINHOOD_TESTNET_RPC_URL"),
      accounts: [configVariable("HOODLUMS_CURVE_LAUNCH_PIPELINE_DEPLOYER_PRIVATE_KEY")],
    },
    // Deployment target for scripts/deploy-uniswap-v3-testnet.ts (issue
    // #414) — a testnet-only Uniswap V3 stack standing in for the absent
    // official deployment on Robinhood Chain Testnet. Never deployed
    // automatically — see README.md "Uniswap V3 testnet deployment" for the
    // exact command and required env vars.
    robinhoodTestnetUniswapV3Deploy: {
      type: "http",
      chainId: 46630,
      url: configVariable("ROBINHOOD_TESTNET_RPC_URL"),
      accounts: [configVariable("HOODLUMS_UNISWAP_V3_DEPLOYER_PRIVATE_KEY")],
    },
  },
});
