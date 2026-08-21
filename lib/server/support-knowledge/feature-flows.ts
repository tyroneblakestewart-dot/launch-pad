import type { FeatureFlowEntry } from "@/lib/server/support-knowledge/types";

// Step-by-step descriptions of every real user journey in the app (issue
// #400), including what each status value means. Server-only grounding
// material for the admin "Suggest a fix" AI — kept factual and short; the
// canonical behaviour always lives in the code these summarise, not here.

export const FEATURE_FLOWS: FeatureFlowEntry[] = [
  {
    id: "wallet-connect-confirm",
    feature: "account",
    summary: "Connecting and confirming a wallet is the identity layer for every wallet-signed action in the app — there are no accounts/passwords.",
    steps: [
      "The user connects a wallet via the in-app wallet provider (RainbowKit/wagmi).",
      "For any wallet-signed action (publish, chat post, support ticket, Social Studio connect/approve), the app requests a short-lived one-time challenge from the server (lib/server/chat-auth.ts) bound to that wallet address and the action's payload.",
      "The wallet signs the challenge message; the server verifies the signature matches the claimed wallet address and that the challenge hasn't expired (~5 minutes) or already been used (single-use nonce).",
      "Every subsequent read/write for that action is scoped to the verified wallet address — there is no separate login/session for end users, only the admin dashboard has its own session cookie.",
    ],
  },
  {
    id: "token-creation-launch",
    feature: "site-builder",
    summary: "Creating and launching a token deploys a fixed-supply ERC-20 via HoodlumsTokenFactory (or the direct contract as a fallback) on a supported testnet, signed entirely in the user's wallet.",
    steps: [
      "The user fills in token name/ticker/supply in the Studio, connects a wallet, and confirms the correct testnet (Robinhood Chain Testnet 46630 or Monad 10143).",
      "The app calls launchToken() on HoodlumsTokenFactory when a factory address is configured for the connected chain, or falls back to deploying FixedSupplyMemeToken directly.",
      "The transaction is signed and sent from the user's own wallet — the app never custodies funds or signs on the user's behalf.",
      "Once confirmed on-chain, the launch is recorded and the user can proceed to the bonding curve / liquidity steps.",
    ],
  },
  {
    id: "generate-free-site",
    feature: "site-builder",
    summary: "Free-site generation builds a templated site (Hero, About, Tokenomics, How to Buy, Community sections) from the project's name/ticker/description/artwork, no AI style-matching required.",
    steps: [
      "The user fills in project details and uploads artwork in the Studio.",
      "POST /api/generate-free-site builds themed copy/colours (AI-assisted when a provider is configured, otherwise a deterministic client-side artwork colour matcher) and renders the free-site template.",
      "The generated HTML is validated for structural completeness and mobile-first responsiveness before being returned; a page that fails is rejected with a clear error rather than silently shipped broken.",
      "The result previews in the Studio; the user can then publish it or keep iterating.",
    ],
  },
  {
    id: "generate-bespoke-site",
    feature: "site-builder",
    summary: "Bespoke ('full website') generation uses AI to write a complete standalone HTML page, optionally matching an inspiration URL's visual style.",
    steps: [
      "The user requests a bespoke page from the Studio, optionally supplying an inspiration website URL to match its style.",
      "POST /api/generate-site-page/challenge gates access; POST /api/generate-site-page generates the page, inspecting the inspiration URL server-side if supplied.",
      "The generated HTML must pass structural completeness, safety-filter and mobile-first layout checks (isCompleteGeneratedPageHtml); a page rejected for layout reasons alone gets one automatic regeneration with corrective feedback before failing.",
      "The result previews in the Studio (single active iframe only, per CLAUDE.md rule 7) before the user chooses to publish.",
    ],
  },
  {
    id: "publish-site",
    feature: "publishing",
    summary: "Publishing makes a generated site durably public at hoodlums.dev/[slug], stored in Postgres, via a one-time wallet-signed challenge.",
    steps: [
      "The user picks a slug and requests a publish challenge (POST /api/publish/challenge), signs it in their wallet, then submits POST /api/publish with the signature and the generated HTML/artwork.",
      "The server verifies the signature, checks the slug is available and not a reserved word (lib/slug.ts), sanitises the HTML, and atomically inserts the row (published_sites.slug is uniquely constrained at the database level).",
      "Only the original publishing wallet can later change the site's visibility (POST /api/publish/visibility) via the same challenge/signature pattern.",
      "The published page is served at the dynamic /[slug] route, reading from Postgres — this is separate from any private draft still sitting only in the user's browser.",
    ],
  },
  {
    id: "hoodchat-flow",
    feature: "social-studio",
    summary: "Hoodchat is the wallet-signed community chat feed at /hoodchat, with category filters and automatic moderation.",
    steps: [
      "The user connects a wallet, requests a posting challenge (POST /api/hoodchat/challenge), signs it, and posts (POST /api/hoodchat/messages) with a category, capped at 280 characters and no links.",
      "Each wallet is limited to 5 Hoodchat messages per hour.",
      "A message auto-hides once it receives 3+ reports (POST /api/hoodchat/report); moderation is fully automatic, there is no manual admin approval queue for individual messages.",
      "The same pattern exists per-token on /token/[chain]/[address]'s chat tab (token-chat), with Holder/Dev badges instead of category filters.",
    ],
  },
  {
    id: "social-studio-setup-voice-mascot",
    feature: "social-studio",
    summary: "AI Social Studio Setup teaches the AI the project's writing voice from pasted real posts, and locks a mascot's visual identity from a reference photo — both gated to Pro/Pro Bundle plans.",
    steps: [
      "The user pastes several real posts into the Voice teacher; POST /api/social/voice-profile analyses tone/vocabulary/cadence/emoji habits into a reusable Voice profile.",
      "The user uploads a mascot reference photo; POST /api/social/mascot/visual-dna locks a description of the mascot's species/colours/props/art style.",
      "With a visual identity locked, POST /api/social/mascot/image generates scene images (chosen action/place chips) usable in Telegram posts or downloaded for X.",
      "Mascot image generation specifically requires a direct OPENAI_API_KEY on this deployment (not the Vercel AI Gateway fallback used elsewhere) — see the related system-dependency entry.",
    ],
  },
  {
    id: "social-studio-telegram-connect",
    feature: "social-studio",
    summary: "Connecting Telegram links a channel the platform bot is an admin of, verified server-side before the binding is ever stored.",
    steps: [
      "The user enters a public channel username (@channel) or numeric chat ID and requests a connect challenge, signed in their wallet.",
      "The server calls Telegram's getChat/getChatMember to confirm the configured bot is actually an admin of that channel before storing the binding — a channel the bot isn't an admin of is rejected with 'Telegram could not find that channel.'",
      "Once connected, approved posts can be sent to that channel; disconnecting uses the same wallet-signed challenge pattern.",
      "The whole feature ships dormant (returns 'not configured') until the owner sets TELEGRAM_BOT_TOKEN.",
    ],
  },
  {
    id: "social-studio-draft-generation",
    feature: "social-studio",
    summary: "AI draft generation writes one X post and one Telegram post per request, grounded only in the project's stated facts, with mechanical safety checks and one corrective retry.",
    steps: [
      "The user (from Setup's 'Draft with AI' or the Calendar's per-day button) requests a draft; POST /api/social/draft builds a prompt from the project's name/ticker/description/chain/contract, the taught voice, and an optional Direction brief.",
      "The model is given an explicit allowed-facts ledger and is instructed never to invent holder counts, prices, market caps, events, or dates.",
      "The parsed draft is mechanically checked for angle-form compliance, invented-fact patterns, banned-phrase repetition and the content-safety filter; a violation triggers exactly one automatic regeneration with corrective feedback naming the violation.",
      "If the retry also fails any check, the route returns a clean error rather than ever returning an unchecked or unsafe draft (issue #364).",
    ],
  },
  {
    id: "social-studio-queue-approve-schedule",
    feature: "social-studio",
    summary: "The Queue tab's Ready-to-review drafts only become a durable, trackable scheduled post once the owner/wallet explicitly approves — nothing sends unattended.",
    steps: [
      "Drafts accumulate client-side (IndexedDB) in 'Ready to review', auto-replenished up to a configurable per-project queue target when the tab is opened/focused.",
      "Approving a draft calls POST /api/social/posts once per selected destination (X and/or Telegram), wallet-signed via the shared challenge route — this is the only write that creates a row in social_scheduled_posts.",
      "A scheduled post can be canceled (POST /api/social/posts/cancel) or rescheduled (POST /api/social/posts/reschedule) up until the posting cron picks it up.",
      "The posting cron (/api/cron/social-posting) sends each destination independently with retry/backoff; a link-bearing X post is routed to a free 'needs_composer' hand-off instead of the paid API to control cost.",
    ],
  },
  {
    id: "support-ticket-flow",
    feature: "support-tickets",
    summary: "Support tickets are wallet-signed problem reports with owner replies from /admin — no AI auto-answer, everything here is a human reply.",
    steps: [
      "The user picks a category, writes a subject/description, optionally attaches one screenshot, requests a challenge and signs it, then submits (POST /api/support/tickets).",
      "The server assembles a diagnostics snapshot (plan/entitlement, connected-platform statuses, recent client-error count) at creation time and sends a best-effort Telegram alert to the owner (never the ticket body).",
      "The owner reviews and replies from /admin → Support, which flips the ticket to needs_user; the user can reply back (POST /api/support/tickets/[id]/reply), which clears needs_user back to open.",
      "The owner marks a ticket solved or closed when resolved; a solved/closed ticket can't be replied to by either side until the owner reopens it with a new reply.",
    ],
  },
];

