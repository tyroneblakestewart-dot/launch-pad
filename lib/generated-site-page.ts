export const ARTWORK_PLACEHOLDER = "{{ARTWORK_DATA_URL}}";
// The only iframe a generated page may ever contain: the free-site
// template's own Dexscreener chart embed. `lib/free-site-platform-facts.ts`
// substitutes this token with a `https://dexscreener.com/` URL at request
// time; until then, the stored template still carries this literal
// placeholder and must keep validating. The bespoke (AI) pipeline is never
// told about this token, so it has no way to produce it deliberately.
export const CHART_EMBED_PLACEHOLDER = "{{CHART_EMBED_URL}}";
const DEXSCREENER_EMBED_ORIGIN = "https://dexscreener.com/";
export const REQUIRED_PAGE_SECTIONS = [
  "hero",
  "about",
  "tokenomics",
  "roadmap",
  "how-to-buy",
  "community",
] as const;

const MAX_GENERATED_HTML_LENGTH = 90_000;
const MIN_GENERATED_HTML_LENGTH = 3_500;
const FORBIDDEN_TEMPLATE_MARKERS = [
  "initiate_heist",
  "steal the memes",
  "the loot",
  "take from the rich. give to the memes",
];
const TERMINAL_AESTHETIC_MARKERS = [
  "root@",
  "tokenomics.sh",
  "initiate_",
  "command centre",
  "rhc test",
  "matrix rain",
  "green-on-black",
  "join the heist",
];

export type GeneratedPageAcceptanceProfile = {
  forbidTerminalAesthetic?: boolean;
  requireRetailMarketplacePresentation?: boolean;
};

export type GeneratedPageEvidence = {
  artworkBriefId: string;
  inspirationBriefId: string;
};

export type GeneratedPagePayload = GeneratedPageEvidence & {
  html: string;
};

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length || 0;
}

// Layer 2 of the desktop/mobile responsiveness contract (issue #303): a
// mechanical baseline check that rejects the clearest ways a generated page
// would break at 390px or blow out at 1280px+. It cannot prove the layout
// looks *good* at every width (see docs/responsive-qa.md for the
// screenshot-based human pass that does), only that the page has at least
// attempted the responsive techniques the generation prompt requires.
const MEDIA_QUERY_PATTERN = /@media\b/i;
// A bare `width:` (not `min-width`/`max-width`, which are legitimate media
// query thresholds and a normal way to cap an image's fluid size) is
// excluded via the negative lookbehind in both patterns below, so a
// ubiquitous `img{max-width:100%}` rule doesn't get counted as evidence of
// a deliberately responsive layout, and a `@media(min-width:1280px)`
// breakpoint declaration doesn't get mistaken for a fixed-width container.
const RESPONSIVE_UNIT_PATTERN =
  /\bclamp\(|\bmin\(|\bmax\(|\d+(?:\.\d+)?vw\b|\d+(?:\.\d+)?vh\b|(?<![\w-])width\s*:\s*\d+(?:\.\d+)?%/i;
// A bare `width:` fixed to a wide pixel value outside any @media block is a
// full-bleed desktop container that would force horizontal scrolling on a
// 390px viewport.
const FIXED_WIDE_WIDTH_PATTERN = /(?<![\w-])width\s*:\s*(\d{3,5})px/gi;
const MIN_OVERFLOW_RISK_WIDTH_PX = 480;

function extractStyleBlocksCss(html: string): string {
  return (html.match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi) || [])
    .map((block) => block.replace(/^<style\b[^>]*>/i, "").replace(/<\/style\s*>$/i, ""))
    .join("\n");
}

// Removes the contents of every top-level `@media (...) { ... }` block so
// the fixed-width overflow check below only looks at CSS that is always
// active, not CSS gated behind a `min-width` breakpoint (which is exactly
// how a page is expected to introduce a wider fixed layout for desktop).
function stripMediaQueryBlocks(css: string): string {
  let result = "";
  let index = 0;
  while (index < css.length) {
    const mediaIndex = css.indexOf("@media", index);
    if (mediaIndex === -1) {
      result += css.slice(index);
      break;
    }
    result += css.slice(index, mediaIndex);
    const braceStart = css.indexOf("{", mediaIndex);
    if (braceStart === -1) {
      index = css.length;
      break;
    }
    let depth = 1;
    let cursor = braceStart + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === "{") depth++;
      else if (css[cursor] === "}") depth--;
      cursor++;
    }
    index = cursor;
  }
  return result;
}

function hasResponsiveBaseline(html: string): boolean {
  const styleCss = extractStyleBlocksCss(html);
  const hasMediaQuery = MEDIA_QUERY_PATTERN.test(styleCss);
  const hasResponsiveUnit = RESPONSIVE_UNIT_PATTERN.test(styleCss);
  if (!hasMediaQuery && !hasResponsiveUnit) return false;

  const alwaysActiveCss = stripMediaQueryBlocks(styleCss);
  FIXED_WIDE_WIDTH_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FIXED_WIDE_WIDTH_PATTERN.exec(alwaysActiveCss))) {
    if (Number(match[1]) >= MIN_OVERFLOW_RISK_WIDTH_PX) return false;
  }
  return true;
}

