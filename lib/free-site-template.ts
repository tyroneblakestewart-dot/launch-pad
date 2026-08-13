import { readFileSync } from "node:fs";
import path from "node:path";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import {
  FREE_SITE_SECTION_KEYS,
  isFreeSiteCopyKeyRequired,
  type FreeSiteCopy,
  type FreeSiteSectionKey,
  type FreeSiteSections,
} from "@/lib/free-site-sections";

export * from "@/lib/free-site-sections";

export type FreeSitePalette = {
  background: string;
  surface: string;
  primary: string;
  secondary: string;
  text: string;
};

export type FreeSiteFontPairing =
  | "street"
  | "blocky"
  | "arcade"
  | "rounded"
  | "cyber"
  | "editorial";
export type FreeSiteBackgroundEffect = "cascade" | "gradients" | "particles" | "grid" | "none";
export type FreeSiteHeroStyle = "split" | "centred" | "stacked";
export type FreeSiteTokenomicsStyle = "terminal" | "grid" | "ledger";
export type FreeSiteAboutStyle = "numbered" | "icons" | "quotes";

export type FreeSiteTheme = {
  palette: FreeSitePalette;
  fontPairing: FreeSiteFontPairing;
  backgroundEffect: FreeSiteBackgroundEffect;
  heroStyle: FreeSiteHeroStyle;
  tokenomicsStyle: FreeSiteTokenomicsStyle;
  aboutStyle: FreeSiteAboutStyle;
};

// Facts come from the studio form or from the fixed guarantees of
// contracts/FixedSupplyMemeToken.sol. The model never sees or writes these;
// the server builds them (see app/api/generate-free-site/route.ts).
//
// Platform facts that arrive automatically after generation (contract
// address, Dexscreener chart, LP locked status) are NOT part of this type:
// the template writes a placeholder and a themed coming-soon state for
// those instead of a value, and the actual value is substituted at request
// time from the durable database row (see lib/free-site-platform-facts.ts
// and issue #173). Only user-supplied facts that are resolved once and
// never change automatically (or the fixed contract guarantees) belong
// here.
export type FreeSiteFacts = {
  supply: string;
  decimals: number;
  buyTax: string;
  sellTax: string;
  mintAuthority: string;
  ownership: string;
  xHandle: string;
  telegram: string;
};

export type FreeSiteTemplateInput = {
  theme: FreeSiteTheme;
  copy: FreeSiteCopy;
  sections: FreeSiteSections;
};

export type FreeSiteRenderInput = FreeSiteTemplateInput & {
  facts: FreeSiteFacts;
};

const FONT_PAIRINGS = ["street", "blocky", "arcade", "rounded", "cyber", "editorial"] as const;
const BACKGROUND_EFFECTS = ["cascade", "gradients", "particles", "grid", "none"] as const;
const HERO_STYLES = ["split", "centred", "stacked"] as const;
const TOKENOMICS_STYLES = ["terminal", "grid", "ledger"] as const;
const ABOUT_STYLES = ["numbered", "icons", "quotes"] as const;
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

const COPY_PLACEHOLDERS = {
  TOKEN_NAME: "tokenName",
  TICKER: "ticker",
  KICKER: "kicker",
  TAGLINE: "tagline",
  ABOUT_TITLE: "aboutTitle",
  ABOUT_1_TITLE: "about1Title",
  ABOUT_1_BODY: "about1Body",
  ABOUT_2_TITLE: "about2Title",
  ABOUT_2_BODY: "about2Body",
  ABOUT_3_TITLE: "about3Title",
  ABOUT_3_BODY: "about3Body",
  TOKENOMICS_TITLE: "tokenomicsTitle",
  HOWTOBUY_TITLE: "howToBuyTitle",
  HOWTOBUY_1_TITLE: "howToBuy1Title",
  HOWTOBUY_1_BODY: "howToBuy1Body",
  HOWTOBUY_2_TITLE: "howToBuy2Title",
  HOWTOBUY_2_BODY: "howToBuy2Body",
  HOWTOBUY_3_TITLE: "howToBuy3Title",
  HOWTOBUY_3_BODY: "howToBuy3Body",
  HOWTOBUY_4_TITLE: "howToBuy4Title",
  HOWTOBUY_4_BODY: "howToBuy4Body",
  COMMUNITY_TITLE: "communityTitle",
} as const satisfies Record<string, keyof FreeSiteCopy>;

// Facts placeholders that are a direct 1:1 substitution (no href composition
// or handle normalisation needed).
const FACTS_PLACEHOLDERS = {
  SUPPLY: "supply",
  DECIMALS: "decimals",
  BUY_TAX: "buyTax",
  SELL_TAX: "sellTax",
  MINT_AUTH: "mintAuthority",
  OWNERSHIP: "ownership",
} as const satisfies Record<string, keyof FreeSiteFacts>;

