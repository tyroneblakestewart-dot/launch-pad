import type { SupportedChain } from "./types";

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
    label: "Robinhood Chain",
    shortLabel: "RHC",
    walletLabel: "EVM wallet",
    explorerLabel: "Robinhood Chain Blockscout",
    explorerBaseUrl: "https://robinhoodchain.blockscout.com/address/",
  },
};

export const ROBINHOOD_MAINNET = {
  chainId: "0x1237",
  chainName: "Robinhood Chain",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
} as const;
