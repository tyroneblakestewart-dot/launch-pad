import { readFileSync } from "node:fs";
import path from "node:path";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";

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
export type FreeSiteRoadmapStyle = "timeline" | "cards" | "path";
export type FreeSiteAboutStyle = "numbered" | "icons" | "quotes";

export type FreeSiteTheme = {
  palette: FreeSitePalette;
  fontPairing: FreeSiteFontPairing;
  backgroundEffect: FreeSiteBackgroundEffect;
  heroStyle: FreeSiteHeroStyle;
  tokenomicsStyle: FreeSiteTokenomicsStyle;
  roadmapStyle: FreeSiteRoadmapStyle;
  aboutStyle: FreeSiteAboutStyle;
};

export type FreeSiteCopy = {
  tokenName: string;
  ticker: string;
  kicker: string;
  tagline: string;
  contract: string;
  aboutTitle: string;
  about1Title: string;
  about1Body: string;
  about2Title: string;
  about2Body: string;
  about3Title: string;
  about3Body: string;
  tokenomicsTitle: string;
  supply: string;
  buyTax: string;
  sellTax: string;
  lpStatus: string;
  mintAuth: string;
  ownership: string;
  roadmapTitle: string;
  roadmap1Phase: string;
  roadmap1Title: string;
  roadmap1Body: string;
  roadmap2Phase: string;
  roadmap2Title: string;
  roadmap2Body: string;
  roadmap3Phase: string;
  roadmap3Title: string;
  roadmap3Body: string;
  roadmap4Phase: string;
  roadmap4Title: string;
  roadmap4Body: string;
  howToBuyTitle: string;
  howToBuy1Title: string;
  howToBuy1Body: string;
  howToBuy2Title: string;
  howToBuy2Body: string;
  howToBuy3Title: string;
  howToBuy3Body: string;
  howToBuy4Title: string;
  howToBuy4Body: string;
  communityTitle: string;
  xHandle: string;
  telegram: string;
  faqTitle: string;
  faq1Q: string;
  faq1A: string;
  faq2Q: string;
  faq2A: string;
  faq3Q: string;
  faq3A: string;
  faq4Q: string;
  faq4A: string;
  faq5Q: string;
  faq5A: string;
};

export type FreeSiteTemplateInput = {
  theme: FreeSiteTheme;
  copy: FreeSiteCopy;
};

const FONT_PAIRINGS = ["street", "blocky", "arcade", "rounded", "cyber", "editorial"] as const;
const BACKGROUND_EFFECTS = ["cascade", "gradients", "particles", "grid", "none"] as const;
const HERO_STYLES = ["split", "centred", "stacked"] as const;
const TOKENOMICS_STYLES = ["terminal", "grid", "ledger"] as const;
const ROADMAP_STYLES = ["timeline", "cards", "path"] as const;
const ABOUT_STYLES = ["numbered", "icons", "quotes"] as const;
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

