# CLAUDE.md — standing context for AI coding sessions

Read this before making any change. It is the project's source of truth for
intent, rules, and workflow. `AGENTS.md` contains the same content for other
AI tools.

## What this project is

HOODLUMS Launch Platform (Next.js 16 + TypeScript) — a browser-based,
non-custodial workspace for preparing and testing meme-token launches.
It is **testnet-first**: no unattended mainnet deploys, no custody of funds,
never asks for seed phrases or private keys. Private project drafts live in
the browser; explicitly published sites live in Postgres. Every blockchain
action is signed in the user's own wallet.

Live site: hoodlums.dev (deployed on Vercel from `main`).
Owner: a solo non-developer founder — explain trade-offs plainly in PRs.

## Commands

```bash
npm install          # setup
npm run dev          # local dev server on :3000
npm run lint         # eslint
npm run test:app     # Vitest application suite
npm run test:contracts  # Hardhat Solidity tests (requires Node >= 22.13)
npm test             # both suites — run this before declaring work done
npm run build        # production build
npm run db:migrate   # apply db/migrations using server-only DATABASE_URL
```

## Architecture map

- `app/` — routes: `/` studio, `/providers`, `/allocations`,
  `/liquidity-lab`, `/bonding-curve`, `/testnet`, `/monad`, `/social`,
  `/hoodchat` (live community chat feed), `/account` (disabled preview),
  `/[slug]` (durable public generated site),
  `/token/[chain]/[address]` (any-token trade/chart/holder page, including
  the per-token Hoodchat tab). See README route table for status of each.
- `app/api/` — server routes: `generate-site-style` / `generate-site-page`
  (OpenAI-backed), `publish/challenge` and `publish` (single-use wallet-signed
  public publishing), `dexscreener-pair`, `generation-status`,
  `social/telegram`, and `hoodchat/*` / `token-chat/*` (single-use
  wallet-signed chat posting, reading and reporting).
- `app/[slug]/artwork/route.ts` — HTTP-fetchable OG/artwork image for a
  public generated site; not under `app/api`, so it is not part of
  `backend-inventory.test.ts`'s API route inventory.
- `lib/server/` — server-side logic including `api-protection.ts`, the
  Postgres pool/publish store, nonce/signature verification, generated-page
  sanitisation, and the public-site repository boundary.
- `db/migrations/001_public_publishing.sql` — durable `published_sites` and
  `wallet_nonces` schema. `published_sites.slug` is uniquely constrained at
  database level. `DATABASE_URL` is server-only and must never be committed.
- `lib/slug.ts` — shared website-path validation/reserved-word rules used
  by the studio save flow, publish endpoint, and public route.
- `contracts/` — Solidity: `FixedSupplyMemeToken.sol`,
  `HoodlumsTestLiquidityPool.sol` (test-only AMM),
  `HoodlumsTestBondingCurve.sol` (testnet curve + automatic pool graduation),
  and `HoodlumsTokenFactory.sol` (+ `.t.sol` tests): deploys fixed-supply
  burnable ERC-20s, records launches on-chain, collects a launch fee to the
  Hoodlums treasury, fee hard-capped at 0.1 native token, two-step
  ownership, reentrancy-guarded.
- `tests/` — Vitest suites. `backend-inventory.test.ts` intentionally fails
  when a new API route is added without tests — extend it, never delete or
  weaken it.

## Standing rules — do not break these

1. **Security posture is deliberate.** `/api/generate-site-style` is
   protected by `GENERATE_SITE_STYLE_SHARED_SECRET` (+ mirrored
   `NEXT_PUBLIC_` bridge value), an Origin check, and 10-req/hour per-IP
   rate limiting. Never remove or loosen these; new server endpoints that
   spend money or call paid APIs need equivalent protection and tests.
2. **Secrets stay server-side.** `OPENAI_API_KEY` and `DATABASE_URL` must
   never appear in client code or a `NEXT_PUBLIC_` variable. Never hardcode
   real secrets; fallback defaults must be treated as public.
