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
// Issue #338 fix 4a: any grid with two or more explicit fixed/fractional
// tracks outside any media query is now rejected outright, full stop — this
// supersedes the #325/#326 heuristic, which allowed an always-active two-up
// grid (on the theory that a stat-pair row is a common, safe pattern) and
// which treated a `max-width` breakpoint that later stacked the grid as
// sufficient. Both of those loopholes let a fundamentally desktop-first page
// pass: "wide by default, narrowed by a phone-only override" is exactly the
// clamped-not-designed pattern the owner flagged (issue #338) — a genuinely
// mobile-first page never needs a `max-width` query to fix its base layout,
// because the base layout is already the mobile one. Multi-column layout may
// now only appear inside a `min-width` media query. `repeat(auto-fit, ...)`
// and `repeat(auto-fill, ...)` stay excluded because those are inherently
// responsive: the browser recomputes the track count from available width,
// so they never need a breakpoint to begin with.
const GRID_TEMPLATE_COLUMNS_VALUE_PATTERN = /grid-template-columns\s*:\s*([^;{}]+)/gi;
const AUTO_FIT_OR_FILL_REPEAT_PATTERN = /repeat\(\s*(?:auto-fit|auto-fill)/i;
const LITERAL_REPEAT_TRACK_PATTERN = /^repeat\(\s*(\d+)\s*,\s*([\s\S]+)\)$/i;
// Caps how many times a literal `repeat(N, ...)` is expanded into individual
// tracks, purely to keep the check O(1) against a pathological huge N; no
// real layout declares more tracks than this.
const MAX_EXPANDED_REPEAT_TRACKS = 24;

// Splits a grid-template-columns value into its top-level tracks, respecting
// parens so a function call like `minmax(200px, 1fr)` counts as one track,
// not two.
function splitTopLevelGridTracks(value: string): string[] {
  const tracks: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (/\s/.test(char) && depth === 0) {
      if (current) {
        tracks.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) tracks.push(current);
  return tracks;
}

// Expands a literal `repeat(N, X)` token (N a plain integer, not
// auto-fit/auto-fill) into N copies of X, so `repeat(3, 1fr)` and
// `1fr 1fr 1fr` are recognised as the same three-track shape.
function expandGridTracks(value: string): string[] {
  const tracks: string[] = [];
  for (const token of splitTopLevelGridTracks(value)) {
    const repeated = token.match(LITERAL_REPEAT_TRACK_PATTERN);
    const count = repeated ? Number(repeated[1]) : NaN;
    if (repeated && Number.isInteger(count) && count > 0 && count <= MAX_EXPANDED_REPEAT_TRACKS) {
      for (let i = 0; i < count; i++) tracks.push(repeated[2].trim());
    } else {
      tracks.push(token);
    }
  }
  return tracks;
}

function isMultiColumnGridDeclaration(rawValue: string): boolean {
  const value = rawValue.trim();
  if (!value || AUTO_FIT_OR_FILL_REPEAT_PATTERN.test(value)) return false;
  return expandGridTracks(value).length >= 2;
}

// A row of content laid out with `display: flex` that can never wrap is the
// flexbox equivalent of the unstacked-grid pattern above — issue #325's
// "icon | heading | paragraph" card rows clipped at the phone's edge.
// Detecting this precisely needs a real CSS parser (matching a
// `display: flex` declaration to how many, and how wide, its actual children
// are); the intentionally narrow, low-false-positive proxy used here
// requires the rule to also declare `flex-wrap: nowrap` explicitly. Plain
// everyday flex chrome (nav bars, button rows, icon+label pairs, key/value
// rows like the free-site ledger tokenomics variant) never states `nowrap`
// — it's already the default — so only a deliberate "never let this row
// wrap" declaration, the shape an always-active multi-card flex row actually
// takes, trips this check.
const FLEX_DISPLAY_PATTERN = /display\s*:\s*flex\b/i;
const FLEX_WRAP_NOWRAP_PATTERN = /flex-wrap\s*:\s*nowrap\b/i;
const FLEX_DIRECTION_COLUMN_PATTERN = /flex-direction\s*:\s*column\b/i;

// Returns the `{ ... }` body of every top-level CSS rule in `css`. Callers
// pass CSS that has already had its `@media` blocks stripped, so there is no
// rule nesting left to worry about.
function extractTopLevelRuleBodies(css: string): string[] {
  const bodies: string[] = [];
  const pattern = /\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css))) {
    bodies.push(match[1]);
  }
  return bodies;
}

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

// Layer 2b of the responsiveness contract (issue #323, extended by #325,
// tightened by #338 fix 4a): a page can pass the media-query/fixed-width
// checks above and still be the exact "desktop squished onto the phone" bug
// the owner reported — an always-active multi-column grid. Unlike the
// pre-#338 version, this does not look for a stacking breakpoint at all: a
// multi-column declaration outside a media query is rejected regardless of
// whether something later narrows it, because that "wide by default,
// narrowed for phones" shape is itself desktop-first.
function hasUnstackedMultiColumnGrid(html: string): boolean {
  const styleCss = extractStyleBlocksCss(html);
  const alwaysActiveCss = stripMediaQueryBlocks(styleCss);

  GRID_TEMPLATE_COLUMNS_VALUE_PATTERN.lastIndex = 0;
  let declarationMatch: RegExpExecArray | null;
  while ((declarationMatch = GRID_TEMPLATE_COLUMNS_VALUE_PATTERN.exec(alwaysActiveCss))) {
    if (isMultiColumnGridDeclaration(declarationMatch[1])) return true;
  }
  return false;
}

