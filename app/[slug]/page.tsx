import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicDexscreenerSection } from "@/components/public-dexscreener-section";
import { PublicSiteFrame } from "@/components/public-site-frame";
import { PublicTokenFallback } from "@/components/public-token-fallback";
import { isCompleteGeneratedPageHtml, prepareGeneratedPageForPreview } from "@/lib/generated-site-page";
import { getPublicGeneratedSiteBySlug } from "@/lib/server/public-generated-sites";
import { decodeArtworkDataUrl } from "@/lib/server/public-site-artwork";
import { validateSlug } from "@/lib/slug";

type PublicSiteRouteParams = { slug: string };
type PublicSiteRouteProps = { params: Promise<PublicSiteRouteParams> };

export async function generateMetadata({ params }: PublicSiteRouteProps): Promise<Metadata> {
  const { slug } = await params;
  if (!validateSlug(slug).valid) return {};

  const site = await getPublicGeneratedSiteBySlug(slug);
  if (!site) return {};

  const title = `${site.name} ($${site.ticker})`;
  const canonical = `https://hoodlums.dev/${slug}`;
  const hasArtwork = Boolean(decodeArtworkDataUrl(site.heroImage));
  const images = hasArtwork ? [`/${slug}/artwork`] : undefined;

  return {
    title,
    description: site.description,
    alternates: { canonical },
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

export default async function PublicGeneratedSitePage({ params }: PublicSiteRouteProps) {
  const { slug } = await params;
  if (!validateSlug(slug).valid) notFound();

  const site = await getPublicGeneratedSiteBySlug(slug);
  if (!site) notFound();

  const hasGeneratedHtml = isCompleteGeneratedPageHtml(site.generatedSiteHtml);
  const hasArtwork = site.heroImage.startsWith("data:image/");

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
