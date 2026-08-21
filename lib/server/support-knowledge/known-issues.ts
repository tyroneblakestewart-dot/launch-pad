import type { KnownIssueEntry } from "@/lib/server/support-knowledge/types";

// Historically-fixed real issues, seeded as entries per issue #400 — these
// are the recurring patterns most worth an AI suggestion recognising by
// name, since a ticket describing one of these usually isn't a new bug.

export const KNOWN_ISSUES: KnownIssueEntry[] = [
  {
    id: "wallet-app-account-differs-388",
    title: "Wallet-app account differs from the confirmed wallet",
    relatedIssue: "#388",
    symptom:
      "A wallet-signed action fails authorisation (e.g. 'Wallet authorisation failed.') even though the user insists their wallet is connected — often after switching accounts inside their wallet app (e.g. MetaMask/Rainbow) without reconnecting in the browser.",
    cause: "The site's connected-wallet state can silently diverge from the wallet app's currently active account, so the signature comes from a different address than the one the app believes is connected.",
    fix: "Ask the user to fully disconnect and reconnect their wallet in the app (not just switch accounts inside the wallet app), confirming the address shown matches what they expect, then retry.",
    keywords: ["wrong wallet", "different wallet", "different account", "authorisation failed", "signature failed", "switched account", "metamask account"],
  },
  {
    id: "connection-not-held-across-tabs-384",
    title: "Wallet/platform connection state not held across tabs",
    relatedIssue: "#384",
    symptom: "A user reports a connection (wallet, or a Social Studio platform connection) that was working in one tab appearing disconnected in another, or a state change in one tab not reflecting in another until refresh.",
    cause: "Connection state isn't always reactively synced across multiple open tabs/windows of the app.",
    fix: "Ask the user to refresh the affected tab, or close duplicate tabs and work from a single tab for connection-sensitive actions.",
    keywords: ["multiple tabs", "another tab", "different tab", "shows disconnected", "out of sync"],
  },
  {
    id: "stale-drafts-blocking-generation",
    title: "Stale local drafts blocking new generation",
    relatedIssue: null,
    symptom: "A user reports the Studio seeming 'stuck' on an old project, generation not reflecting their latest edits, or a page that won't regenerate.",
    cause: "Private project drafts live in the browser (IndexedDB/localStorage); a stale or corrupted local draft can shadow the user's intended current state.",
    fix: "Ask the user to start a fresh project in the Studio, or clear the specific project's local draft, rather than assuming a server-side bug.",
    keywords: ["stuck", "won't update", "old version", "stale draft", "not saving", "won't regenerate"],
  },
  {
    id: "plan-not-recognised-reconfirm-wallet",
    title: "Plan/subscription not recognised — re-confirm wallet",
    relatedIssue: null,
    symptom: "A user who paid for Pro/Pro Bundle/Bond reports being blocked by an upsell/entitlement gate as if they're on the free tier.",
    cause: "Plan entitlement (getSubscriptionAccess) is looked up by the currently connected wallet address — paying from one wallet and browsing connected as another (or a wallet-switch mid-session) reads as no active plan.",
    fix: "Ask the user to confirm they're connected with the exact wallet address that made the payment, and to reconnect if unsure.",
    keywords: ["plan not working", "paid but", "pro not recognised", "upsell even though I paid", "subscription not showing", "wrong plan"],
  },
  {
    id: "content-filter-rejection",
    title: "Content-filter rejection on generation or a chat/social post",
    relatedIssue: "#392",
    symptom: "A generation request or chat/social post is rejected with a 'failed our content safety filter' style error, and the user disputes it was inappropriate.",
    cause: "Issue #392's deterministic filter blocks slurs/hateful content and sexualisation of minors only (profanity/crude humour/violence/drugs are deliberately NOT filtered) — a rejection is sometimes a false-ish trigger from an unusual name/ticker colliding with a blocked term via leetspeak/separator matching.",
    fix: "Ask what exact text triggered it (never share the matched term back); if it looks like a legitimate false positive, escalate to the owner to review lib/server/content-filter.ts's term list rather than promising an override.",
    keywords: ["content filter", "safety filter", "blocked my post", "flagged", "rejected as inappropriate", "false positive"],
  },
  {
    id: "duplicate-send-history",
    title: "Duplicate-looking sends in posting History",
    relatedIssue: "#378, #381, #383",
    symptom: "A user reports the same social post appearing to have sent twice, or History showing what looks like a duplicate entry.",
    cause: "Historical races in the posting cron/retry path around duplicate-send protection were fixed across issues #378/#381/#383 (see lib/server/social-post-duplicate-detection.ts and the claim-lock migration 024_social_posting_claim_lock.sql) — a report on a current build is more likely a display/read issue than a live duplicate-send bug, but should still be checked against the actual destination (X/Telegram) if the user insists two real posts appeared.",
    fix: "Ask for a screenshot of the duplicate in History and, if possible, a link to the actual duplicate post on the platform, before assuming it's cosmetic.",
    keywords: ["posted twice", "duplicate post", "sent twice", "double posted", "shows twice"],
  },
];
