export const SITE_DESIGN_VARIANT_COUNT = 5 as const;

export type SiteDesignVariant = Readonly<{
  id: string;
  label: string;
  description: string;
  direction: string;
}>;

/**
 * Stable, deliberately different composition systems. Artwork identity still
 * owns palette, subject, motifs and voice; these directions own layout,
 * navigation, hero treatment, section rhythm and interaction style.
 */
export const SITE_DESIGN_VARIANTS = [
  {
    id: "editorial-poster",
    label: "Editorial Poster",
    description: "Asymmetrical magazine composition with oversized type and story-led blocks.",
    direction:
      "Use an asymmetrical editorial/poster system: oversized display typography, offset columns, pull quotes, ruled story blocks and a hero composed like a magazine cover. Navigation should feel like an editorial contents strip. Avoid card-dashboard repetition.",
  },
  {
    id: "cinematic-showcase",
    label: "Cinematic Showcase",
    description: "Immersive full-bleed artwork with layered, scroll-led storytelling.",
    direction:
      "Use an immersive cinematic system: a full-bleed hero, layered artwork, atmospheric depth, large scene transitions and scroll-led storytelling. Sections should unfold as distinct scenes rather than grids of equal cards.",
  },
  {
    id: "modular-cardscape",
    label: "Modular Cardscape",
    description: "Bento-style information architecture with varied modular content patterns.",
    direction:
      "Use a modular bento/cardscape system: an information-rich grid with deliberately varied spans, nested modules, metric tiles, feature cards and compact navigation. The hero and every section must use different module arrangements, not one repeated card component.",
  },
  {
    id: "kinetic-collage",
    label: "Kinetic Collage",
    description: "Playful overlapping cut-outs, diagonals and energetic layered movement.",
    direction:
      "Use a kinetic collage system: overlapping artwork cut-outs, diagonal movement, rotated labels, layered shapes, unexpected section edges and playful motion. Keep content readable, but reject tidy symmetrical template structure.",
  },
  {
    id: "minimal-gallery",
    label: "Minimal Gallery",
    description: "Restrained exhibition layout with strong whitespace and artwork-first pacing.",
    direction:
      "Use a minimal gallery/exhibition system: generous whitespace, restrained navigation, artwork-first framing, precise type scale, quiet dividers and alternating gallery captions. Avoid dense card grids, collage overlap and cinematic full-screen scene stacking.",
  },
] as const satisfies readonly SiteDesignVariant[];

export type SiteDesignVariantId = (typeof SITE_DESIGN_VARIANTS)[number]["id"];

export function getSiteDesignVariant(id: string): SiteDesignVariant | null {
  return SITE_DESIGN_VARIANTS.find((variant) => variant.id === id) || null;
}

export function isSiteDesignVariantId(id: unknown): id is SiteDesignVariantId {
  return typeof id === "string" && getSiteDesignVariant(id) !== null;
}
