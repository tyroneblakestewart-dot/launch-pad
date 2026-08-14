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
// A grid with three or more explicit fixed/fractional tracks declared via
// `repeat(N, ...)` outside any media query (e.g. `repeat(3, 1fr)`) is the
// clearest, most common way a generated page lays out side-by-side columns
// that are never told to stack — the "desktop layout squished onto the
// phone" failure mode from issue #323. The threshold starts at three, not
// two, because an always-active two-up grid (e.g. a stat-pair row) is a
// common, legitimate mobile-safe pattern already shipped in the free-site
// template's own tokenomics variants (docs/free-site-template-source.html);
// flagging it would reject known-good output. `repeat(auto-fit, ...)` and
// `repeat(auto-fill, ...)` are excluded because those are inherently
// responsive (the browser recomputes the track count from available width),
// so the numeric capture below only matches an explicit integer count.
const ALWAYS_ACTIVE_MULTI_COLUMN_GRID_PATTERN =
  /grid-template-columns\s*:\s*repeat\(\s*(?:[3-9]|[1-9]\d+)\s*,/i;
const GRID_TEMPLATE_COLUMNS_DECLARATION_PATTERN = /grid-template-columns\s*:/i;
const MAX_WIDTH_MEDIA_CONDITION_PATTERN = /max-width\s*:\s*\d+(?:\.\d+)?px/i;

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

// Splits CSS into its top-level `@media (...) { ... }` blocks, each as its
// raw condition text plus its body, so a caller can check whether a
// mobile-range breakpoint actually touches a given property — unlike
// `stripMediaQueryBlocks`, which only needs to discard that content.
function extractMediaBlocks(css: string): { condition: string; body: string }[] {
  const blocks: { condition: string; body: string }[] = [];
  let index = 0;
  while (index < css.length) {
    const mediaIndex = css.indexOf("@media", index);
    if (mediaIndex === -1) break;
    const braceStart = css.indexOf("{", mediaIndex);
    if (braceStart === -1) break;
    const condition = css.slice(mediaIndex + "@media".length, braceStart);
    let depth = 1;
    let cursor = braceStart + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === "{") depth++;
      else if (css[cursor] === "}") depth--;
      cursor++;
    }
    blocks.push({ condition, body: css.slice(braceStart + 1, cursor - 1) });
    index = cursor;
  }
  return blocks;
}

