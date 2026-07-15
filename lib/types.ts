export type SupportedChain = "solana" | "robinhood";
export type ProjectStatus = "draft" | "prepared" | "launched";

export interface TokenProject {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  chain: SupportedChain;
  name: string;
  ticker: string;
  description: string;
  supply: string;
  decimals: number;
  websiteSlug: string;
  contractAddress: string;
  xHandle: string;
  telegram: string;
  heroImage: string;
  theme: "hoodlums";
}

export interface WalletState {
  chain: SupportedChain;
  address: string;
}
