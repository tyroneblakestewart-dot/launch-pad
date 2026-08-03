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
  bullets: string[];
  badge?: string;
  featured?: boolean;
  recommended?: boolean;
  foot?: string;
  detailsLink?: LaunchPathLink;
}

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

export function launchPathLabel(id: LaunchPath | null | undefined): string {
  return LAUNCH_PATH_OPTIONS.find((option) => option.id === id)?.name ?? "";
}

/** Closing the chooser never unlocks an unplanned project. */
export function isLaunchPathLocked(
  chooserOpen: boolean,
  selectedPath: LaunchPath | null | undefined,
): boolean {
  return chooserOpen || !selectedPath;
}
