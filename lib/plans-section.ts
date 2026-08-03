import type { LaunchPathOption } from "./launch-paths";

export type PlansBilling = "monthly" | "upfront";

export const PLANS_BILLING_OPTIONS: ReadonlyArray<{
  id: PlansBilling;
  label: string;
}> = [
  { id: "monthly", label: "Monthly" },
  { id: "upfront", label: "3 months · −20%" },
];

export const PRO_BUNDLE_FEATURES = [
  "Everything in Pro for each of your 3 tokens",
  "15 posts/day · 6 AI images — allocate across your tokens however you like",
  "Cross-token analytics — instantly see which project is gaining traction fastest",
  "Drop your style and mascot for each token — three distinct voices, three distinct characters",
  "One dashboard to manage it all",
  "Priority support",
  "20% off when you pay 3 months upfront ($288 instead of $360)",
] as const;

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
