import type { PublicGeneratedSite } from "@/lib/public-site";
import { getPublishStore } from "@/lib/server/publish-store";

/**
 * Server-only repository boundary for public generated sites.
 *
 * Production reads use the durable Postgres publish store configured through
 * DATABASE_URL. When DATABASE_URL is absent, the default store returns no
 * records so unknown slugs keep the existing honest 404 behaviour instead of
 * falling back to process memory or browser storage.
 *
 * Tests may inject a fixture adapter with `setPublicGeneratedSiteAdapter`.
 */
export type PublicGeneratedSiteAdapter = (slug: string) => Promise<PublicGeneratedSite | null>;
export type LiveGeneratedSitesAdapter = () => Promise<PublicGeneratedSite[]>;

let testAdapter: PublicGeneratedSiteAdapter | null = null;
let testLiveSitesAdapter: LiveGeneratedSitesAdapter | null = null;

export function setPublicGeneratedSiteAdapter(adapter: PublicGeneratedSiteAdapter): void {
  testAdapter = adapter;
}

export function resetPublicGeneratedSiteAdapterForTests(): void {
  testAdapter = null;
}

export function setLiveGeneratedSitesAdapter(adapter: LiveGeneratedSitesAdapter): void {
  testLiveSitesAdapter = adapter;
}

export function resetLiveGeneratedSitesAdapterForTests(): void {
  testLiveSitesAdapter = null;
}

export async function getPublicGeneratedSiteBySlug(slug: string): Promise<PublicGeneratedSite | null> {
  const site = testAdapter
    ? await testAdapter(slug)
    : await getPublishStore().getBySlug(slug);
  return site?.slug === slug ? site : null;
}

/**
 * Live, published Hoodlums sites for the studio home token grid (issue
 * #185). The bonding curve isn't deployed yet, so callers only get slug /
 * name / artwork facts here — market cap and graduation stay UI-level
 * placeholders rather than fabricated numbers.
 */
export async function listLiveGeneratedSites(): Promise<PublicGeneratedSite[]> {
  return testLiveSitesAdapter ? testLiveSitesAdapter() : getPublishStore().listLive();
}
