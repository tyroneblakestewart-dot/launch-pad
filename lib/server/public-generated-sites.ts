import type { PublicGeneratedSite } from "@/lib/public-site";

/**
 * Server-only repository boundary for public generated sites.
 *
 * No durable store (database, KV, etc.) exists yet, so the default
 * adapter intentionally returns no record for every slug instead of
 * faking persistence with process memory or browser storage — a
 * process-memory "store" would silently reset on every deploy/restart
 * and would not be shared across serverless instances, which is worse
 * than being honest that nothing is saved yet.
 *
 * Follow-up required before any site is actually publishable:
 *   1. A durable store (e.g. a hosted database or KV) that survives
 *      restarts and is shared across instances.
 *   2. An authenticated/authorised publish write path that maps a saved
 *      `TokenProject` (see `buildPublicGeneratedSiteFromProject` in
 *      `lib/public-site.ts`) to a `PublicGeneratedSite` record.
 *   3. An atomic unique-slug constraint on that write path — the local
 *      collision check in `components/token-studio.tsx` only guards a
 *      single browser and is not authoritative.
 *
 * Until then, call `setPublicGeneratedSiteAdapter` (tests only) to inject
 * a fixture-backed adapter; production code should not call it.
 */
export type PublicGeneratedSiteAdapter = (slug: string) => Promise<PublicGeneratedSite | null>;

const noRecordsAdapter: PublicGeneratedSiteAdapter = async () => null;

let activeAdapter: PublicGeneratedSiteAdapter = noRecordsAdapter;

export function setPublicGeneratedSiteAdapter(adapter: PublicGeneratedSiteAdapter): void {
  activeAdapter = adapter;
}

export function resetPublicGeneratedSiteAdapterForTests(): void {
  activeAdapter = noRecordsAdapter;
}

export async function getPublicGeneratedSiteBySlug(slug: string): Promise<PublicGeneratedSite | null> {
  const site = await activeAdapter(slug);
  return site?.slug === slug ? site : null;
}
