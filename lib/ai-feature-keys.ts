// Stable machine keys for every measurable paid AI provider attempt (issue
// #368). These are stored verbatim in ai_operation_costs.feature_key, so
// changing a value here changes what future rows record — treat them as an
// append-only vocabulary, not a free-form label.
export const AI_FEATURE_KEYS = {
  BESPOKE_ARTWORK_IDENTITY: "bespoke-site.artwork-identity",
  BESPOKE_ARTWORK_IDENTITY_RETRY: "bespoke-site.artwork-identity-retry",
  BESPOKE_INSPIRATION_SEARCH: "bespoke-site.inspiration-search",
  BESPOKE_FULL_PAGE: "bespoke-site.full-page",
  BESPOKE_FULL_PAGE_LAYOUT_RETRY: "bespoke-site.full-page-layout-retry",
  FREE_SITE_ARTWORK_IDENTITY: "free-site.artwork-identity",
  FREE_SITE_ARTWORK_IDENTITY_RETRY: "free-site.artwork-identity-retry",
  FREE_SITE_DESIGN: "free-site.design",
  FREE_SITE_DESIGN_RETRY: "free-site.design-retry",
  SITE_STYLE_ARTWORK: "site-style.artwork-identity",
  SITE_STYLE_INSPIRATION_SEARCH: "site-style.inspiration-search",
  SITE_STYLE_FINAL: "site-style.final",
  SOCIAL_VOICE_PROFILE: "social.voice-profile",
  SOCIAL_DRAFT: "social.draft",
  SOCIAL_DRAFT_RETRY: "social.draft-retry",
  SOCIAL_MASCOT_ANALYSIS: "social.mascot-analysis",
  SOCIAL_MASCOT_IMAGE: "social.mascot-image",
} as const;

export type AiFeatureKey = (typeof AI_FEATURE_KEYS)[keyof typeof AI_FEATURE_KEYS];

/** Machine feature key used for the X-posting ledger/breakdown row, which lives in social_x_send_costs rather than ai_operation_costs. */
export const X_POST_FEATURE_KEY = "social.x-post";

const FEATURE_GROUP_PREFIXES: Array<{ prefix: string; label: string }> = [
  { prefix: "bespoke-site.", label: "Bespoke site generation" },
  { prefix: "free-site.", label: "Free site generation" },
  { prefix: "site-style.", label: "Site-style generation" },
  { prefix: "social.voice-profile", label: "Voice profile" },
  { prefix: "social.draft", label: "Social draft" },
  { prefix: "social.mascot-analysis", label: "Mascot analysis" },
  { prefix: "social.mascot-image", label: "Mascot image" },
  { prefix: "social.x-post", label: "X post" },
];

/** Groups a precise stage key into the understandable label the Operations UI shows, per issue #368's feature breakdown. */
export function featureGroupLabel(featureKey: string): string {
  const match = FEATURE_GROUP_PREFIXES.find((entry) => featureKey.startsWith(entry.prefix));
  return match?.label ?? "Other";
}
