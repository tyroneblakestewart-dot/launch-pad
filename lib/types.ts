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
  /**
   * The validated standalone HTML produced by the last successful
   * "Generate site from artwork" run for this exact token identity. Kept
   * so a future publish adapter has the complete design available; not
   * used for anything else today. Cleared whenever the name, ticker or
   * artwork changes so one token's page can never be mistaken for
   * another's. The same reset applies when the project description changes.
   */
  generatedSiteHtml?: string | null;
  /** Increments each time `generatedSiteHtml` is captured. */
  generatedSiteVersion?: number | null;
}

export interface WalletState {
  chain: SupportedChain;
  address: string;
}