// Placeholders derived from facts but not a plain 1:1 field copy: the
// stripped handle text and the composed hrefs built from it.
const DERIVED_FACTS_PLACEHOLDER_NAMES = ["X_HANDLE", "TELEGRAM", "X_HREF", "TELEGRAM_HREF"] as const;

// Platform-fact placeholders left untouched by renderFreeSiteTemplate on
// purpose: the contract address, chart and LP-locked date are not known
// (or not final) at generation time, so the template keeps writing these
// literal tokens into the stored HTML. lib/free-site-platform-facts.ts
// substitutes them at request time from the durable database row instead
// (issue #173).
const PLATFORM_FACT_PLACEHOLDER_NAMES = [
  "CONTRACT_ADDRESS",
  "BUY_HREF",
  "CHART_URL",
  "CHART_EMBED_URL",
  "CHART_DEX_ID",
  "CHART_LIQUIDITY",
  "CHART_SEARCH_URL",
  "LP_LOCKED_DATE",
] as const;

const TOTAL_TEMPLATE_PLACEHOLDERS =
  Object.keys(COPY_PLACEHOLDERS).length +
  Object.keys(FACTS_PLACEHOLDERS).length +
  DERIVED_FACTS_PLACEHOLDER_NAMES.length +
  PLATFORM_FACT_PLACEHOLDER_NAMES.length +
  1; // ARTWORK

const SOURCE_PATH = path.join(process.cwd(), "docs", "free-site-template-source.html");
const SOURCE_TEMPLATE = readFileSync(SOURCE_PATH, "utf8");

function removeBetween(value: string, start: string, end: string, label: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex);
  if (startIndex === -1 || endIndex === -1 || value.indexOf(start, startIndex + 1) !== -1) {
    throw new Error(`The free-site source has invalid ${label} boundaries.`);
  }
  return value.slice(0, startIndex) + value.slice(endIndex);
}

function replaceOnce(value: string, search: string, replacement: string, label: string): string {
  const first = value.indexOf(search);
  if (first === -1 || value.indexOf(search, first + search.length) !== -1) {
    throw new Error(`The free-site source has an invalid ${label}.`);
  }
  return value.slice(0, first) + replacement + value.slice(first + search.length);
}

// A named block is wrapped in `<!--NAME_START-->` / `<!--NAME_END-->`
// comment markers in the source template. When kept, only the markers are
// stripped; when omitted, the markers and everything between them go too.
// This is how facts-driven content (contract bar, buy CTA, socials,
// community section) is shown or hidden without ever padding with
// placeholder text.
function applyBlock(html: string, name: string, keep: boolean): string {
  const start = `<!--${name}_START-->`;
  const end = `<!--${name}_END-->`;
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end, startIndex);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`The free-site source is missing the ${name} block markers.`);
  }
  if (keep) {
    return (
      html.slice(0, startIndex) +
      html.slice(startIndex + start.length, endIndex) +
      html.slice(endIndex + end.length)
    );
  }
  return html.slice(0, startIndex) + html.slice(endIndex + end.length);
}

