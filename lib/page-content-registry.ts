export const PAGE_CONTENT_ELEMENT_TYPES = [
  "heading",
  "text",
  "button_label",
  "button_link",
  "visibility",
] as const;

export type PageContentElementType = (typeof PAGE_CONTENT_ELEMENT_TYPES)[number];

export function isPageContentElementType(
  value: unknown,
): value is PageContentElementType {
  return (
    typeof value === "string" &&
    (PAGE_CONTENT_ELEMENT_TYPES as readonly string[]).includes(value)
  );
}

export type PageContentElementDefinition = {
  id: string;
  type: PageContentElementType;
  label: string;
  defaultValue: string;
};

export type PageContentPageDefinition = {
  id: string;
  label: string;
  route: string;
  elements: readonly PageContentElementDefinition[];
};

/**
 * The registered public pages/tabs and their editable elements. Every page
 * listed here has its live rendering wired to read published values with a
 * hardcoded-default fallback (see the per-page `getPage*Content` callers).
 * Pages built mostly from large stateful client components (home/Create &
 * Bond, Providers, Allocations' main workspace) are intentionally not yet
 * registered — their copy lives inside those components rather than at the
 * page-chrome level, and wiring them safely needs a separate follow-up so a
 * bad edit can never destabilise the primary mobile-Safari workspace.
 */
export const PAGE_CONTENT_REGISTRY: readonly PageContentPageDefinition[] = [
  {
    id: "bonding-curve",
    label: "Bonding Curve",
    route: "/bonding-curve",
    elements: [
      { id: "hero_eyebrow", type: "text", label: "Hero eyebrow", defaultValue: "ROBINHOOD CHAIN TESTNET · STEP 5" },
      { id: "hero_title", type: "heading", label: "Hero title", defaultValue: "Bonding Curve" },
      {
        id: "hero_intro",
        type: "text",
        label: "Hero intro copy",
        defaultValue:
          "Follow the token from a protected full-supply launch through curve trading and into its permanently locked liquidity pool.",
      },
      {
        id: "next_step_heading",
        type: "heading",
        label: "Next-milestone heading",
        defaultValue: "Connect the curve to real testnet launches",
      },
      {
        id: "next_step_copy",
        type: "text",
        label: "Next-milestone copy",
        defaultValue:
          "Live graduation status now reads directly from a configured curve. The next development step is an atomic factory flow that creates the token, places its full supply into the curve and exposes live quote, buy and sell controls on this page.",
      },
      { id: "next_step_visible", type: "visibility", label: "Show next-milestone section", defaultValue: "true" },
      { id: "primary_cta_label", type: "button_label", label: "Primary CTA label", defaultValue: "Open testnet launcher" },
      { id: "primary_cta_link", type: "button_link", label: "Primary CTA link", defaultValue: "/testnet" },
      { id: "secondary_cta_label", type: "button_label", label: "Secondary CTA label", defaultValue: "Open liquidity lab" },
      { id: "secondary_cta_link", type: "button_link", label: "Secondary CTA link", defaultValue: "/liquidity-lab" },
    ],
  },
  {
    id: "allocations",
    label: "Allocations",
    route: "/allocations",
    elements: [
      {
        id: "liquidity_cta_label",
        type: "button_label",
        label: "Liquidity lab CTA label",
        defaultValue: "Open Testnet Liquidity Lab →",
      },
      { id: "liquidity_cta_link", type: "button_link", label: "Liquidity lab CTA link", defaultValue: "/liquidity-lab" },
      { id: "liquidity_cta_visible", type: "visibility", label: "Show liquidity lab CTA", defaultValue: "true" },
    ],
  },
  {
    id: "public-token-site",
    label: "Public token site chrome ([slug] / token page)",
    route: "/[slug]",
    elements: [
      { id: "dexscreener_heading", type: "heading", label: "Dexscreener section heading", defaultValue: "Dexscreener" },
      {
        id: "dexscreener_open_label",
        type: "button_label",
        label: "“Open Dexscreener” link label",
        defaultValue: "OPEN DEXSCREENER ↗",
      },
      {
        id: "dexscreener_empty_heading",
        type: "text",
        label: "No-pair-yet heading",
        defaultValue: "Trading pair not detected yet",
      },
      {
        id: "dexscreener_empty_copy",
        type: "text",
        label: "No-pair-yet copy",
        defaultValue: "Once liquidity creates a Dexscreener pair, the live chart will appear here automatically.",
      },
      {
        id: "dexscreener_check_label",
        type: "button_label",
        label: "“Check Dexscreener” link label",
        defaultValue: "CHECK DEXSCREENER ↗",
      },
      { id: "dexscreener_visible", type: "visibility", label: "Show Dexscreener section", defaultValue: "true" },
    ],
  },
];

export function findPageDefinition(pageId: string): PageContentPageDefinition | undefined {
  return PAGE_CONTENT_REGISTRY.find((page) => page.id === pageId);
}

export function findElementDefinition(
  pageId: string,
  elementId: string,
): PageContentElementDefinition | undefined {
  return findPageDefinition(pageId)?.elements.find((element) => element.id === elementId);
}

export function isRegisteredPageId(value: unknown): value is string {
  return typeof value === "string" && findPageDefinition(value) !== undefined;
}

export function pageContentDefaults(pageId: string): Record<string, string> {
  const page = findPageDefinition(pageId);
  if (!page) return {};
  return Object.fromEntries(page.elements.map((element) => [element.id, element.defaultValue]));
}

export function isContentVisible(value: string | undefined): boolean {
  return value !== "false";
}
