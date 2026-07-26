import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicDexscreenerSection } from "@/components/public-dexscreener-section";
import { PublicSiteFrame } from "@/components/public-site-frame";
import { PublicTokenFallback } from "@/components/public-token-fallback";
import { isCompleteGeneratedPageHtml, prepareGeneratedPageForPreview } from "@/lib/generated-site-page";
import { getPublicGeneratedSiteBySlug } from "@/lib/server/public-generated-sites";
import { decodeArtworkDataUrl } from "@/lib/server/public-site-artwork";
import { validateSlug } from "@/lib/slug";
import { canAccessPublishedSite, draftPreviewTokenMatches } from "./draft-preview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DRAFT_ROBOTS = { index: false, follow: false } as const;

type PublicSiteRouteParams = { slug: string };
type PublicSiteSearchParams = { preview?: string | string[] };
type PublicSiteRouteProps = {
  params: Promise<PublicSiteRouteParams>;
  searchParams?: Promise<PublicSiteSearchParams>;
};

async function previewToken(searchParams?: Promise<PublicSiteSearchParams>): Promise<string> {
  const value = searchParams ? (await searchParams).preview : undefined;
  return typeof value === "string" ? value : "";
}

export async function generateMetadata({ params, searchParams }: PublicSiteRouteProps): Promise<Metadata> {
  const { slug } = await params;
  if (!validateSlug(slug).valid) return {};

  const site = await getPublicGeneratedSiteBySlug(slug);
  if (!site) return {};

  const isDraft = site.visibility === "draft";
  const suppliedPreviewToken = await previewToken(searchParams);
  if (isDraft && !draftPreviewTokenMatches(site, suppliedPreviewToken)) {
    return { robots: DRAFT_ROBOTS };
  }

  const title = `${site.name} ($${site.ticker})`;
  const canonical = `https://hoodlums.dev/${slug}`;
  const hasArtwork = !isDraft && Boolean(decodeArtworkDataUrl(site.heroImage));
  const images = hasArtwork ? [`/${slug}/artwork`] : undefined;

  return {
    title,
    description: site.description,
    alternates: { canonical },
    robots: isDraft ? DRAFT_ROBOTS : undefined,
    openGraph: {
      type: "website",
      url: canonical,
      title,
      description: site.description,
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title,
      description: site.description,
      images,
    },
  };
}

export default async function PublicGeneratedSitePage({ params, searchParams }: PublicSiteRouteProps) {
  const { slug } = await params;
  if (!validateSlug(slug).valid) notFound();

  const site = await getPublicGeneratedSiteBySlug(slug);
  if (!site) notFound();
  if (!canAccessPublishedSite(site, await previewToken(searchParams))) notFound();

  const hasGeneratedHtml = isCompleteGeneratedPageHtml(site.generatedSiteHtml);
  const hasArtwork = Boolean(decodeArtworkDataUrl(site.heroImage));

  return (
    <main className="public-generated-site">
      {hasGeneratedHtml && hasArtwork ? (
        <PublicSiteFrame html={prepareGeneratedPageForPreview(site.generatedSiteHtml as string, site.heroImage)} />
      ) : (
        <PublicTokenFallback site={site} />
      )}
      {site.contractAddress ? <PublicDexscreenerSection address={site.contractAddress} /> : null}
    </main>
  );
}
