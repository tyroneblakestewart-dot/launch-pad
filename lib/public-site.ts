import type { ProjectStatus, SupportedChain, TokenProject } from "@/lib/types";

/**
 * The public record shape a future publish endpoint would write and the
 * `app/[slug]` route reads. Defined once so the (not-yet-built) publish
 * write path, the repository boundary and the public route all agree on
 * the same contract.
 */
export interface PublicGeneratedSite {
  slug: string;
  name: string;
  ticker: string;
  description: string;
  supply: string;
  decimals: number;
  chain: SupportedChain;
  /** Data URL for the saved token artwork, or "" if none was uploaded. */
  heroImage: string;
  /** Validated standalone generated page HTML, or null if none exists yet. */
  generatedSiteHtml: string | null;
  contractAddress: string;
  xHandle: string;
  telegram: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Pure mapping from a locally saved `TokenProject` to the public record
 * shape. This does not publish or persist anything by itself — it exists
 * so the future publish write path (and tests, via fixtures) have one
 * shared, tested place that defines "what a publish payload looks like".
 */
export function buildPublicGeneratedSiteFromProject(project: TokenProject): PublicGeneratedSite {
  return {
    slug: project.websiteSlug,
    name: project.name,
    ticker: project.ticker,
    description: project.description,
    supply: project.supply,
    decimals: project.decimals,
    chain: project.chain,
    heroImage: project.heroImage,
    generatedSiteHtml: project.generatedSiteHtml || null,
    contractAddress: project.contractAddress,
    xHandle: project.xHandle,
    telegram: project.telegram,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}
