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
  },
});
