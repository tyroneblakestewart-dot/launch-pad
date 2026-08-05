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
 * Home, Providers, Allocations and Manager resolve their content server-side
 * at the page-chrome level and pass it down as plain props/strings into the
 * large stateful client components that own the rest of each page
 * (ProviderLauncher, TokenAllocationDesk, ManagerPlans) — those components'
 * internal state, effects and wallet flows are never restructured, per the
 * PR #118 mobile-Safari rules.
 */
export const PAGE_CONTENT_REGISTRY: readonly PageContentPageDefinition[] = [
  {
    id: "home",
    label: "Home / Create & Bond",
    route: "/",
    elements: [
      { id: "hero_eyebrow", type: "text", label: "Hero eyebrow", defaultValue: "BUILD. TEST. LAUNCH." },
      { id: "hero_title_line1", type: "heading", label: "Hero title, line 1", defaultValue: "Launch a meme token" },
      { id: "hero_title_line2", type: "heading", label: "Hero title, line 2", defaultValue: "without the clutter." },
      {
        id: "hero_sub",
        type: "text",
        label: "Hero sub-copy",
        defaultValue:
          "Create a fixed-supply token, give it a live Hoodlums website, and put its full supply into a bonding curve that graduates into permanently locked liquidity.",
      },
      { id: "primary_cta_label", type: "button_label", label: "Primary CTA label", defaultValue: "Create new token" },
      { id: "primary_cta_link", type: "button_link", label: "Primary CTA link", defaultValue: "#launch-studio" },
    ],
  },
  {
    id: "providers",
    label: "Providers",
    route: "/providers",
    elements: [
      { id: "header_eyebrow", type: "text", label: "Header eyebrow", defaultValue: "PRIVATE LAUNCH ADAPTERS" },
      { id: "header_title", type: "heading", label: "Header title", defaultValue: "Robinhood provider launch desk" },
      {
        id: "header_intro",
        type: "text",
        label: "Header intro copy",
        defaultValue: "Launch through the provider, verify the token, then continue straight into the creator buy.",
      },
      { id: "back_to_studio_label", type: "button_label", label: "“Back to studio” link label", defaultValue: "Back to studio" },
    ],
  },
  {
    id: "manager",
    label: "Manager",
    route: "/manager",
    elements: [
      { id: "header_eyebrow", type: "text", label: "Header eyebrow", defaultValue: "MANAGER · PLANS" },
      { id: "header_title", type: "heading", label: "Header title", defaultValue: "Grow your token after launch." },
      {
        id: "header_intro",
        type: "text",
        label: "Header intro copy",
        defaultValue: "Pro runs the marketing for one token. Pro Bundle runs it for up to three from a single dashboard.",
      },
    ],
  },
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
      { id: "header_eyebrow", type: "text", label: "Header eyebrow", defaultValue: "PRIVATE TOKEN OPERATIONS" },
      { id: "header_title", type: "heading", label: "Header title", defaultValue: "Allocation and distribution desk" },
      {
        id: "header_intro",
        type: "text",
        label: "Header intro copy",
        defaultValue: "Plan the supply, save a record, then approve each real ERC-20 transfer yourself.",
      },
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
    id: "hoodchat",
    label: "Hoodchat",
    route: "/hoodchat",
    elements: [
      { id: "hero_eyebrow", type: "text", label: "Hero eyebrow", defaultValue: "COMMUNITY FEED" },
      { id: "hero_title", type: "heading", label: "Hero title", defaultValue: "Hoodchat" },
      {
        id: "hero_intro",
        type: "text",
        label: "Hero intro copy",
        defaultValue: "Talk launches, trading and projects with the rest of the crew.",
      },
      { id: "empty_state", type: "text", label: "Empty feed copy", defaultValue: "No messages yet. Be the first to post." },
      { id: "composer_placeholder", type: "text", label: "Composer placeholder", defaultValue: "Say something to the crew…" },
      { id: "connect_prompt", type: "text", label: "Disconnected composer prompt", defaultValue: "Connect wallet to post" },
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
  {
    id: "account",
    label: "Account",
    route: "/account",
    elements: [
      { id: "header_eyebrow", type: "text", label: "Header eyebrow", defaultValue: "ACCOUNT" },
      { id: "header_title", type: "heading", label: "Header title", defaultValue: "Choose how you sign in." },
      {
        id: "header_intro",
        type: "text",
        label: "Header intro copy",
        defaultValue:
          "Your account will eventually keep projects available across devices. No sign-in provider is active in this first layout release.",
      },
      { id: "web_accounts_title", type: "heading", label: "“Continue with” section title", defaultValue: "Continue with" },
      { id: "web_accounts_subtitle", type: "text", label: "“Continue with” section subtitle", defaultValue: "Web accounts" },
      { id: "google_note", type: "text", label: "Google row note", defaultValue: "Email and project sync" },
      { id: "github_note", type: "text", label: "GitHub row note", defaultValue: "Developer account" },
      { id: "x_note", type: "text", label: "X row note", defaultValue: "Social identity" },
      { id: "wallet_title", type: "heading", label: "“Connect a wallet” section title", defaultValue: "Connect a wallet" },
      { id: "wallet_subtitle", type: "text", label: "“Connect a wallet” section subtitle", defaultValue: "Web3 accounts" },
      { id: "metamask_note", type: "text", label: "MetaMask row note", defaultValue: "EVM wallet" },
      { id: "rabby_note", type: "text", label: "Rabby row note", defaultValue: "EVM wallet" },
      { id: "phantom_note", type: "text", label: "Phantom row note", defaultValue: "Solana and EVM wallet" },
      {
        id: "footer_copy",
        type: "text",
        label: "Footer copy",
        defaultValue:
          "Existing wallet connections inside the launch tools remain unchanged while this account system is built safely in separate steps.",
      },
    ],
  },
  {
    id: "liquidity-lab",
    label: "Liquidity Lab",
    route: "/liquidity-lab",
    elements: [
      { id: "hero_eyebrow", type: "text", label: "Hero eyebrow", defaultValue: "ROBINHOOD CHAIN TESTNET · 46630" },
      { id: "hero_title", type: "heading", label: "Hero title", defaultValue: "Liquidity Lab" },
      {
        id: "hero_intro",
        type: "text",
        label: "Hero intro copy",
        defaultValue:
          "Deploy a private, test-only constant-product AMM for HOODLUMS. This contract is unaudited and must never be used on mainnet.",
      },
    ],
  },
  {
    id: "monad",
    label: "Monad Testnet Launcher",
    route: "/monad",
    elements: [
      { id: "hero_eyebrow", type: "text", label: "Hero eyebrow", defaultValue: "MONAD SAFE-MODE LAB" },
      { id: "hero_title_line1", type: "heading", label: "Hero title, line 1", defaultValue: "Launch fast." },
      { id: "hero_title_line2", type: "heading", label: "Hero title, line 2", defaultValue: "Test safely." },
      {
        id: "hero_intro",
        type: "text",
        label: "Hero intro copy",
        defaultValue:
          "Deploy a fixed-supply ERC-20 test token on Monad Testnet using your selected EVM wallet. The app never receives or stores your private key.",
      },
    ],
  },
  {
    id: "testnet",
    label: "Testnet Launcher",
    route: "/testnet",
    elements: [
      { id: "hero_eyebrow", type: "text", label: "Hero eyebrow", defaultValue: "WALLET-SIGNED TEST LAB" },
      { id: "hero_title_line1", type: "heading", label: "Hero title, line 1", defaultValue: "Prove the launch" },
      { id: "hero_title_line2", type: "heading", label: "Hero title, line 2", defaultValue: "before mainnet." },
      {
        id: "hero_intro",
        type: "text",
        label: "Hero intro copy",
        defaultValue:
          "This page creates a real test token without receiving or storing your private key. It does not create liquidity, metadata or a public sale.",
      },
    ],
  },
  {
    id: "social",
    label: "Social Hub",
    route: "/social",
    elements: [
      { id: "header_eyebrow", type: "text", label: "Header eyebrow", defaultValue: "SOCIAL OPERATIONS" },
      { id: "header_title", type: "heading", label: "Header title", defaultValue: "Project Social Hub" },
      {
        id: "header_intro",
        type: "text",
        label: "Header intro copy",
        defaultValue: "Prepare once. Review every destination. Publish without sharing passwords.",
      },
    ],
  },
  {
    id: "admin-login",
    label: "Admin login",
    route: "/admin",
    elements: [
      { id: "header_title", type: "heading", label: "Header title", defaultValue: "HOODLUMS Admin" },
      {
        id: "header_subtitle",
        type: "text",
        label: "Header subtitle",
        defaultValue: "Private control panel. Sign in with the owner wallet, or with the fallback password.",
      },
      { id: "wallet_tab_label", type: "button_label", label: "“Wallet” tab label", defaultValue: "Wallet" },
      { id: "password_tab_label", type: "button_label", label: "“Password” tab label", defaultValue: "Password" },
      {
        id: "wallet_button_label",
        type: "button_label",
        label: "Wallet sign-in button label",
        defaultValue: "Connect wallet & sign in",
      },
      {
        id: "password_placeholder",
        type: "text",
        label: "Password field placeholder",
        defaultValue: "Admin password",
      },
      { id: "password_button_label", type: "button_label", label: "Password sign-in button label", defaultValue: "Sign in" },
    ],
  },
  {
    id: "token-page",
    label: "Token page (/token/[chain]/[address])",
    route: "/token/[chain]/[address]",
    elements: [
      { id: "trades_tab_label", type: "button_label", label: "“Recent trades” tab label", defaultValue: "Recent trades" },
      { id: "holders_tab_label", type: "button_label", label: "“Holders” tab label", defaultValue: "Holders" },
      { id: "empty_trades_text", type: "text", label: "No-trades empty state", defaultValue: "No trades recorded yet." },
      {
        id: "empty_holders_text",
        type: "text",
        label: "No-holders empty state",
        defaultValue: "No holder data found for this token yet.",
      },
      { id: "trade_on_label", type: "heading", label: "“Trade on” section label", defaultValue: "Trade on" },
      {
        id: "empty_terminals_text",
        type: "text",
        label: "No-trade-terminals empty state",
        defaultValue: "No trade terminals are available for this chain yet.",
      },
      { id: "about_label", type: "heading", label: "“About” section label", defaultValue: "About" },
      {
        id: "empty_description_text",
        type: "text",
        label: "No-description empty state",
        defaultValue: "No description has been published for this token yet.",
      },
      {
        id: "chat_empty_state",
        type: "text",
        label: "Hoodchat tab empty feed copy",
        defaultValue: "No messages yet. Be the first to post.",
      },
      {
        id: "chat_connect_prompt",
        type: "text",
        label: "Hoodchat tab disconnected composer prompt",
        defaultValue: "Connect wallet to post",
      },
    ],
  },
  {
    id: "path-chooser",
    label: "Launch path chooser (studio overlay)",
    route: "/ (launch studio overlay)",
    elements: [
      { id: "eyebrow", type: "text", label: "Eyebrow", defaultValue: "CHOOSE YOUR PATH" },
      { id: "title", type: "heading", label: "Title", defaultValue: "How do you want to launch?" },
      {
        id: "subheading",
        type: "text",
        label: "Subheading",
        defaultValue: "Pick a path for this token. You can change it any time before launch.",
      },
      {
        id: "dismissed_continue_label",
        type: "button_label",
        label: "Collapsed “continue” button label",
        defaultValue: "Choose a plan to continue",
      },
      {
        id: "full_details_label",
        type: "button_label",
        label: "“See full plan details” link label",
        defaultValue: "See full plan details ↓",
      },
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
