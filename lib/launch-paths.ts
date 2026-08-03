import type { LaunchPath } from "./types";

export interface LaunchPathOption {
  id: LaunchPath;
  name: string;
  price: string;
  tagline: string;
  bullets: string[];
  recommended?: boolean;
}

export const LAUNCH_PATH_OPTIONS: readonly LaunchPathOption[] = [
  {
    id: "bond",
    name: "Bond",
    price: "Free",
    tagline: "Token launch on-chain with a bonding curve that graduates to locked liquidity.",
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
    tagline: "Everything in Bond, plus an AI-generated website built for your token.",
    bullets: [
      "Everything in Bond",
      "AI-generated website design",
      "Dexscreener chart",
      "Holder stats",
    ],
    recommended: true,
  },
  {
    id: "bond-pro-site",
    name: "Bond + Pro Site",
    price: "~$10 in ETH · one-off",
    tagline: "Everything in Bond + Site, on your own subdomain with a premium bespoke design.",
    bullets: [
      "Everything in Bond + Site",
      "[token].hoodlums.dev subdomain",
      "Premium bespoke AI generation",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$30/month · USDT",
    tagline: "Works for any token, including third-party launches you didn't create here.",
    bullets: [
      "Works for any token, including third-party",
      "Telegram buy bot",
      "X account AI posting",
      "Holder analytics dashboard",
    ],
  },
];

export function launchPathLabel(id: LaunchPath | null | undefined): string {
  return LAUNCH_PATH_OPTIONS.find((option) => option.id === id)?.name ?? "";
}