const COPY_PLACEHOLDERS = {
  TOKEN_NAME: "tokenName",
  TICKER: "ticker",
  KICKER: "kicker",
  TAGLINE: "tagline",
  CONTRACT: "contract",
  ABOUT_TITLE: "aboutTitle",
  ABOUT_1_TITLE: "about1Title",
  ABOUT_1_BODY: "about1Body",
  ABOUT_2_TITLE: "about2Title",
  ABOUT_2_BODY: "about2Body",
  ABOUT_3_TITLE: "about3Title",
  ABOUT_3_BODY: "about3Body",
  TOKENOMICS_TITLE: "tokenomicsTitle",
  SUPPLY: "supply",
  BUY_TAX: "buyTax",
  SELL_TAX: "sellTax",
  LP_STATUS: "lpStatus",
  MINT_AUTH: "mintAuth",
  OWNERSHIP: "ownership",
  ROADMAP_TITLE: "roadmapTitle",
  ROADMAP_1_PHASE: "roadmap1Phase",
  ROADMAP_1_TITLE: "roadmap1Title",
  ROADMAP_1_BODY: "roadmap1Body",
  ROADMAP_2_PHASE: "roadmap2Phase",
  ROADMAP_2_TITLE: "roadmap2Title",
  ROADMAP_2_BODY: "roadmap2Body",
  ROADMAP_3_PHASE: "roadmap3Phase",
  ROADMAP_3_TITLE: "roadmap3Title",
  ROADMAP_3_BODY: "roadmap3Body",
  ROADMAP_4_PHASE: "roadmap4Phase",
  ROADMAP_4_TITLE: "roadmap4Title",
  ROADMAP_4_BODY: "roadmap4Body",
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
  X_HANDLE: "xHandle",
  TELEGRAM: "telegram",
  FAQ_TITLE: "faqTitle",
  FAQ_1_Q: "faq1Q",
  FAQ_1_A: "faq1A",
  FAQ_2_Q: "faq2Q",
  FAQ_2_A: "faq2A",
  FAQ_3_Q: "faq3Q",
  FAQ_3_A: "faq3A",
  FAQ_4_Q: "faq4Q",
  FAQ_4_A: "faq4A",
  FAQ_5_Q: "faq5Q",
  FAQ_5_A: "faq5A",
} as const satisfies Record<string, keyof FreeSiteCopy>;

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

function prepareSourceTemplate(source: string): string {
  const placeholders = [...source.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((match) => match[1]);
  const uniquePlaceholders = new Set(placeholders);
  if (uniquePlaceholders.size !== 56 || !uniquePlaceholders.has("ARTWORK")) {
    throw new Error("The free-site source placeholder contract has changed.");
  }
  for (const placeholder of uniquePlaceholders) {
    if (placeholder !== "ARTWORK" && !(placeholder in COPY_PLACEHOLDERS)) {
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
  output = replaceOnce(output, 'data-fonts="street"', 'data-fonts="{{THEME_FONT_PAIRING}}"', "font attribute");
  output = replaceOnce(output, 'data-bg="cascade"', 'data-bg="{{THEME_BACKGROUND_EFFECT}}"', "background attribute");
  output = replaceOnce(output, 'data-hero="split"', 'data-hero="{{THEME_HERO_STYLE}}"', "hero attribute");
  output = replaceOnce(output, 'data-tokenomics="terminal"', 'data-tokenomics="{{THEME_TOKENOMICS_STYLE}}"', "tokenomics attribute");
  output = replaceOnce(output, 'data-roadmap="timeline"', 'data-roadmap="{{THEME_ROADMAP_STYLE}}"', "roadmap attribute");
  output = replaceOnce(output, 'data-about="numbered"', 'data-about="{{THEME_ABOUT_STYLE}}"', "about attribute");
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

export function renderFreeSiteTemplate({ theme, copy }: FreeSiteTemplateInput): string {
  const palette = validatePalette(theme.palette);
  validateStyle(theme.fontPairing, FONT_PAIRINGS, "fontPairing");
  validateStyle(theme.backgroundEffect, BACKGROUND_EFFECTS, "backgroundEffect");
  validateStyle(theme.heroStyle, HERO_STYLES, "heroStyle");
  validateStyle(theme.tokenomicsStyle, TOKENOMICS_STYLES, "tokenomicsStyle");
  validateStyle(theme.roadmapStyle, ROADMAP_STYLES, "roadmapStyle");
  validateStyle(theme.aboutStyle, ABOUT_STYLES, "aboutStyle");

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
    .replaceAll("{{THEME_ROADMAP_STYLE}}", theme.roadmapStyle)
    .replaceAll("{{THEME_ABOUT_STYLE}}", theme.aboutStyle)
    .replaceAll("{{FREE_SITE_ARTWORK}}", ARTWORK_PLACEHOLDER);

  for (const [placeholder, copyKey] of Object.entries(COPY_PLACEHOLDERS) as Array<
    [string, keyof FreeSiteCopy]
  >) {
    const value = copy[copyKey];
    if (typeof value !== "string") throw new Error(`Invalid copy value for ${copyKey}.`);
    html = html.replaceAll(`{{${placeholder}}}`, escapeHtml(value));
  }

  return html;
}