3. **Testnet-first.** Do not add mainnet deployment paths, real-fund flows,
   or remove the chain-ID guards (Robinhood Chain Testnet `46630`, Monad
   `10143`) without an explicit request from the owner.
4. **Non-custodial.** Never add code that requests, stores, or transmits
   seed phrases or private keys. All signing happens in the user's wallet.
5. **Contract economics are owner decisions.** Fee percentages, fee caps,
   treasury addresses, and the bonding-curve/graduation fee model are set
   by the owner. Implement what the task specifies; don't invent or adjust
   fee numbers, and flag anything that changes who gets paid.
6. **Bonding-curve supply model is decided.** The complete current token
   supply enters the bonding curve before trading. The creator keeps no
   unlocked launch allocation, preventing a creator-held token balance from
   being sold into curve buyers. Creator earnings must come only through a
   separately approved creator-fee policy. Do not introduce creator-held
   launch tokens without an explicit owner decision.
7. **Mobile Safari is the primary UI target.** The primary target is mobile
   Safari on iPhone, and every UI change must be verified there before a PR
   is opened. PR #118 caused a mobile Safari memory crash, so never mount
   multiple live iframes simultaneously; keep only one active preview
   mounted. Keep large generated HTML and artwork data URLs out of React
   state and out of the initial client bundle. Clean up iframe `srcDoc`,
   refs, and event listeners on unmount or when switching previews. Prefer
   lightweight thumbnails, screenshots, or lazy-loaded previews over live
   documents.
8. **Tests are the referee.** Every behaviour change ships with tests, and
   the full existing suite must pass. Never mark work complete with failing
   tests, and never edit a test's assertions just to make it pass —
   if a test seems wrong, say so in the PR instead.
9. **Keep changes reviewable.** One concern per PR, plain-English
   description of what changed and why, note any trade-offs or caveats.
10. **The `/admin` dashboard is kept in sync — non-negotiable, same weight
    as rule 7.** Every time a new feature, page, or system integration is
    built and merged, `/admin` must be updated in the same PR, or an
    immediate follow-up PR opened right after. New public pages go in the
    Pages CMS section. New system integrations (X posting, Telegram,
    payment flow, etc.) go in System Health monitoring, each with its own
    pipeline stages. New revenue streams go in the Money section. New
    user-facing features go in the Activity log. A PR that ships a feature
    without its admin-cockpit counterpart is not done.

## Current roadmap (update as milestones land)

