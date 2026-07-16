import type { SupportedChain } from "./types";

export const ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL = 46630;
export const ROBINHOOD_TESTNET_CHAIN_ID_HEX = "0xb626";

export const CHAIN_CONFIG: Record<
  SupportedChain,
  {
    label: string;
    shortLabel: string;
    walletLabel: string;
    explorerLabel: string;
    explorerBaseUrl: string;
  }
> = {
  solana: {
    label: "Solana",
    shortLabel: "SOL",
    walletLabel: "Phantom",
    explorerLabel: "Solana Explorer",
    explorerBaseUrl: "https://explorer.solana.com/address/",
  },
  robinhood: {
    label: "Robinhood Chain Testnet · 46630",
    shortLabel: "RHC TEST",
    walletLabel: "EVM wallet",
    explorerLabel: "Robinhood Chain Testnet Explorer",
    explorerBaseUrl: "https://explorer.testnet.chain.robinhood.com/address/",
  },
};

export const ROBINHOOD_TESTNET = {
  chainId: ROBINHOOD_TESTNET_CHAIN_ID_HEX,
  chainName: "Robinhood Chain Testnet",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: ["https://rpc.testnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://explorer.testnet.chain.robinhood.com"],
} as const;

/**
 * Legacy import retained while the studio is in safe mode.
 * It deliberately points to testnet; no mainnet network configuration is exported.
 */
export const ROBINHOOD_MAINNET = ROBINHOOD_TESTNET;