// Issue #325's flexbox counterpart to hasUnstackedMultiColumnGrid above —
// see the FLEX_DISPLAY_PATTERN comment for why the trigger is deliberately
// narrow (an explicit `flex-wrap: nowrap`, not merely the absence of
// `flex-wrap: wrap`). Tightened the same way by #338 fix 4a: no stacking-
// breakpoint escape hatch.
function hasUnstackedFlexRow(html: string): boolean {
  const styleCss = extractStyleBlocksCss(html);
  const alwaysActiveCss = stripMediaQueryBlocks(styleCss);

  return extractTopLevelRuleBodies(alwaysActiveCss).some(
    (body) =>
      FLEX_DISPLAY_PATTERN.test(body) &&
      FLEX_WRAP_NOWRAP_PATTERN.test(body) &&
      !FLEX_DIRECTION_COLUMN_PATTERN.test(body),
  );
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
  if (hasUnstackedFlexRow(html)) return false;
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
// baseline. Originally factored out only so a caller (the
// one-retry-on-layout-rejection flow in lib/site-page-openai-pipeline.ts)
// could tell "this page is otherwise complete and safe, it only failed the
// layout check" apart from every other rejection reason.
//
// Issue #338 fix 4b: also exported directly for *display* of already-stored
// content (prepareGeneratedPageForPreview, app/[slug]/page.tsx), which must
// stay deliberately looser than *acceptance* of new content
// (isCompleteGeneratedPageHtml, used by the generation/publish routes). Fix
// 4a tightened the responsive-baseline rule enough that plenty of real,
// already-accepted pre-#326 content now fails it — gating rendering on the
// same strict check would silently break already-published sites and crash
// the studio's reopen flow for old drafts the moment this check tightened.
// Those surfaces render on the structural/safety checks alone (this
// function) and lean on the seatbelt CSS clamp (issue #338 fix 2) plus, in
// the studio, a visible "Regenerate for mobile" prompt driven by
// isGeneratedPageRejectedForLayoutOnly below — never a silent full-page
// failure. New content (freshly generated or freshly (re)published) still
// goes through the strict isCompleteGeneratedPageHtml gate below.
export function isStructurallyCompleteGeneratedPageHtml(
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

// Issue #338 fix 1: PR #333 widened this to `[tabindex]`, `[onclick]`, bare
// `label` and a long role list, on the theory that any focusable/interactive-
// looking element should keep the tap. In practice a generated page that
// wraps whole sections in a tabindexed or onclick-bearing container (common
// in AI output aiming for "accessible" markup) made those wide selectors
// match huge swaths of the page, so the reveal gesture got eaten almost
// everywhere. Narrowed back to things that are genuinely clickable on their
// own — a tap elsewhere (including on a `<label>` or a tabindexed div) now
// reveals the controls instead of being silently absorbed.
const GENERATED_PAGE_INTERACTIVE_TAP_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "audio[controls]",
  "video[controls]",
  "[role='button']",
  "[role='link']",
].join(",");

// Shared by the studio iframe and the durably served /[slug] iframe.
//
// Issue #338 fix 2: PR #333 turned the small #324 overflow clamp into a
// blanket <=640px `!important` reset that force-stacked every structural
// container (`flex-direction:column!important`,
// `grid-template-columns:minmax(0,1fr)!important` on every div/nav/section/
// ul/etc). That made any desktop-first page *look* stacked on a phone,
// which hid whether the generator had actually produced mobile-first CSS —
// and it also flattened legitimate side-by-side mobile design (button
// pairs, nav rows) on every page, including correctly designed published
// sites. Real stacking is the job of the mobile-first generation prompt and
// the `hasResponsiveBaseline` mechanical check above (see issue #326 and
// #338 fix 4); this stays a rarely-needed seatbelt that only clamps overall
// width/overflow, box-sizing and long-text wrapping — it never dictates
// flex/grid direction.
const GENERATED_SITE_SAFETY_RESET = `<style>html,body{max-width:100%;overflow-x:hidden}img,video,table,pre{max-width:100%}@media (max-width:640px){html,body{width:100%;max-width:100vw;overflow-x:hidden;overflow-y:auto}*,*::before,*::after{box-sizing:border-box;min-width:0}th,td,pre,code{overflow-wrap:anywhere;word-break:break-word}}</style>`;

export type PrepareGeneratedPageForPreviewOptions = {
  // Issue #327 problem 3: the studio's mobile full-screen preview needs to
  // know about a background tap landing on the generated page — including
  // inside its sandboxed iframe — to reveal its tap-to-hide controls
  // overlay. A normal pointer/touch event never crosses the iframe boundary,
  // so the page reports a movement-filtered, non-interactive tap itself.
  // Defaults to off: app/[slug]/page.tsx also calls this function for the
  // durably published site, which has no controls overlay to reveal.
  reportTaps?: boolean;
};

export function prepareGeneratedPageForPreview(
  html: string,
  artworkDataUrl: string,
  options: PrepareGeneratedPageForPreviewOptions = {},
): string {
  // Structural/safety only (issue #338 fix 4b) — not the strict
  // isCompleteGeneratedPageHtml gate, so an already-accepted pre-#326
  // desktop-first page still renders here instead of throwing the moment
  // fix 4a's stricter responsive-baseline rule shipped. See the comment on
  // isStructurallyCompleteGeneratedPageHtml above.
  if (!isStructurallyCompleteGeneratedPageHtml(html)) {
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
  // Issue #323 part 1 plus the mobile follow-up: a code-enforced safety net
  // so generated markup cannot force horizontal scrolling. At <=640px the
  // same shared layer also collapses structural grid/flex rows into one
  // full-width vertical track. Because /[slug] prepares stored HTML on every
  // request, this repairs existing published sites as well as new previews.
  const overflowClamp = GENERATED_SITE_SAFETY_RESET;
  // Issue #323 part 2.4: the previous bridge posted a height on every single
  // DOM mutation, which under a busy generated page (animations, a
  // MutationObserver-driven counter, etc.) could fire dozens of times a
  // second. Coalescing mutation-triggered sends into one per animation frame
  // keeps the parent's height reports meaningful instead of a flood the
  // consumer then has to filter through.
  const bridge = `<script>(function(){var send=function(){var h=Math.max(document.body?document.body.scrollHeight:0,document.documentElement?document.documentElement.scrollHeight:0);parent.postMessage({type:'hoodlums-generated-page-height',height:h},'*')};var scheduled=null;var scheduleSend=function(){if(scheduled)return;scheduled=requestAnimationFrame(function(){scheduled=null;send()})};addEventListener('load',send);addEventListener('resize',scheduleSend);new MutationObserver(scheduleSend).observe(document.documentElement,{subtree:true,childList:true,attributes:true});setTimeout(send,60);setTimeout(send,500);setTimeout(send,1500)})();<\/script>`;
  // iPhone Safari is more reliable with pointer/touch events than a bubbled
  // click on a blank div. A <=10px gesture counts as a tap; scrolling and
  // taps that start or finish inside an interactive element are ignored.
  // The reporter itself uses a synthetic click so the long-standing bridge
  // contract and its regression coverage stay stable. Nothing calls
  // preventDefault or stops propagation, so generated links/buttons and
  // their own delegated handlers continue normally.
  const tapBridge = options.reportTaps
    ? `<script>(function(){var interactive=${JSON.stringify(GENERATED_PAGE_INTERACTIVE_TAP_SELECTOR)};var reporter=document.createDocumentFragment();reporter.addEventListener('click',function(){parent.postMessage({type:'hoodlums-generated-page-tap'},'*')});var tracking=false,moved=false,startX=0,startY=0,startedInteractive=false;var isInteractive=function(target){return target instanceof Element&&Boolean(target.closest(interactive))};var cancel=function(){tracking=false;moved=false;startedInteractive=false};var begin=function(x,y,target){tracking=true;moved=false;startX=x;startY=y;startedInteractive=isInteractive(target)};var move=function(x,y){if(!tracking)return;if(Math.abs(x-startX)>10||Math.abs(y-startY)>10)moved=true};var finish=function(target){if(!tracking)return;var report=!moved&&!startedInteractive&&!isInteractive(target);cancel();if(report)reporter.dispatchEvent(new Event('click'))};if('PointerEvent'in window){addEventListener('pointerdown',function(event){if(event.isPrimary===false||(event.pointerType==='mouse'&&event.button!==0))return;begin(event.clientX,event.clientY,event.target)},{passive:true});addEventListener('pointermove',function(event){if(event.isPrimary===false)return;move(event.clientX,event.clientY)},{passive:true});addEventListener('pointerup',function(event){if(event.isPrimary===false)return;finish(event.target)},{passive:true});addEventListener('pointercancel',cancel,{passive:true})}else{addEventListener('touchstart',function(event){var touch=event.touches[0];if(!touch)return;begin(touch.clientX,touch.clientY,event.target)},{passive:true});addEventListener('touchmove',function(event){var touch=event.touches[0];if(touch)move(touch.clientX,touch.clientY)},{passive:true});addEventListener('touchend',function(event){finish(event.target)},{passive:true});addEventListener('touchcancel',cancel,{passive:true})}})();<\/script>`
    : "";

  let output = html.replaceAll(ARTWORK_PLACEHOLDER, artwork);
  output = output.replace(
    /<head([^>]*)>/i,
    `<head$1><meta http-equiv="Content-Security-Policy" content="${csp}">${overflowClamp}`,
  );
  output = output.replace(/<\/body>/i, `${bridge}${tapBridge}</body>`);
  return output;
}