- HoodlumsTokenFactory (PR #91) is deployed and verified on Robinhood Chain
  Testnet at `0x39207baa4d0a30a5194770563ec586978c9fbcb3` (owner
  `0x3990b0b29f08c1D415978E8EDB93aD00E5dC966a`, treasury
  `0x505217CBbe3059993877983b4fDAD5C6e32AF1F5`, launch fee `0`), and
  `/testnet` (`components/testnet-launcher.tsx`) routes through
  `launchToken()` whenever a factory address is configured for the
  connected chain, falling back to the direct `FixedSupplyMemeToken`
  deployment otherwise. Milestone 1 is complete.
- HoodlumsTestBondingCurve is merged (PR #103). The `/bonding-curve` route
  is the fifth visible workflow step and currently explains the approved
  lifecycle. The curve is not deployed or factory-connected yet, and live
  quote/buy/sell controls are not active.
- HoodlumsTestBondingCurve trading fees are decided and implemented
  (issue #112): 1% on every buy and sell, split 60% protocol treasury /
  40% creator (`TRADING_FEE_BPS = 100`, `PROTOCOL_FEE_SHARE_BPS = 6000`,
  `CREATOR_FEE_SHARE_BPS = 4000`). The treasury address is now a required,
  non-zero constructor parameter alongside creator. Fees are pull-payment
  only — buys/sells only credit `treasuryFeeBalance` / `creatorFeeBalance`,
  never push native currency, and each recipient withdraws via
  `withdrawFees()`. `realNativeReserve` and the graduation target only
  count post-fee amounts; fee balances stay outside pool liquidity and
  remain withdrawable after graduation. The curve is still not deployed or
  wired into live UI controls.
- Durable public publishing is implemented for review: Postgres via
  server-only `DATABASE_URL`, migration-managed `published_sites` and
  `wallet_nonces`, five-minute single-use EVM message challenges, atomic
  nonce consumption and unique-slug insertion, size-capped artwork/HTML,
  server sanitisation, and dynamic `/[slug]` reads. No login sessions or
  user accounts were added. Production migration and first write enablement
  must remain deliberate and owner-reviewed; this first write-endpoint PR
  must not be auto-merged.
- Hoodchat (issue #237) is implemented for review as two features sharing
  wallet-signed posting auth (`lib/server/chat-auth.ts`) and moderation
  rules (`lib/server/chat-moderation.ts`, 280-char cap, link rejection,
  auto-hide at 3 reports): the main `/hoodchat` feed
  (migration `008_hoodchat.sql`, `hoodchat_messages`) with category filters,
  and a per-token chat tab on `/token/[chain]/[address]`
  (migration `009_token_chat.sql`, `token_chat_messages`) with Holder/Dev
  badges. Posting challenges are held in memory (5-minute TTL) rather than
  in a durable table — reasonable for a chat feature, unlike site
  publishing. Both features are wired into System Health and the
  `hoodchat` service-isolation switch; the main feed's headings are in the
  Pages CMS. Production migration and first write enablement must remain
  deliberate and owner-reviewed.
- The X outreach bot (issue #298) — a congratulations-only, approve-first
  posting queue for graduating pump.fun tokens — is implemented for review
  but ships dormant. Draft generation (the `/api/cron/outreach` job, every
  30 minutes) is gated behind `OUTREACH_QUEUE_ENABLED` (off unless exactly
  `"true"`); posting is separately hard-gated on all four `X_OUTREACH_*`
  credentials being present, checked both in the disabled Approve button and
  independently in the approve API route. Dedupe-forever (by token mint and
  by creator X handle, including dismissed drafts) is enforced by partial
  unique indexes in `db/migrations/013_outreach.sql`, not application code
  alone. Wired into System Health, the `outreach` service-isolation switch,
  and a new Outreach admin section. Turning posting on for real is an
  explicit future owner decision.
- Generated-site desktop/mobile quality (issue #303): the bespoke AI page
  generator (`lib/site-page-openai-pipeline.ts`) now carries non-negotiable
  responsive/layout-quality prompt rules (viewport meta, fluid units/media
  queries for 390/768/1280px+, a centred max-width desktop container,
  `scroll-behavior: smooth`, no horizontal overflow), and
  `isCompleteGeneratedPageHtml` (`lib/generated-site-page.ts`) mechanically
  rejects output with no responsive signal at all or a wide fixed-pixel
  container outside any breakpoint. See `docs/responsive-qa.md` for the
  manual screenshot pass this mechanical check can't replace. Separately,
  Roadmap and FAQ were removed entirely (not just defaulted off) from the
  free-site sections (`lib/free-site-sections.ts`): the current set is
  Hero (always), About, Tokenomics, How to Buy, Community. Stale
  `siteSections.roadmap` / `.faq` flags on projects saved before this
  change are ignored, not migrated or rejected.
- Generated-site layout enforcement and page-skipping fixes (issue #323):
  `isCompleteGeneratedPageHtml` now also rejects an always-active
  three-or-more-column CSS grid with no max-width breakpoint that ever
  stacks it (the "desktop layout squished onto the phone" bug); a bespoke
  page rejected for that reason alone gets one automatic regeneration with
  corrective feedback (`app/api/generate-site-page/route.ts`) before
  failing. `prepareGeneratedPageForPreview` and the served `/[slug]` page
  shell (`app/[slug]/public-site-reset.css`) both carry a code-enforced
  `overflow-x: hidden` safety net independent of that validator. The
  homepage `HoodlumsSocialShowcase` now keeps every slide's visual mounted
  in one CSS-stacked grid cell (so rotating slides can never change the
  section's layout height) and pauses its auto-advance timer while
  scrolled off screen; `BuildSiteGate`'s 250ms poll only rewrites the
  checklist DOM when its content changed, and skips itself entirely while
  a builder-panel text input has focus unless readiness truly flipped. The
  generated-page preview's height-report bridge is debounced to once per
  animation frame, and the consumer ignores sub-24px height deltas and
  refuses to shrink the frame while the window is mid-scroll. The free-site
  template's ledger tokenomics variant now derives its surface and ink
  from the same `--surface`/`--text` theme variables as the rest of the
  template instead of a color-mix that always resolved to a near-white
  paper card regardless of palette.
- Mobile preview shell fixes, scoped to the studio's preview only — never
  desktop rendering or the generated-site output (issue #327). Problem 1:
  the windowed (non-fullscreen) preview on phones sized the iframe's own
  height from the generated page's *reported* content height, which is
  unstable whenever the page sizes a block in viewport-relative units (the
  free-site template's centred hero and body both do) — feeding that report
  back into the very iframe height those units resolve against inflated the
  iframe far past one screen, pushing hero content below the visible slice.
  `layout()` (`components/full-website-generator.tsx`) now derives the
  mobile design height from the space actually available instead
  (`getMobileGeneratedPreviewDesignHeight`); desktop's reportedHeight-driven
  sizing is untouched. Problem 2: mobile full screen now reaches every
  screen edge via a `100dvh`-preferred fallback chain (`100vh` →
  `-webkit-fill-available` → `100svh` → `100dvh`) instead of a bare
  `100svh`, and the control bar no longer reserves a permanent layout row.
  Problem 3: mobile full-screen controls default to hidden and slide in as
  a tap-to-reveal overlay (video-player pattern) — visible for 2s on entry,
  4s after a tap, indefinitely while focus is inside for keyboard/VoiceOver
  users. A tap landing inside the sandboxed iframe never bubbles to the
  parent DOM, so `prepareGeneratedPageForPreview`
  (`lib/generated-site-page.ts`) gained an opt-in `reportTaps` option that
  injects a click-forwarding bridge script; the published `/[slug]` route
  does not pass it, so that route's output is unchanged. Desktop full
  screen keeps its permanently visible control bar throughout.
- AI Social Studio Setup, Calendar and Queue tabs are activated (issue
  #332): teach-your-voice (paste-posts textarea → `POST
  /api/social/voice-profile` → a real Voice preview), AI draft generation
  (`POST /api/social/draft`, shared by the Setup "Draft with AI" button and
  the Calendar per-day "AI makes it" button, hard-capped at 280 characters
  for X via the existing `xCharacterCount` logic), mascot scene images
  (`POST /api/social/mascot/visual-dna` to lock a visual identity from an
  uploaded reference photo, then `POST /api/social/mascot/image` per chosen
  action/place chip — attachable to the Telegram publish and downloadable
  for X), and a real manual Queue (drafts from Setup/Calendar accumulate,
  each editable, each posted only by an explicit tap — no unattended
  auto-posting). All four new routes share the existing shared-secret +
  Origin + per-IP protection stack (`lib/server/api-protection.ts`,
  extended `PROTECTED_GENERATION_ROUTES`) and a new
  `lib/server/social-studio-entitlement.ts` check against the same
  canonical `getSubscriptionAccess` (Pro/Pro Bundle) decision the `/social`
  page's `SubscriptionAccessGate` already uses — issue #328's wallet
  test-access allowlist was not present in the codebase at implementation
  time, so gating hooks into that single canonical function directly and
  will inherit any allowlist #328 adds without further changes. Voice
  profile, mascot visual DNA and the manual queue persist per project in a
  new `lib/social-studio-db.ts` IndexedDB store (heavy blobs — mascot
  images, queue artwork — stay out of localStorage and out of long-lived
  React state, following the #307 pattern in `lib/token-project-db.ts`).
  Screenshot-to-text for teaching the AI's voice is deliberately deferred
  with a visible note rather than built now. Mascot image generation only
  works with a direct `OPENAI_API_KEY` (not the Vercel AI Gateway
  fallback) and fails closed with a clear 503 otherwise; voice profile and
  draft generation work on either provider. The Settings & Rules tab, the
  "Pick a Hoodlums bot" row, the Queue tab's performance/history cards, and
  the Calendar tab's "I'll post my own" button and quiet-hours controls
  remain their existing "coming soon" placeholders — out of this issue's
  itemised scope. `/admin` gained a `social-studio-ai` System Health
  pipeline (provider/isolation/origin/rate-limit/entitlement/mascot-image-
  provider stages) and service-isolation switch, following the
  `website-generation` pattern; it has no Postgres table of its own, so no
  Pages CMS or Activity log changes were needed.
- `017_social_studio_ai_service_control.sql` (merged separately via #336)
  widened `admin_service_controls_known_service` /
  `admin_activity_log_known_service` for `social-studio-ai`, which #334 had
  added to `ADMIN_SERVICE_DEFINITIONS` without a matching migration.
- Social Studio connections + Mode 1 review-and-release posting (issue
  #335) backend is implemented for review — real per-wallet X and Telegram
  connections plus a durable, browser-independent approve-first scheduled-
  post queue. Approval IS the create: nothing is written to
  `social_scheduled_posts` before a wallet has explicitly approved it
  (migration `018_social_studio_connections.sql`, renumbered above #336's
  `017_social_studio_ai_service_control.sql` to keep migration numbers
  unique and ordered — it also widens
  `admin_service_controls_known_service` / `admin_activity_log_known_service`
  a second time to add `social-posting` and seeds its default not-isolated
  row, since `ADMIN_SERVICE_DEFINITIONS` gained that key in this same PR),
  so "unapproved posts never send" holds by construction. X uses a real
  3-legged OAuth 1.0a connect flow (`lib/server/social-x-client.ts`,
  `X_SOCIAL_CONSUMER_KEY`/`SECRET`, a deliberately distinct app from the
  dormant outreach bot's `X_OUTREACH_*`); the actual `POST /2/tweets`
  signing/call is shared with the outreach bot via
  `lib/server/x-tweets-client.ts` + `lib/server/x-oauth1-signing.ts`.
  Telegram gets a real connect flow (`lib/server/social-telegram-connect.ts`)
  that verifies the platform bot is actually an admin via
  `getChat`/`getChatMember` before ever storing a channel binding, instead
  of trusting a bare chat-ID field. Every wallet-signed action (connect,
  disconnect, approve-a-post, cancel-a-post) reuses
  `lib/server/chat-auth.ts`'s challenge/signature primitives from Hoodchat
  (issue #237) through a single generic challenge route
  (`POST /api/social/challenge`) rather than duplicating that flow per
  action. Stored credentials (X tokens, Telegram channel bindings) are
  AES-256-GCM encrypted at rest (`lib/server/social-credentials-crypto.ts`,
  `SOCIAL_CREDENTIALS_ENCRYPTION_KEY`) — decrypt failure or a missing key
  fails closed, never throws into a crash. The shared posting engine
  (`lib/server/social-posting-cron.ts`, run from
  `/api/cron/social-posting`) retries each destination independently with
  exponential backoff up to five attempts before marking it permanently
  failed; a confirmed broken connection (revoked X token, bot removed as a
  channel admin, unreadable credentials) immediately flips that connection
  to `reconnect_needed` and pauses its still-pending destinations with a
  long backoff so they resume automatically once the user reconnects,
  rather than being lost — ordinary transient errors only reach
  `reconnect_needed` after repeated failures. `/admin` gained a
  `social-posting` System Health pipeline and service-isolation switch
  (destinations/encryption-key/table-exists/queue-counts stages, following
  the `outreach` pattern) and four new Activity log kinds for connect/
  disconnect events; there is no dedicated `/admin` management section
  since the queue itself lives in `/social`, not `/admin`. Ships dormant
  per destination: `X_SOCIAL_CONSUMER_KEY`/`SECRET` and
  `TELEGRAM_BOT_TOKEN` are both owner-set env vars, named in `.env.example`.
  **Deliberately out of scope for this PR** (per the issue's own "Scope
  split if needed" note): Mode 2 full autopilot (unattended generate+post)
  is not built — every send still requires a prior explicit per-post
  approval recorded in `social_scheduled_posts.approved_by_wallet`, so
  #332's "no unattended auto-posting" note is not superseded yet. The
  `/social` Queue tab UI (connection cards, per-post approve/schedule/
  destination-toggle controls calling these new routes) is also not wired
  up yet — the backend is ready for it, but touching `social-hub.tsx`
  needs a dedicated pass with real mobile Safari verification per rule 7,
  which this PR could not do.
- PR #333 fallout corrected (issue #338), scoped to `lib/generated-site-page.ts`
  and `components/full-website-generator.tsx`. Fix 1: the full-screen tap
  bridge's interactive-element selector is narrowed back to genuinely
  clickable things (`a[href]`, `button`, `input`, `select`, `textarea`,
  `summary`, `audio[controls]`, `video[controls]`, `[role='button']`,
  `[role='link']`) — PR #333 had widened it to `[tabindex]`, `[onclick]`,
  bare `label` and a long role list, so a generated page wrapping whole
  sections in a tabindexed or onclick-bearing container ate the reveal
  gesture almost everywhere; the narrowed selector was chosen over the
  fallback "any non-scrolling tap toggles" contract the issue offered as
  plan B. Fix 2: the blanket ≤640px `!important` force-stack reset (which
  bent every desktop-first page into fake mobile columns, masking whether
  generation was genuinely mobile-first, and flattened legitimate
  side-by-side mobile design on every page including correctly designed
  published sites) is replaced by the original #324 minimal seatbelt
  (`overflow-x` clamp, box-sizing/min-width:0, overflow-wrap) with no
  flex/grid-direction opinion of its own. Fix 3: the returned bottom black
  band was the windowed (non-full-screen) mobile preview container, which
  had never received #327 problem 2's dvh-preferred fallback chain — only
  the full-screen rule had it — so the dead-band bug was still live in the
  default view before a creator ever tapped "Full screen"; both rules now
  share the same `100vh → -webkit-fill-available → 100svh → 100dvh` chain,
  with a regression test locking in both. Fix 4: `hasResponsiveBaseline`'s
  desktop-squish detector (issue #323/#325/#326) is tightened from
  "reject 3+ unstacked tracks, or 2 with a wide fixed track, unless a
  max-width breakpoint later stacks it" to a strict rule with no escape
  hatch — any 2+-track grid or unstacked flex row outside a `min-width`
  media query is rejected outright, since relying on a phone-only override
  to fix a desktop-first base is itself the clamped-not-designed pattern.
  This is the shared acceptance gate for both the bespoke AI pipeline and
  the free-site template (`app/api/generate-free-site/route.ts`), so the
  free-site template's tokenomics `.stat-grid` (the one variant that was
  still an always-active two-up grid) was fixed to stack at base and
  expand only from `min-width:480px`/`768px`
  (`docs/free-site-template-source.html`); every other template variant
  was already mobile-first and needed no change. Because this stricter
  acceptance gate would otherwise retroactively break already-published
  pre-#326 sites and crash the studio's reopen flow for old drafts,
  *rendering* already-stored content (the studio preview via
  `prepareGeneratedPageForPreview` and the served `/[slug]` route) now
  uses a new, deliberately looser export,
  `isStructurallyCompleteGeneratedPageHtml` (structural/safety checks
  only, no responsive-baseline check), while *accepting* new or
  newly-(re)published content still goes through the strict
  `isCompleteGeneratedPageHtml`. The studio surfaces this gap directly:
  reopening a saved draft or published site whose stored HTML fails the
  strict gate for layout reasons alone (`isGeneratedPageRejectedForLayoutOnly`)
  now renders a visible "Regenerate for mobile" prompt in the preview
  controls bar instead of silently relying on the seatbelt clamp.
