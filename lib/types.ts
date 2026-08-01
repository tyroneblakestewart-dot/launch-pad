import type { FreeSiteSections } from "@/lib/free-site-sections";

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
   * The free-site optional section toggles (About/Tokenomics/Roadmap/How to
   * Buy/FAQ — hero is always on). Optional because projects saved before
   * this field existed have none; readers should fall back to
   * FREE_SITE_SECTION_DEFAULTS.
   */
  siteSections?: FreeSiteSections;
  /**
   * The validated standalone HTML produced by the last successful
   * "Generate site from artwork" run for this exact token identity. Loading
   * a project (or the studio's "Reopen generated site" control) redisplays
   * this exact HTML via `launchpad:reopen-generated-site` instead of
   * calling the AI generator again, and it is what gets published. Cleared
   * whenever the name, ticker or artwork changes so one token's page can
   * never be mistaken for another's. The same reset applies when the
   * project description changes.
   */
  generatedSiteHtml?: string | null;
  /** Increments each time `generatedSiteHtml` is captured. */
  generatedSiteVersion?: number | null;
}

export interface WalletState {
  chain: SupportedChain;
  address: string;
}
