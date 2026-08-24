import { configVariable, defineConfig } from "hardhat/config";

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
  },
});