function prepareSourceTemplate(source: string): string {
  const placeholders = [...source.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((match) => match[1]);
  const uniquePlaceholders = new Set(placeholders);
  if (uniquePlaceholders.size !== TOTAL_TEMPLATE_PLACEHOLDERS || !uniquePlaceholders.has("ARTWORK")) {
    throw new Error("The free-site source placeholder contract has changed.");
  }
  for (const placeholder of uniquePlaceholders) {
    if (
      placeholder !== "ARTWORK" &&
      !(placeholder in COPY_PLACEHOLDERS) &&
      !(placeholder in FACTS_PLACEHOLDERS) &&
      !(DERIVED_FACTS_PLACEHOLDER_NAMES as readonly string[]).includes(placeholder) &&
      !(PLATFORM_FACT_PLACEHOLDER_NAMES as readonly string[]).includes(placeholder)
    ) {
      throw new Error(`The free-site source has an unmapped copy placeholder: ${placeholder}.`);
    }
  }

  let output = removeBetween(
    source,
    "/* ============================================================\n   DEMO CONTROL PANEL — remove before ship",
    "/* ============================================================\n   HERO VARIANTS — body[data-hero]",
    "demo CSS",
  );
  output = removeBetween(
    output,
    "<!-- ============ DEMO PANEL (remove before ship) ============ -->",
    "<script>",
    "demo markup",
  );
  output = removeBetween(
    output,
    "  /* -------- demo panel -------- */",
    "  /* -------- CANVAS EFFECTS -------- */",
    "demo JavaScript",
  );

  output = replaceOnce(output, "  --background: #06110a;", "  --background: {{THEME_BACKGROUND}};", "background colour");
  output = replaceOnce(output, "  --surface: #0f1f14;", "  --surface: {{THEME_SURFACE}};", "surface colour");
  output = replaceOnce(output, "  --primary: #7cff5b;", "  --primary: {{THEME_PRIMARY}};", "primary colour");
  output = replaceOnce(output, "  --secondary: #f5c945;", "  --secondary: {{THEME_SECONDARY}};", "secondary colour");
  output = replaceOnce(output, "  --text: #e8ffe0;", "  --text: {{THEME_TEXT}};", "text colour");
  output = replaceOnce(
    output,
    '<body data-palette="toxic" data-fonts="street" data-bg="cascade" data-hero="split" data-tokenomics="terminal" data-about="numbered">',
    '<body data-fonts="{{THEME_FONT_PAIRING}}" data-bg="{{THEME_BACKGROUND_EFFECT}}" data-hero="{{THEME_HERO_STYLE}}" data-tokenomics="{{THEME_TOKENOMICS_STYLE}}" data-about="{{THEME_ABOUT_STYLE}}">',
    "body theme attributes",
  );
  output = replaceOnce(output, "{{ARTWORK}}", "{{FREE_SITE_ARTWORK}}", "artwork placeholder");
  return output;
}

const FREE_SITE_TEMPLATE = prepareSourceTemplate(SOURCE_TEMPLATE);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function validatePalette(palette: FreeSitePalette): FreeSitePalette {
  for (const [name, value] of Object.entries(palette)) {
    if (typeof value !== "string" || !HEX_COLOUR.test(value)) {
      throw new Error(`Invalid palette colour for ${name}. Use a six-digit hexadecimal value.`);
    }
  }
  return palette;
}

function validateStyle(value: string, allowed: readonly string[], name: string): void {
  if (!allowed.includes(value)) throw new Error(`Invalid ${name} value.`);
}

const FACTS_STRING_KEYS = [
  "supply",
  "buyTax",
  "sellTax",
  "mintAuthority",
  "ownership",
  "xHandle",
  "telegram",
] as const satisfies readonly (keyof FreeSiteFacts)[];

function validateFacts(facts: FreeSiteFacts): FreeSiteFacts {
  for (const key of FACTS_STRING_KEYS) {
    if (typeof facts[key] !== "string") throw new Error(`Invalid facts value for ${key}.`);
  }
  if (typeof facts.decimals !== "number" || !Number.isFinite(facts.decimals)) {
    throw new Error("Invalid facts value for decimals.");
  }
  return facts;
}

function validateSections(sections: FreeSiteSections): FreeSiteSections {
  for (const key of FREE_SITE_SECTION_KEYS) {
    if (typeof sections[key] !== "boolean") {
      throw new Error(`Invalid sections value for ${key}.`);
    }
  }
  return sections;
}

// Strips a leading "@" and, when present, a leading domain prefix such as
// "x.com/" or "t.me/" (case-insensitively) so "@BLTKK", "BLTKK" and
// "x.com/BLTKK" all normalise to the same bare handle "BLTKK".
function normaliseHandle(raw: string, domainPrefixes: readonly string[]): string {
  let value = raw.trim();
  if (value.startsWith("@")) value = value.slice(1);
  for (const prefix of domainPrefixes) {
    if (value.toLowerCase().startsWith(prefix)) {
      value = value.slice(prefix.length);
      break;
    }
  }
  if (value.startsWith("@")) value = value.slice(1);
  return value.trim();
}

export function renderFreeSiteTemplate({
  theme,
  copy,
  facts,
  sections,
}: FreeSiteRenderInput): string {
  const palette = validatePalette(theme.palette);
  validateStyle(theme.fontPairing, FONT_PAIRINGS, "fontPairing");
  validateStyle(theme.backgroundEffect, BACKGROUND_EFFECTS, "backgroundEffect");
  validateStyle(theme.heroStyle, HERO_STYLES, "heroStyle");
  validateStyle(theme.tokenomicsStyle, TOKENOMICS_STYLES, "tokenomicsStyle");
  validateStyle(theme.aboutStyle, ABOUT_STYLES, "aboutStyle");
  const validatedFacts = validateFacts(facts);
  const validatedSections = validateSections(sections);

  const xHandle = normaliseHandle(validatedFacts.xHandle, ["x.com/", "twitter.com/"]);
  const telegram = normaliseHandle(validatedFacts.telegram, ["t.me/"]);
  const hasX = xHandle !== "";
  const hasTelegram = telegram !== "";
  const hasCommunity = hasX || hasTelegram;

  let html = FREE_SITE_TEMPLATE
    .replaceAll("{{THEME_BACKGROUND}}", palette.background)
    .replaceAll("{{THEME_SURFACE}}", palette.surface)
    .replaceAll("{{THEME_PRIMARY}}", palette.primary)
    .replaceAll("{{THEME_SECONDARY}}", palette.secondary)
    .replaceAll("{{THEME_TEXT}}", palette.text)
    .replaceAll("{{THEME_FONT_PAIRING}}", theme.fontPairing)
    .replaceAll("{{THEME_BACKGROUND_EFFECT}}", theme.backgroundEffect)
    .replaceAll("{{THEME_HERO_STYLE}}", theme.heroStyle)
    .replaceAll("{{THEME_TOKENOMICS_STYLE}}", theme.tokenomicsStyle)
    .replaceAll("{{THEME_ABOUT_STYLE}}", theme.aboutStyle)
    .replaceAll("{{FREE_SITE_ARTWORK}}", ARTWORK_PLACEHOLDER);

  for (const [placeholder, copyKey] of Object.entries(COPY_PLACEHOLDERS) as Array<
    [string, keyof FreeSiteCopy]
  >) {
    const value = copy[copyKey];
    if (typeof value === "string") {
      html = html.replaceAll(`{{${placeholder}}}`, escapeHtml(value));
      continue;
    }
    // A field belonging to a disabled section is allowed to be absent: its
    // placeholder is never substituted, but the whole block it lives in is
    // stripped below by applyBlock, so no unmatched placeholder can leak
    // into the rendered document.
    if (isFreeSiteCopyKeyRequired(copyKey, validatedSections)) {
      throw new Error(`Invalid copy value for ${copyKey}.`);
    }
  }

  for (const [placeholder, factsKey] of Object.entries(FACTS_PLACEHOLDERS) as Array<
    [string, keyof FreeSiteFacts]
  >) {
    const value = validatedFacts[factsKey];
    const text = typeof value === "number" ? String(value) : value;
    html = html.replaceAll(`{{${placeholder}}}`, escapeHtml(text));
  }

  html = html.replaceAll("{{X_HANDLE}}", escapeHtml(xHandle));
  html = html.replaceAll("{{TELEGRAM}}", escapeHtml(telegram));
  html = html.replaceAll("{{X_HREF}}", escapeHtml(hasX ? `https://x.com/${xHandle}` : ""));
  html = html.replaceAll(
    "{{TELEGRAM_HREF}}",
    escapeHtml(hasTelegram ? `https://t.me/${telegram}` : ""),
  );

  html = applyBlock(html, "X_CARD", hasX);
  html = applyBlock(html, "FOOTER_X", hasX);
  html = applyBlock(html, "TELEGRAM_CARD", hasTelegram);
  html = applyBlock(html, "FOOTER_TELEGRAM", hasTelegram);
  html = applyBlock(html, "COMMUNITY_FULL", hasCommunity);
  html = applyBlock(html, "COMMUNITY_EMPTY", !hasCommunity);
  html = applyBlock(html, "NAV_COMMUNITY", hasCommunity);

  // The contract bar, footer contract line, Buy CTA and Dexscreener chart
  // are platform facts, not generation-time facts: the template keeps both
  // their "known" and "coming soon" markup (and the platform-fact
  // placeholders above) untouched here. lib/free-site-platform-facts.ts
  // picks one side and fills in the placeholders at request time, from the
  // durable database row, so a stored page updates when the token launches
  // instead of freezing "coming soon" forever (issue #173).

  // Every other optional section follows the same full/empty pattern as
  // community above: the required `id="..."` stays present either way (see
  // REQUIRED_PAGE_SECTIONS in lib/generated-site-page.ts), but a disabled
  // section renders as an empty, hidden, zero-height placeholder and drops
  // its nav/footer link instead of padding the page with invented copy.
  const TOGGLE_BLOCKS: ReadonlyArray<[string, FreeSiteSectionKey]> = [
    ["ABOUT", "about"],
    ["TOKENOMICS", "tokenomics"],
    ["HOWTOBUY", "howToBuy"],
  ];
  for (const [blockName, sectionKey] of TOGGLE_BLOCKS) {
    const enabled = validatedSections[sectionKey];
    html = applyBlock(html, `${blockName}_FULL`, enabled);
    html = applyBlock(html, `${blockName}_EMPTY`, !enabled);
  }
  html = applyBlock(html, "NAV_ABOUT", validatedSections.about);
  html = applyBlock(html, "NAV_TOKENOMICS", validatedSections.tokenomics);
  html = applyBlock(html, "NAV_HOWTOBUY", validatedSections.howToBuy);
  html = applyBlock(html, "FOOTER_NAV_ABOUT", validatedSections.about);
  html = applyBlock(html, "FOOTER_NAV_TOKENOMICS", validatedSections.tokenomics);

  return html;
}
