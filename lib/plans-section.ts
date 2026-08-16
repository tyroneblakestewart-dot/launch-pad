import {
  PRO_BUNDLE_FEATURES,
  type LaunchPathOption,
} from "./launch-paths";

export { PRO_BUNDLE_FEATURES };

export type PlansBilling = "monthly" | "upfront";

export const PLANS_BILLING_OPTIONS: ReadonlyArray<{
  id: PlansBilling;
  label: string;
}> = [
  { id: "monthly", label: "Monthly" },
  { id: "upfront", label: "3 months · −20%" },
];

export const PLAN_CALLOUTS = [
  {
    kicker: "Drop Your Style",
    heading: "AI that sounds like you, not a bot.",
    body:
      "Paste in tweets, posts, captions — from your own account or any project whose vibe you want. Doesn't matter where they're from. The AI reads them, learns the tone, and posts in that voice for your token. Not a generic crypto template. Your voice.",
  },
  {
    kicker: "Drop Your Mascot",
    heading: "Memes your community will actually use.",
    body:
      "Upload your token artwork once. From that point, every AI-generated image features your actual character — memes, announcements, community posts — all in your mascot's style. Your community will recognise it instantly.",
  },
] as const;

/**
 * A coming-soon $25/month add-on to Pro (issue #343) — deliberately kept
 * out of LAUNCH_PATH_OPTIONS / PLAN_CHOOSER_OPTIONS so it never appears in
 * the "How do you want to launch?" chooser modal. It only renders as its
 * own card in the full plan-details view and as a cross-sell line on Pro.
 */
export const STREET_TEAM_TARGET_ID = "street-team";

export const STREET_TEAM_OPTION = {
  id: "street-team",
  name: "Street Team",
  price: "$25/month · add-on to Pro",
  badge: "COMING SOON",
  description:
    "Someone's talking about your token right now. Street Team answers — in your voice, while you sleep.",
  bullets: [
    "10 replies a day — only to people already talking about your token",
    "Positive posts only — never argues, never feeds the FUD",
    "Never the same account twice — no one gets spammed",
    "Your voice and your mascot, same as your posts",
    "You choose: reply as they land, or spread through the day",
    "Approve each one, or let it run",
  ],
  callout: "We show up for the people who show up for you. Never the timeline.",
  footNote: "Added at renewal — one payment, one date, no part-months.",
  bundleNote: "Pro Bundle? Street Team covers all three tokens at $60/month (not $25 × 3).",
  crossSellLabel: "Getting mentions? Street Team replies in your voice — coming soon →",
} as const;

export const PLAN_FAQS = [
  {
    question: "Does Pro work for tokens I didn't launch here?",
    answer:
      "Yes — connect any token by contract address. Pro is for any token on any supported chain.",
  },
  {
    question: "What does Drop Your Style mean?",
    answer:
      "You paste in example posts from anywhere. The AI reads them and learns how to write in that voice for your project.",
  },
  {
    question: "Can I start with Bond and upgrade later?",
    answer: "Yes — start free, upgrade any time from your account.",
  },
  {
    question: "How does the 3-month discount work?",
    answer:
      "Pay 3 months upfront and get 20% off. For Pro that's $120 instead of $150. For Pro Bundle that's $288 instead of $360.",
  },
  {
    question: "What's the difference between Pro and Pro Bundle?",
    answer:
      "Pro covers one token. Pro Bundle covers up to 3 tokens from one dashboard at a saving of $30/month.",
  },
] as const;

export function togglePlanFaq(currentOpen: number, requestedIndex: number): number {
  return currentOpen === requestedIndex ? -1 : requestedIndex;
}

export function planPriceForBilling(
  option: LaunchPathOption,
  billing: PlansBilling,
): string {
  if (option.id === "pro" && billing === "upfront") {
    return "$120 / 3 months · per token";
  }
  if (option.id === "pro-bundle" && billing === "upfront") {
    return "$288 / 3 months · up to 3 tokens";
  }
  return option.price;
}

export function proBundlePriceForBilling(billing: PlansBilling): {
  price: string;
  period: string;
  note: string;
} {
  return billing === "upfront"
    ? {
        price: "$288",
        period: "/3 months · USD",
        note: "Up to 3 tokens · saving $72 against monthly",
      }
    : {
        price: "$120",
        period: "/month · USD",
        note: "Up to 3 tokens · 20% off paid 3 months upfront",
      };
}

/** Single-line Pro Bundle price, matching the format `planPriceForBilling` uses for Pro's plan card. */
export function proBundlePlanPriceForBilling(billing: PlansBilling): string {
  return billing === "upfront"
    ? "$288 / 3 months · up to 3 tokens"
    : "$120/month · up to 3 tokens";
}
