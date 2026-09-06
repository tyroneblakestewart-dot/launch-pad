import type { FreeSiteSections } from "@/lib/free-site-sections";

export type SupportedChain = "solana" | "robinhood";
export type ProjectStatus = "draft" | "prepared" | "launched";
export type LaunchPath =
  | "bond"
  | "bond-site"
  | "bond-pro-site"
  | "pro"
  | "pro-bundle";

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
   * The free-site optional section toggles (About/Tokenomics/How to Buy —
   * hero is always on). Optional because projects saved before this field
   * existed have none; readers should fall back to
   * FREE_SITE_SECTION_DEFAULTS. Older stored projects may still carry
   * stale `roadmap`/`faq` flags from before those sections were removed
   * entirely (issue #303); they are simply ignored.
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
  /**
   * The path chosen in the path-chooser overlay (Bond / Bond + Site /
   * Bond + Pro Site / Pro / Pro Bundle). Paid paths are only confirmed by
   * the UI after the server has verified and recorded the on-chain payment.
   */
  launchPath?: LaunchPath | null;
  /**
   * Set for a token that was NOT created in the Hoodlums launch studio — added
   * from Hoodlums Social so a subscriber can run socials for a token launched
   * anywhere (owner direction, 6 Sep 2026). External projects live in the
   * same per-wallet vault but never appear in the launch tooling (studio
   * vault, provider desks, allocation desk, launch modal).
   */
  origin?: "external";
  /**
   * Free-text network name for an external token on a chain the studio does
   * not launch to (e.g. "Ethereum"). Display and AI facts only; `chain` then
   * holds the closest base type as a placeholder.
   */
  network?: string;
}

export interface WalletState {
  chain: SupportedChain;
  address: string;
}
