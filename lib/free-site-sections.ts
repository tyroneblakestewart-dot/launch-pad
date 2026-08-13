// The free-site copy contract and its optional-section toggles. This file
// is intentionally free of server-only imports (no node:fs, no OpenAI
// pipeline) so it can be imported from client components such as the
// studio form's section toggles, not just from lib/free-site-template.ts
// and the server-side generation pipeline.

// Only copy the AI can safely invent: personality, narrative and voice.
// Every provable fact (supply, taxes, mint/ownership status, contract
// address, socials) is supplied separately as FreeSiteFacts and never
// asked of the model. See lib/free-site-template.ts (FreeSiteFacts).
//
// tokenName/ticker/kicker/tagline (hero) and communityTitle are always
// required: hero is mandatory and community's visibility is driven by
// FreeSiteFacts (socials supplied or not), not by FreeSiteSections. The
// remaining fields belong to a toggleable section (see
// FREE_SITE_SECTION_COPY_KEYS below) and are only required when that
// section is enabled.
export type FreeSiteCopy = {
  tokenName: string;
  ticker: string;
  kicker: string;
  tagline: string;
  aboutTitle?: string;
  about1Title?: string;
  about1Body?: string;
  about2Title?: string;
  about2Body?: string;
  about3Title?: string;
  about3Body?: string;
  tokenomicsTitle?: string;
  howToBuyTitle?: string;
  howToBuy1Title?: string;
  howToBuy1Body?: string;
  howToBuy2Title?: string;
  howToBuy2Body?: string;
  howToBuy3Title?: string;
  howToBuy3Body?: string;
  howToBuy4Title?: string;
  howToBuy4Body?: string;
  communityTitle: string;
};

// The optional, user-toggled sections. Hero is always on and community's
// visibility is derived from FreeSiteFacts, so neither appears here.
// Roadmap and FAQ were removed entirely (issue #303), not just defaulted
// off: older stored projects may still carry `siteSections.roadmap` /
// `.faq`, but those flags are simply ignored now that neither key is part
// of this set (see buildFreeSiteSections in app/api/generate-free-site/route.ts).
export const FREE_SITE_SECTION_KEYS = ["about", "tokenomics", "howToBuy"] as const;
export type FreeSiteSectionKey = (typeof FREE_SITE_SECTION_KEYS)[number];
export type FreeSiteSections = Record<FreeSiteSectionKey, boolean>;

// Studio default: About and Tokenomics on, How to Buy off (issue #171).
export const FREE_SITE_SECTION_DEFAULTS: FreeSiteSections = {
  about: true,
  tokenomics: true,
  howToBuy: false,
};

// The copy fields that belong to each optional section. Required from the
// model, and substituted into the template, only when that section is
// enabled; otherwise the whole block (including any un-substituted
// placeholder) is stripped by applyBlock in lib/free-site-template.ts.
export const FREE_SITE_SECTION_COPY_KEYS = {
  about: [
    "aboutTitle",
    "about1Title",
    "about1Body",
    "about2Title",
    "about2Body",
    "about3Title",
    "about3Body",
  ],
  tokenomics: ["tokenomicsTitle"],
  howToBuy: [
    "howToBuyTitle",
    "howToBuy1Title",
    "howToBuy1Body",
    "howToBuy2Title",
    "howToBuy2Body",
    "howToBuy3Title",
    "howToBuy3Body",
    "howToBuy4Title",
    "howToBuy4Body",
  ],
} as const satisfies Record<FreeSiteSectionKey, readonly (keyof FreeSiteCopy)[]>;

// Hero (always required) plus community (required regardless of the
// toggles — its visibility is driven by FreeSiteFacts instead).
export const FREE_SITE_ALWAYS_REQUIRED_COPY_KEYS = [
  "tokenName",
  "ticker",
  "kicker",
  "tagline",
  "communityTitle",
] as const satisfies readonly (keyof FreeSiteCopy)[];

const COPY_KEY_SECTION = new Map<keyof FreeSiteCopy, FreeSiteSectionKey>();
for (const sectionKey of FREE_SITE_SECTION_KEYS) {
  for (const copyKey of FREE_SITE_SECTION_COPY_KEYS[sectionKey]) {
    COPY_KEY_SECTION.set(copyKey, sectionKey);
  }
}

// True when copyKey must be a string for the given section toggles: always
// true for hero/community fields, otherwise only when that field's own
// section is enabled.
export function isFreeSiteCopyKeyRequired(
  copyKey: keyof FreeSiteCopy,
  sections: FreeSiteSections,
): boolean {
  const sectionKey = COPY_KEY_SECTION.get(copyKey);
  return !sectionKey || sections[sectionKey];
}

// The exact copy key set the model must return for a given set of section
// toggles — hero and community plus every enabled section's fields, and
// nothing else.
export function freeSiteCopyKeysForSections(
  sections: FreeSiteSections,
): readonly (keyof FreeSiteCopy)[] {
  const keys: (keyof FreeSiteCopy)[] = [...FREE_SITE_ALWAYS_REQUIRED_COPY_KEYS];
  for (const sectionKey of FREE_SITE_SECTION_KEYS) {
    if (sections[sectionKey]) keys.push(...FREE_SITE_SECTION_COPY_KEYS[sectionKey]);
  }
  return keys;
}