// Layer 2b of the responsiveness contract (issue #323): a page can pass the
// media-query/fixed-width checks above and still be the exact "desktop
// squished onto the phone" bug the owner reported — an always-active
// multi-column grid with no breakpoint that ever collapses it. This does not
// try to prove the breakpoint targets the *same* grid selector (that needs a
// real CSS parser); it only requires that some max-width breakpoint touches
// `grid-template-columns` at all, which the mechanical-baseline philosophy in
// docs/responsive-qa.md accepts as a reasonable proxy.
function hasUnstackedMultiColumnGrid(html: string): boolean {
  const styleCss = extractStyleBlocksCss(html);
  const alwaysActiveCss = stripMediaQueryBlocks(styleCss);
  if (!ALWAYS_ACTIVE_MULTI_COLUMN_GRID_PATTERN.test(alwaysActiveCss)) return false;

  const hasMobileStackingBreakpoint = extractMediaBlocks(styleCss).some(
    (block) =>
      MAX_WIDTH_MEDIA_CONDITION_PATTERN.test(block.condition) &&
      GRID_TEMPLATE_COLUMNS_DECLARATION_PATTERN.test(block.body),
  );
  return !hasMobileStackingBreakpoint;
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
  if (hasUnstackedMultiColumnGrid(html)) return false;
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

// Everything isCompleteGeneratedPageHtml checks except the responsive
// baseline, factored out so a caller (the one-retry-on-layout-rejection flow
// in lib/site-page-openai-pipeline.ts) can tell "this page is otherwise
// complete and safe, it only failed the layout check" apart from every other
// rejection reason, without duplicating the whole gate.
function isStructurallyCompleteGeneratedPageHtml(
  value: unknown,
  acceptance: GeneratedPageAcceptanceProfile,
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

export function isCompleteGeneratedPageHtml(
  value: unknown,
  acceptance: GeneratedPageAcceptanceProfile = {},
): value is string {
  return (
    isStructurallyCompleteGeneratedPageHtml(value, acceptance) && hasResponsiveBaseline(value as string)
  );
}

// True only when a page is otherwise complete, safe and evidence-matched,
// and the responsive/layout baseline is the sole reason it was rejected —
// the signal the one-automatic-retry flow (issue #323) uses to decide
// whether to retry the AI generation with corrective feedback, rather than
// retrying a page that was rejected for an unrelated reason (missing
// section, unsafe embed, wrong evidence id) that a layout note won't fix.
export function isGeneratedPageRejectedForLayoutOnly(
  value: unknown,
  acceptance: GeneratedPageAcceptanceProfile = {},
): value is string {
  return (
    isStructurallyCompleteGeneratedPageHtml(value, acceptance) && !hasResponsiveBaseline(value as string)
  );
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

export type GeneratedPageRejectionReason = "ok" | "layout" | "other";

// Same evidence/shape checks as parseGeneratedPagePayload, but reports why a
// rejected page failed instead of only null, so the one-retry-on-layout flow
// can target its corrective feedback precisely.
export function describeGeneratedPageRejection(
  value: unknown,
  expected: GeneratedPageEvidence,
  acceptance: GeneratedPageAcceptanceProfile = {},
): GeneratedPageRejectionReason {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "other";
  const item = value as Record<string, unknown>;
  if (item.artworkBriefId !== expected.artworkBriefId) return "other";
  if (item.inspirationBriefId !== expected.inspirationBriefId) return "other";
  if (isCompleteGeneratedPageHtml(item.html, acceptance)) return "ok";
  if (isGeneratedPageRejectedForLayoutOnly(item.html, acceptance)) return "layout";
  return "other";
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
  // Issue #323 part 1: a code-enforced safety net so no generated markup —
  // however it slipped past the mechanical responsive-baseline validator —
  // can force horizontal scrolling in the sandboxed iframe. This is
  // deliberately in addition to, not instead of, that validator.
  const overflowClamp =
    "<style>html,body{max-width:100%;overflow-x:hidden}img,video,table,pre{max-width:100%}</style>";
  // Issue #323 part 2.4: the previous bridge posted a height on every single
  // DOM mutation, which under a busy generated page (animations, a
  // MutationObserver-driven counter, etc.) could fire dozens of times a
  // second. Coalescing mutation-triggered sends into one per animation frame
  // keeps the parent's height reports meaningful instead of a flood the
  // consumer then has to filter through.
  const bridge = `<script>(function(){var send=function(){var h=Math.max(document.body?document.body.scrollHeight:0,document.documentElement?document.documentElement.scrollHeight:0);parent.postMessage({type:'hoodlums-generated-page-height',height:h},'*')};var scheduled=null;var scheduleSend=function(){if(scheduled)return;scheduled=requestAnimationFrame(function(){scheduled=null;send()})};addEventListener('load',send);addEventListener('resize',scheduleSend);new MutationObserver(scheduleSend).observe(document.documentElement,{subtree:true,childList:true,attributes:true});setTimeout(send,60);setTimeout(send,500);setTimeout(send,1500)})();<\/script>`;

  let output = html.replaceAll(ARTWORK_PLACEHOLDER, artwork);
  output = output.replace(
    /<head([^>]*)>/i,
    `<head$1><meta http-equiv="Content-Security-Policy" content="${csp}">${overflowClamp}`,
  );
  output = output.replace(/<\/body>/i, `${bridge}</body>`);
  return output;
}
