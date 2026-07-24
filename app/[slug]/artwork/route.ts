import { NextResponse } from "next/server";
import { getPublicGeneratedSiteBySlug } from "@/lib/server/public-generated-sites";
import { decodeArtworkDataUrl } from "@/lib/server/public-site-artwork";
import { validateSlug } from "@/lib/slug";

type RouteParams = { slug: string };

/**
 * HTTP-fetchable artwork endpoint used as the OG/Twitter image for a
 * public generated site. Reads the same public record as the page and
 * fails safely (404, no body) for an invalid slug, missing record, or
 * missing/invalid artwork — it never throws.
 */
export async function GET(_request: Request, { params }: { params: Promise<RouteParams> }) {
  const { slug } = await params;

  if (!validateSlug(slug).valid) {
    return new NextResponse(null, { status: 404 });
  }

  const site = await getPublicGeneratedSiteBySlug(slug);
  if (!site) {
    return new NextResponse(null, { status: 404 });
  }

  const artwork = decodeArtworkDataUrl(site.heroImage);
  if (!artwork) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(artwork.bytes), {
    headers: {
      "Content-Type": artwork.contentType,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