function hasRetailMarketplacePresentation(html: string): boolean {
  const hasHeaderNavigation = /<header\b/i.test(html) && /<nav\b/i.test(html);
  const hasDiscoveryPattern =
    /type=["']search["']/i.test(html) ||
    /role=["']search["']/i.test(html) ||
    /(?:class|id)=["'][^"']*(?:search|discover|category|browse)[^"']*["']/i.test(html);
  const articleCount = countMatches(html, /<article\b/gi);
  const namedCardCount = countMatches(
    html,
    /(?:class|id)=["'][^"']*(?:card|tile|campaign|category)[^"']*["']/gi,
  );
  const hasCampaignLanguage =
    /\b(?:discover|featured|campaign|category|collection|top picks|explore|offers)\b/i.test(html);

  return (
    hasHeaderNavigation &&
    hasDiscoveryPattern &&
    articleCount + namedCardCount >= 6 &&
    hasCampaignLanguage
  );
}

export function isCompleteGeneratedPageHtml(
  value: unknown,
  acceptance: GeneratedPageAcceptanceProfile = {},
): value is string {
  if (typeof value !== "string") return false;
  const html = value.trim();
  if (html.length < MIN_GENERATED_HTML_LENGTH || html.length > MAX_GENERATED_HTML_LENGTH) {
    return false;
  }

  const lower = html.toLowerCase();
  if (!lower.includes("<!doctype html") || !lower.includes("<html")) return false;
  if (!lower.includes("<head") || !lower.includes("<body")) return false;
  if (!lower.includes("<style") || !lower.includes("<script")) return false;
  if (!lower.includes('name="viewport"') && !lower.includes("name='viewport'")) return false;
  if (!hasResponsiveBaseline(html)) return false;
  if (!html.includes(ARTWORK_PLACEHOLDER)) return false;

  for (const section of REQUIRED_PAGE_SECTIONS) {
    if (!lower.includes(`id="${section}"`) && !lower.includes(`id='${section}'`)) return false;
  }

  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) return false;
  if (/<(?:object|embed)\b/i.test(html)) return false;
  const iframeTags = html.match(/<iframe\b[^>]*>/gi) || [];
  for (const tag of iframeTags) {
    const srcMatch = tag.match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const src = srcMatch ? srcMatch[1] ?? srcMatch[2] ?? "" : "";
    const isAllowedDexscreenerEmbed =
      src === CHART_EMBED_PLACEHOLDER || src.startsWith(DEXSCREENER_EMBED_ORIGIN);
    if (!isAllowedDexscreenerEmbed) return false;
  }
  if (/javascript\s*:/i.test(html)) return false;
  if (FORBIDDEN_TEMPLATE_MARKERS.some((marker) => lower.includes(marker))) return false;
  if (
    acceptance.forbidTerminalAesthetic &&
    TERMINAL_AESTHETIC_MARKERS.some((marker) => lower.includes(marker))
  ) {
    return false;
  }
  if (
    acceptance.requireRetailMarketplacePresentation &&
    !hasRetailMarketplacePresentation(html)
  ) {
    return false;
  }

  return true;
}

export function parseGeneratedPagePayload(
  value: unknown,
  expected: GeneratedPageEvidence,
  acceptance: GeneratedPageAcceptanceProfile = {},
): GeneratedPagePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.artworkBriefId !== expected.artworkBriefId) return null;
  if (item.inspirationBriefId !== expected.inspirationBriefId) return null;
  if (!isCompleteGeneratedPageHtml(item.html, acceptance)) return null;
  return {
    html: item.html,
    artworkBriefId: expected.artworkBriefId,
    inspirationBriefId: expected.inspirationBriefId,
  };
}

function escapeForHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function prepareGeneratedPageForPreview(html: string, artworkDataUrl: string): string {
  if (!isCompleteGeneratedPageHtml(html)) {
    throw new Error("The generated website document is incomplete.");
  }
  if (!artworkDataUrl.startsWith("data:image/")) {
    throw new Error("The uploaded artwork is unavailable for the website preview.");
  }

  const artwork = escapeForHtmlAttribute(artworkDataUrl);
  const csp = [
    "default-src 'none'",
    "img-src data:",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src data: https://fonts.gstatic.com",
    "script-src 'unsafe-inline'",
    "connect-src 'none'",
    "media-src data:",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src https://dexscreener.com",
  ].join("; ");
  const bridge = `<script>(function(){var send=function(){var h=Math.max(document.body?document.body.scrollHeight:0,document.documentElement?document.documentElement.scrollHeight:0);parent.postMessage({type:'hoodlums-generated-page-height',height:h},'*')};addEventListener('load',send);addEventListener('resize',send);new MutationObserver(send).observe(document.documentElement,{subtree:true,childList:true,attributes:true});setTimeout(send,60);setTimeout(send,500);setTimeout(send,1500)})();<\/script>`;

  let output = html.replaceAll(ARTWORK_PLACEHOLDER, artwork);
  output = output.replace(/<head([^>]*)>/i, `<head$1><meta http-equiv="Content-Security-Policy" content="${csp}">`);
  output = output.replace(/<\/body>/i, `${bridge}</body>`);
  return output;
}
