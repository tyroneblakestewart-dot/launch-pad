import { timingSafeEqual } from "node:crypto";
import type { PublicGeneratedSite } from "@/lib/public-site";

export function draftPreviewTokenMatches(
  site: PublicGeneratedSite,
  supplied: string,
): boolean {
  if (site.visibility !== "draft" || !site.draftToken || !supplied) return false;
  const expected = Buffer.from(site.draftToken);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function canAccessPublishedSite(
  site: PublicGeneratedSite,
  suppliedPreviewToken: string,
): boolean {
  return site.visibility !== "draft" || draftPreviewTokenMatches(site, suppliedPreviewToken);
}
