import { isCompleteGeneratedPageHtml } from "@/lib/generated-site-page";
import {
  SITE_DESIGN_VARIANT_COUNT,
  SITE_DESIGN_VARIANTS,
  getSiteDesignVariant,
  type SiteDesignVariant,
} from "@/lib/site-design-variants";

export type GeneratedSiteVariant = Readonly<{
  id: string;
  label: string;
  description: string;
  html: string;
}>;

const LAYOUT_PROPERTIES = new Set([
  "display",
  "position",
  "inset",
  "top",
  "right",
  "bottom",
  "left",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "grid",
  "grid-area",
  "grid-template",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "flex",
  "flex-basis",
  "flex-direction",
  "flex-flow",
  "flex-grow",
  "flex-shrink",
  "flex-wrap",
  "align-content",
  "align-items",
  "align-self",
  "justify-content",
  "justify-items",
  "justify-self",
  "gap",
  "column-gap",
  "row-gap",
  "columns",
  "column-count",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "overflow",
  "overflow-x",
  "overflow-y",
  "transform",
  "clip-path",
  "object-fit",
  "aspect-ratio",
]);

export function hasVariantMarker(html: string, variantId: string): boolean {
  const escaped = variantId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`data-design-variant\\s*=\\s*["']${escaped}["']`, "i").test(html);
}

function tagTokens(html: string): string[] {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
  return Array.from(withoutNoise.matchAll(/<\s*(\/)?\s*([a-z][a-z0-9-]*)\b[^>]*>/gi))
    .map((match) => `${match[1] ? "/" : ""}${match[2].toLowerCase()}`)
    .filter((token) => !["meta", "link", "title"].includes(token.replace(/^\//, "")));
}

function layoutPropertyTokens(html: string): string[] {
  const styles = Array.from(html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    .map((match) => match[1])
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  return Array.from(styles.matchAll(/(?:^|[;{])\s*([a-z-]+)\s*:/g))
    .map((match) => match[1].toLowerCase())
    .filter((property) => LAYOUT_PROPERTIES.has(property));
}

function ngrams(tokens: readonly string[], size = 3): Set<string> {
  const output = new Set<string>();
  if (tokens.length < size) {
    if (tokens.length) output.add(tokens.join("|"));
    return output;
  }
  for (let index = 0; index <= tokens.length - size; index += 1) {
    output.add(tokens.slice(index, index + size).join("|"));
  }
  return output;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function layoutSimilarity(leftHtml: string, rightHtml: string): number {
  const leftTags = tagTokens(leftHtml);
  const rightTags = tagTokens(rightHtml);
  const leftProperties = layoutPropertyTokens(leftHtml);
  const rightProperties = layoutPropertyTokens(rightHtml);

  const tagScore = jaccard(ngrams(leftTags), ngrams(rightTags));
  const propertyScore = jaccard(ngrams(leftProperties, 2), ngrams(rightProperties, 2));
  return tagScore * 0.72 + propertyScore * 0.28;
}

/**
 * Rejects duplicate and obvious colour-swap-only layouts. Text, artwork URLs,
 * colours and font choices do not influence this score; DOM composition and
 * layout-property sequences do.
 */
export function haveDistinctVariantLayouts(
  variants: readonly Pick<GeneratedSiteVariant, "id" | "html">[],
  maximumSimilarity = 0.94,
): boolean {
  for (let left = 0; left < variants.length; left += 1) {
    for (let right = left + 1; right < variants.length; right += 1) {
      if (layoutSimilarity(variants[left].html, variants[right].html) >= maximumSimilarity) {
        return false;
      }
    }
  }
  return true;
}

function normaliseVariant(value: unknown, descriptor: SiteDesignVariant): GeneratedSiteVariant | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.id !== descriptor.id) return null;
  if (item.label !== descriptor.label) return null;
  if (item.description !== descriptor.description) return null;
  if (!isCompleteGeneratedPageHtml(item.html)) return null;
  if (!hasVariantMarker(item.html, descriptor.id)) return null;
  return {
    id: descriptor.id,
    label: descriptor.label,
    description: descriptor.description,
    html: item.html,
  };
}

/** Client/server boundary validation for the five-variant response. */
export function parseGeneratedSiteVariants(value: unknown): GeneratedSiteVariant[] | null {
  if (!Array.isArray(value) || value.length !== SITE_DESIGN_VARIANT_COUNT) return null;
  const variants: GeneratedSiteVariant[] = [];
  for (let index = 0; index < SITE_DESIGN_VARIANTS.length; index += 1) {
    const variant = normaliseVariant(value[index], SITE_DESIGN_VARIANTS[index]);
    if (!variant) return null;
    variants.push(variant);
  }
  if (new Set(variants.map((variant) => variant.id)).size !== SITE_DESIGN_VARIANT_COUNT) return null;
  if (!haveDistinctVariantLayouts(variants)) return null;
  return variants;
}

export function getDefaultGeneratedSiteVariant(
  variants: readonly GeneratedSiteVariant[],
): GeneratedSiteVariant | null {
  return variants[0] || null;
}

export function selectGeneratedSiteVariant(
  variants: readonly GeneratedSiteVariant[],
  id: string,
): GeneratedSiteVariant | null {
  if (!getSiteDesignVariant(id)) return null;
  return variants.find((variant) => variant.id === id) || null;
}
