import type { LaunchPath } from "./types";

export interface LaunchPathLink {
  label: string;
  targetId: string;
}

export interface LaunchPathOption {
  id: LaunchPath;
  name: string;
  price: string;
  tagline: string;
  bullets: readonly string[];
  badge?: string;
  featured?: boolean;
  recommended?: boolean;
  foot?: string;
  detailsLink?: LaunchPathLink;
}

export const PRO_BUNDLE_FEATURES = [
  "Everything in Pro for each of your 3 tokens",
  "15 posts/day · 6 AI images — allocate across your tokens however you like",
  "Cross-token analytics — instantly see which project is gaining traction fastest",
  "Drop your style and mascot for each token — three distinct voices, three distinct characters",
  "One dashboard to manage it all",
  "Priority support",
  "20% off when you pay 3 months upfront ($288 instead of $360)",
] as const;

export const PRO_BUNDLE_OPTION: LaunchPathOption = {
  id: "pro-bundle",
  name: "Pro Bundle",
  price: "$120/month · up to 3 tokens",
  tagline: "Run your whole portfolio. One dashboard. One payment.",
  bullets: PRO_BUNDLE_FEATURES,
  foot: "Serious builders run more than one token. Now they don't need three times the effort.",
};

/** The four standard homepage cards. Pro Bundle remains the full-width fifth card below them. */
export const LAUNCH_PATH_OPTIONS: readonly LaunchPathOption[] = [
  {
    id: "bond",
    name: "Bond",
    price: "Free",
    tagline: "Simple token launch on-chain.",
    bullets: [
      "Token launch on-chain",
      "Bonding curve",
      "Graduation → locked liquidity",
      "Basic site at hoodlums.dev/slug",
    ],
  },
  {
    id: "bond-site",
    name: "Bond + Site",
    price: "Free",
    badge: "Most Popular",
    featured: true,
    tagline: "Launch your token with a real website.",
    bullets: [
      "Everything in Bond",
      "AI-generated website design",
      "Dexscreener chart",
      "Holder stats",
    ],
  },
  {
    id: "bond-pro-site",
    name: "Bond + Pro Site",
    price: "$10 · one-off",
    badge: "Recommended",
    recommended: true,
    tagline: "Your token. Your domain. Your brand.",
    bullets: [
      "Everything in Bond + Site",
      "[token].hoodlums.dev subdomain",
      "Premium bespoke AI design",
      "Export your site — full HTML, host it anywhere, own it forever",
      "Dexscreener chart + holder stats",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$50/month · per token",
    tagline: "Your token's marketing, on autopilot. Whatever chain you're on.",
    bullets: [
      "Works for any token — any chain",
      "5 posts/day · 2 AI images",
      "Drop your style",
      "Drop your mascot",
      "Telegram buy alerts",
      "Holder analytics",
      "20% off 3 months upfront",
    ],
    foot: "First of its kind. Quality over noise.",
    detailsLink: {
      label: "Got multiple tokens? Pro Bundle — 3 tokens for $120/month →",
      targetId: "pro-bundle",
    },
  },
];

/** All five choices shown by the path chooser and accepted by presets. */
export const PLAN_CHOOSER_OPTIONS: readonly LaunchPathOption[] = [
  ...LAUNCH_PATH_OPTIONS,
  PRO_BUNDLE_OPTION,
];

export const LAUNCH_PATH_PRESET_STORAGE_KEY = "hoodlums:launch-path-preset";

function browserSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function storeLaunchPathPreset(
  path: LaunchPath,
  storage: Storage | null = browserSessionStorage(),
): void {
  storage?.setItem(LAUNCH_PATH_PRESET_STORAGE_KEY, path);
}

/** Reads a homepage CTA preset once, then clears it so normal New token clicks stay neutral. */
export function consumeLaunchPathPreset(
  storage: Storage | null = browserSessionStorage(),
): LaunchPath | null {
  const stored = storage?.getItem(LAUNCH_PATH_PRESET_STORAGE_KEY) ?? null;
  storage?.removeItem(LAUNCH_PATH_PRESET_STORAGE_KEY);
  return PLAN_CHOOSER_OPTIONS.some((option) => option.id === stored)
    ? (stored as LaunchPath)
    : null;
}

export function launchPathLabel(id: LaunchPath | null | undefined): string {
  return PLAN_CHOOSER_OPTIONS.find((option) => option.id === id)?.name ?? "";
}

/** Closing the chooser never unlocks an unplanned project. */
export function isLaunchPathLocked(
  chooserOpen: boolean,
  selectedPath: LaunchPath | null | undefined,
): boolean {
  return chooserOpen || !selectedPath;
}