export const SUPPORT_TICKET_STATUS_MEANINGS = [
  { status: "open", meaning: "New or awaiting an owner reply." },
  { status: "needs_user", meaning: "The owner replied; awaiting the reporting wallet's response." },
  { status: "solved", meaning: "The owner marked it resolved. Read-only until reopened by a new owner reply." },
  { status: "closed", meaning: "Closed without further action. Read-only until reopened by a new owner reply." },
];

export const SCHEDULED_POST_STATUS_MEANINGS = [
  { status: "scheduled", meaning: "Approved and waiting for the posting cron to send it at its scheduled time." },
  { status: "sent", meaning: "Successfully sent to every selected destination." },
  { status: "partially_sent", meaning: "Sent to at least one destination but not all — check the per-destination outcome in History." },
  { status: "failed", meaning: "Every destination failed permanently (retries exhausted, or a terminal error like a content-filter match)." },
  { status: "canceled", meaning: "Canceled by the wallet before it sent." },
  { status: "needs_composer", meaning: "Routed to a free X intent-composer hand-off instead of the paid API because the body contains a link — the user taps through to post it themselves." },
];

export const SOCIAL_CONNECTION_STATUS_MEANINGS = [
  { status: "connected", meaning: "Credentials verified and stored; ready to post." },
  { status: "reconnect_needed", meaning: "A confirmed broken connection (revoked token, bot removed as channel admin, unreadable credentials) — pending sends to this destination pause with backoff until the wallet reconnects." },
];
