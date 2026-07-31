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

let testAdapter: PublicGeneratedSiteAdapter | null = null;

export function setPublicGeneratedSiteAdapter(adapter: PublicGeneratedSiteAdapter): void {
  testAdapter = adapter;
}

export function resetPublicGeneratedSiteAdapterForTests(): void {
  testAdapter = null;
}

export async function getPublicGeneratedSiteBySlug(slug: string): Promise<PublicGeneratedSite | null> {
  const site = testAdapter
    ? await testAdapter(slug)
    : await getPublishStore().getBySlug(slug);
  return site?.slug === slug ? site : null;
}

/**
 * Lists the most recently published live sites for the studio home's token
 * grid (issue #185). Returns an empty list rather than throwing when no
 * store method is configured (e.g. DATABASE_URL absent), matching the
 * existing "honest empty" behaviour of this repository boundary.
 */
export type LiveGeneratedSitesAdapter = (limit: number) => Promise<PublicGeneratedSite[]>;

let testListAdapter: LiveGeneratedSitesAdapter | null = null;

export function setLiveGeneratedSitesAdapterForTests(adapter: LiveGeneratedSitesAdapter): void {
  testListAdapter = adapter;
}

export function resetLiveGeneratedSitesAdapterForTests(): void {
  testListAdapter = null;
}

export async function listLiveGeneratedSites(limit: number): Promise<PublicGeneratedSite[]> {
  if (testListAdapter) return testListAdapter(limit);
  const store = getPublishStore();
  if (!store.listLive) return [];
  return store.listLive(limit);
}
