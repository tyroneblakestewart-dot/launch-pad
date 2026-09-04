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
  remain withdrawable after graduation. A one-off **5% graduation fee**
  (`GRADUATION_FEE_BPS = 500`, owner decision 4 Sep 2026) on the native
  reserve is credited 100% to the treasury at graduation; only the other 95%
  seeds the locked pool. The curve is still not deployed or
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
- X posting cost control (issue #342): the shared posting engine
  (`lib/server/social-posting-cron.ts`) never sends a link-bearing body
  through the paid X API — `lib/server/social-link-detection.ts`'s
  `bodyContainsLink` (scheme URLs, `www.`, bare "word.tld" domains from an
  allowlist, known shorteners; decimals/version strings/cashtags are
  deliberately not matched) gates every X destination before send. A match
  routes that destination straight to a new terminal `needs_composer`
  status instead of calling the API — free X intent-composer handoff, no
  connection/credential state touched — with a plain-English reason stored
  in the existing `error_message` column and surfaced by the already-shared
  `GET /api/social/posts`. Every remaining (link-free) X send is metered:
  `lib/server/social-x-cost-store.ts` records an estimated cost
  (`social_x_send_costs`, migration `019_social_x_cost_control.sql`, which
  also adds `needs_composer` to both the destination- and post-level status
  enums) and the cron refuses to spend past an owner-configurable monthly
  cap per wallet (`SOCIAL_X_API_SEND_COST_USD` / `SOCIAL_X_MONTHLY_COST_CAP_USD`,
  both optional with sensible defaults) — over-cap sends pause (not fail)
  until next month, Telegram unaffected. Draft-generation prompts
  (`lib/server/social-draft-pipeline.ts`) now instruct the model to never
  include a link, assuming it lives in the X bio/Telegram description
  instead; `/api/social/x/connect/start` returns a `bioLinkHint` string for
  the (not yet built) X-connect UI to show. `/admin`'s existing
  `social-posting` System Health pipeline gained a `cost-cap` stage (spend
  this month, configured rate/cap, wallets at/over cap) and its
  `queue-counts` stage now reports `needs_composer` alongside the existing
  statuses. Deliberately out of scope, consistent with #335's own Queue-tab
  deferral (rule 7, needs live mobile Safari verification this pass
  couldn't do): no UI renders the `needs_composer` "tap to post" list yet —
  the backend/API is ready for it. Also out of scope: confirming whether X
  media/image attachment is separately priced under the pay-per-use model
  (no live web access in this session to check current X docs) — flagged
  for the owner to verify directly; today's code never attaches mascot
  images to an X API send regardless (Telegram-only or manual composer
  download), so this doesn't change current behaviour either way.
- Social Studio Queue tab (issue #352) wires the previously-inert
  `components/social-hub.tsx` Queue tab to the real backend from #335/#344
  — the "no UI" gap those PRs deliberately left. Three sections in order:
  "Ready to review" (the existing local `queue`/IndexedDB pool — edit
  inline, per-item destination toggles limited to actually-connected
  platforms via `GET /api/social/connections`, and Approve); "Approved &
  scheduled" (`GET /api/social/posts` rows with status `scheduled` or
  `needs_composer`, with Cancel and a `needs_composer` "tap to post" X
  intent-composer hand-off); and History (`sent`/`partially_sent`/
  `failed`/`canceled`, with a per-destination outcome and a "Reconnect" tap
  to Setup when a failure lines up with a `reconnect_needed` connection).
  Because `POST /api/social/posts` stores one shared `body` per post but
  `QueueItem` keeps separate `xText`/`telegramText`, approving a draft to
  both destinations makes one wallet-signed call per selected destination
  (`lib/social-studio-queue.ts` + inline `approveQueueItem` in
  `social-hub.tsx`) rather than stretching the single-body schema — no new
  route needed, matching rule 10. Auto-replenish is client-side only, per
  the issue's explicit boundary against background generation cost: it
  fires on Queue-tab open, on window/tab focus while that tab is active,
  and after an approve or delete, generating exactly the shortfall to a
  new, per-project, Settings & Rules-configurable `queueTarget` (default
  5, capped at `MAX_QUEUE_TARGET` = 20 in `lib/social-studio-types.ts`),
  guarded by an in-flight ref so overlapping triggers never double-generate.
  `queueTarget` extends the existing `SocialStudioProjectRecord` and rides
  #350's migrate-on-read normalisation in `lib/social-studio-db.ts`, so
  pre-#352 saved records default it instead of failing to load. Pure
  classification/spread/shortfall/clamp logic lives in
  `lib/social-studio-queue.ts`, unit-tested directly in
  `tests/social-studio-queue.test.ts` rather than only through the
  existing source-string assertions in `tests/social-studio-ui.test.ts`.
  Not verified on a real mobile Safari device this pass (rule 7) — the
  Ready-to-review card now carries four actions (Approve, the pre-existing
  quick Post to X / Send to Telegram, and Delete) plus destination toggles
  and a schedule picker, and that density has only been checked by reading
  the CSS, not on-device at 390px; flagged for the owner to confirm.
  Background replenishment (generating drafts while the user is away) is
  explicitly out of scope, as the issue specifies — a future full-autopilot
  mode would need to reuse #344's per-wallet monthly X cost cap.
- Compact draft cards, Direction brief and posting cadence (issue #358).
  Ready-to-review cards now collapse by default to a single clamped X-body
  preview with its character count, with the Telegram variant and both
  editable fields behind a per-card expand toggle
  (`expandedQueueItemIds`/`toggleQueueItemExpanded` in
  `components/social-hub.tsx`, ephemeral UI state, never persisted); the
  schedule picker moved from a full-width labeled row to a compact inline
  `datetime-local` control. Tighter padding/gaps land in
  `components/social-hub.module.css` (`.queueList`/`.queueItem`/
  `.queueItemBody`) at both desktop and the existing 480px breakpoint,
  without touching #356's action row. A new optional **Direction brief**
  free-text field in Settings & Rules ("Tell the AI your focus this week")
  persists per project (`SocialStudioProjectRecord.directionBrief`,
  migrate-on-read defaulted to `""` in `lib/social-studio-db.ts`) and is
  threaded into `buildDraftRequestBody`
  (`lib/server/social-draft-pipeline.ts`) as secondary, explicitly
  non-verbatim steering behind the taught voice and liked-line
  reinforcement — an empty/whitespace-only brief adds no instruction text,
  so it changes nothing about generation. A new single-select **Posting
  cadence** (Conservative 1–2/day, Active 3–5/day, default Active) replaces
  the old free-numeric "Ready to review target" input; each tier's
  `postsPerDayMax` is asserted in tests to never exceed the new
  `MAX_POSTS_PER_DAY = 5` plan-entitlement constant
  (`lib/social-studio-types.ts`) and no third, higher tier is offered.
  Selecting a cadence drives both the existing `queueTarget` replenish size
  and the default schedule-time spread for newly-approved drafts — waking
  hours (07:00–23:00) divided evenly across the cadence's daily ceiling via
  `cadenceQueueTarget`/`cadenceSpreadHoursMs`/`normalisePostingCadence` in
  `lib/social-studio-queue.ts` — rather than the previous fixed 2-hour
  spread. At the 5/day ceiling this is unchanged from before (Active's
  target was already `DEFAULT_QUEUE_TARGET = 5`), and X API cost stays
  around $2.25/wallet/month against the existing `SOCIAL_X_MONTHLY_COST_CAP_USD`
  default of $5 (issue #342), so no cap change was needed. Not verified on
  a real mobile Safari device this pass (rule 7) — the new card density and
  compact schedule control were checked by reading the CSS against the
  390px breakpoint already in use, not on-device; flagged for the owner to
  confirm. Per-content-type toggles (milestone announcements, market
  moments, community posts, mascot drops, replies to mentions) shown in the
  issue's mockup remain a follow-up, out of scope for this PR.
- Draft-generation fact invention and phrase repetition are structurally
  blocked, and the corrective-retry fail-open bug from #363 is fixed (issue
  #364), both scoped to `lib/server/social-draft-pipeline.ts` and
  `app/api/social/draft/route.ts`. `buildDraftRequestBody` now emits an
  explicit allowed-facts ledger — project name, ticker, description, chain,
  contract address and direction brief only, deliberately never token
  supply since this route doesn't receive it — stating the description/brief
  are source material rather than permission to infer adjacent facts, and
  prohibiting invented holder counts, prices, market caps, liquidity/listing/
  partnership events, dates and milestones. `resolveDraftAngle` now skips
  the `milestone`, `holder-shoutout` and `behind-the-scenes` angles
  (`FACT_DEPENDENT_ANGLE_KEYS`) entirely whenever no direction brief is
  supplied, since the model has nothing real to ground them in; with a
  brief, every angle (including those three) is reachable and every factual
  detail must trace to the brief or another allowed fact. A new
  deterministic `checkDraftFactualRisk` rejects number-plus-metric and
  event-claim patterns (holder/wallet counts, dollar figures, percentage
  moves, "liquidity pool is live", "listed on…", "partnered with…", "first"
  claims) regardless of angle, and `extractRepeatedPhrases` flags
  distinctive 2–6 word phrases recurring across 2+ of the recent drafts
  already in Ready to review so `checkDraftRepetition` can reject their
  reuse by name, alongside a static "isn't just X, it's Y" ban. In
  `app/api/social/draft/route.ts`, the combined `checkDraftCompliance`
  (angle, then factual-risk, then repetition) now runs on the first
  response *and* again on the corrective retry's response — previously the
  retry's draft was returned unchecked, so a second bad draft could slip
  through as if it had passed. If the retry still fails a check, or the
  retry request itself errors, the route now returns a safe error instead
  of ever returning an unsafe or unchecked draft — a missing draft is
  recoverable, a fabricated market claim handed to a user ready to publish
  is not.
- Live operating-cost and margin cockpit shipped in `/admin` as a new
  Operations tab (issue #368), implemented for review. Every measurable paid
  OpenAI provider attempt — not just the outer HTTP request, so parse
  retries, corrective retries and layout retries each meter separately — is
  recorded as its own row in `ai_operation_costs` (migration
  `022_operations_costs.sql`, alongside a `fixed_operating_costs` table for
  owner-entered recurring costs) from the Responses API's own returned
  `usage` (`lib/server/ai-usage.ts`), never a prompt-length estimate, priced
  via `lib/server/ai-pricing.ts`'s configurable
  `OPENAI_*_COST_USD_PER_*`/`OPENAI_IMAGE_COST_USD_PER_IMAGE` env rates
  (documented defaults matching gpt-5-mini and gpt-image-1's official
  pricing at implementation time — see `.env.example`). Recording is
  best-effort and never blocks or changes a route's response: every AI route
  (`generate-site-page`, `generate-free-site`, `generate-site-style`, and
  all four `/api/social/*` AI routes) calls it through a `runAfterResponse`
  wrapper around Next's `after()` that falls back to an unawaited
  fire-and-forget when `after()` throws outside a real request scope (e.g.
  in tests), and a failed insert is caught and logged, never surfaced to the
  caller. `mascot-image-request.ts` explicitly requests `quality: "medium"`
  as a fixed owner decision, not a configurable setting — only the image's
  per-unit **price** (`OPENAI_IMAGE_COST_USD_PER_IMAGE`) is configurable;
  `gpt-image-1` itself is unchanged and is a known-deprecated follow-up, not
  addressed here. The pre-existing X-cost bug where a DB failure in
  `costStore.recordSend` after a successful post could flip that post's
  status is now caught and logged the same way — the destination stays
  `sent` either way; `social_x_send_costs` remains the sole X-cost source of
  truth and is unioned/aggregated with `ai_operation_costs`, never
  duplicated into it. `lib/server/admin-operations-costs.ts` aggregates
  today/this-month/last-month variable (AI+X) and prorated-fixed cost against
  verified `plan_payment_events` revenue (pure UTC boundary/proration math in
  `lib/operations-cost-math.ts`), a this-month feature breakdown, an
  attributed-vs-unattributed wallet reconciliation (free-site/site-style
  requests carry no wallet by design, so their cost is genuinely
  unattributed rather than hidden inside a wallet total) with a bounded
  top-10 wallet table showing each wallet's plan and test-allowlist status,
  and a bounded 30-item reverse-chronological ledger. A top wallet's current
  plan/test-access badge is derived from today's sources of truth at read
  time — active (non-revoked) `test_access_wallets` rows and current
  (non-expired) recurring-subscription lifecycle state — never from
  historical `ai_operation_costs.access_source`, which is retained only as
  per-row historical metadata; verified revenue is read strictly from
  `plan_payment_events`; a tester's row can therefore show `Test access`
  with `$0` verified revenue. Fixed-cost CRUD lives behind a new
  `app/api/admin/operations/fixed-costs` route with the same admin-session +
  Origin protection as the existing operations route. A new
  `operations-cost` System Health check/pipeline reports this month's
  estimated spend against configurable
  `OPERATIONS_MONTHLY_COST_AMBER_USD`/`_RED_USD` thresholds: it goes red when
  the cost tables can't be read (missing `DATABASE_URL`, missing migration,
  timeout, or query failure) or when spend reaches the red threshold, and
  amber when configured pricing or thresholds are invalid while storage
  itself remains reachable — never a silent miscalculation. Every dollar
  figure in the UI is labelled an estimate, not the provider invoice, with
  an explicit reconcile-weekly-then-monthly note; when the cost snapshot
  itself is unavailable, the section stops rendering monetary cards,
  reconciliation, the ledger and the fixed-cost editor rather than falling
  back to zero-filled figures. Deliberately out of scope, per the issue:
  Vercel billing integration (treated as a plain fixed-cost entry for now;
  its `/v1/billing/charges` API is only daily-granularity and is worth a
  dedicated future PR once overage materially affects margin), and any
  pruning/rollup of the raw `ai_operation_costs` rows.
- The go-live content filter (issue #392) is implemented as one shared,
  deterministic, owner-maintained module, `lib/server/content-filter.ts`
  (server-only, never imported by client code), blocking only slurs/hateful
  content targeting race, ethnicity, national origin or religion, and
  content sexualising minors — profanity, crude humour, adult innuendo,
  violence, drugs and other edgy content are deliberately NOT filtered, per
  the issue's own narrow-scope decision. Matching is word-boundary aware
  (never bare substring) with leetspeak/separator evasion handling for the
  highest-severity terms, so it never fires on a slur embedded inside an
  unrelated legitimate word. It is wired into every point where
  user-supplied or AI-generated text becomes public or costs money to
  generate: `/api/publish` and `/api/publish/challenge` screen name,
  ticker, description, slug and generated HTML and fail closed (a filter
  runtime error is treated as a rejection); `generate-site-page`,
  `generate-free-site`, `generate-site-style`, `social/voice-profile`,
  `social/mascot/visual-dna` and `social/mascot/image` screen inputs before
  any paid provider call and screen the generated output before it reaches
  the client, failing open (logged, never blocking generation) on an
  unexpected filter crash; `/api/social/draft` gained a new
  `checkDraftContentFilter` function in `lib/server/social-draft-pipeline.ts`
  that the route calls alongside the existing `checkDraftCompliance` chain
  on both the first response and the corrective retry, so a slur can never
  slip through the same #364 fail-open retry gap; and
  `lib/server/social-posting-cron.ts` runs one final fail-closed check
  immediately before every X/Telegram send, routing a match straight to the
  existing terminal `markDestinationFailedFinal` path (bypassing the
  retry/backoff funnel entirely, since a filter violation is never a
  transient or auth problem worth retrying) so a body approved before the
  filter existed can never go out. `/admin` gained a `content-filter`
  System Health check/pipeline (filter-loaded status, term-list size and
  category count, rejections in the last 24 hours read from
  `admin_activity_log`) and a new `content-filter-rejected` Activity log
  kind recording the rejecting route/field and wallet when known — the
  matched term itself is never logged or echoed back to the user, only a
  plain-English message naming the rejected field.
- Support tickets, Phase A — the pipe (issue #393) is implemented for
  review: wallet-signed problem reporting, an admin reply/status queue, and
  a best-effort Telegram owner alert. Migration `db/migrations/025_support_tickets.sql`
  adds `support_tickets` and `support_ticket_messages`, and widens the
  `admin_service_controls_known_service` / `admin_activity_log_known_service`
  constraints for a new `support` service key, following exactly what
  `018_social_studio_connections.sql` did for `social-posting`. A new
  `/support` page (mobile-first, verified against the 390px breakpoint by
  source-level CSS assertion, not yet on a physical device per rule 7) lets
  a connected wallet submit a category/subject/description report and read
  back owner replies; submission and follow-up replies are wallet-signed
  with dedicated purposes `support:ticket-create` / `support:ticket-reply`
  built on `lib/server/chat-auth.ts`'s existing challenge/signature
  primitives (`lib/server/support-ticket-auth.ts`,
  `POST /api/support/challenge`) — a sibling to, not a modification of,
  `lib/server/social-studio-action-auth.ts`, so isolating Social Studio
  posting can never accidentally block support ticket submission or vice
  versa. `lib/server/support-tickets-store.ts` follows the
  `social-connections-store.ts` shape (interface + unconfigured fallback +
  test-injectable singleton + Postgres implementation), never returns
  unbounded ticket sets, and enforces that only the owning wallet can reply
  to its own open/needs_user ticket. On creation, the server assembles a
  `diagnostics` snapshot itself — current plan/entitlement via the
  canonical `getSubscriptionAccess`, social connection platform+status only
  (`lib/server/social-connections-store.ts`'s `list()` already excludes
  credentials), and a recent-client-error count via a new
  `ClientErrorStore.countRecentForWallet` capability that degrades to
  `null` if the crash-report store can't be queried — then sends one
  best-effort Telegram alert (category/subject/truncated wallet/ticket id,
  never the body) through the existing `lib/server/telegram.ts` client and
  new server-only `TELEGRAM_ADMIN_CHAT_ID`; a Telegram failure is caught
  and logged and never affects ticket creation, and the send itself runs
  after the HTTP response via the repository's `after()`/`runAfterResponse`
  pattern so a slow or hanging Telegram call can never delay ticket
  creation. Existing security middleware and protections were not weakened
  — `lib/server/api-protection.ts` gained new Support-specific rate/origin
  helpers alongside the existing ones. `/admin` gained a top-level Support
  section (newest-first list, status filter, full diagnostics, full
  message history, an owner reply box that also flips the ticket to
  `needs_user`, and status controls limited to `solved`/`closed`) and a
  `support` System Health pipeline (both support tables reachable,
  `TELEGRAM_ADMIN_CHAT_ID` configured yes/no, open ticket count,
  oldest-open-ticket age), plus two new admin activity kinds
  (`ticket-created`, `ticket-replied`) that log bounded identifiers/status
  only — never ticket subject/body/message body/diagnostics. Public
  create/list/reply responses use a dedicated projection that omits
  `diagnostics` and `walletAddress`; full diagnostics remain admin-only.
  Message writes and status transitions run inside a single locked
  Postgres transaction (ticket row `FOR UPDATE`), a user reply clears
  `needs_user` back to `open`, and an owner reply rejects rather than
  reopening a solved/closed ticket. Ticket-message reads are capped per
  ticket. Deliberately out of scope, per the issue: any AI assistant,
  auto-answer layer, autopilot, or unattended support action — every reply
  in this PR is a human (user or owner) typing into a box. The per-ticket
  200-message response cap and the lack of physical Mobile Safari
  verification remain open trade-offs for this phase.
- Support ticket UX follow-ups (issue #401): the `/support` success state
  now has a "Done" control (`components/support-hub.tsx`) that resets the
  New report form and scrolls to Your reports, where the new ticket already
  shows. Users can also close their own open/needs_user ticket from "Your
  reports" via a new "Close this report" action gated behind a one-tap
  request → one-tap confirm step, so a mis-tap can't kill a live ticket;
  reopening is deliberately not offered — the owner can already see
  everything from `/admin`, and a user can always file a fresh report. It's
  wallet-signed with a new purpose, `support:ticket-close`
  (`lib/server/support-ticket-auth.ts`), bound to the ticket id and reusing
  the existing challenge/signature primitives exactly like
  `support:ticket-reply`. The new `POST /api/support/tickets/[id]/close`
  route follows the reply route's shape (origin check, rate limit, service
  isolation, UUID validation, auth) and calls a new
  `SupportTicketsStore.closeTicketByUser`, which mirrors `addUserMessage`'s
  locked-transaction shape (`BEGIN` → `SELECT ... FOR UPDATE` → ownership
  check → terminal-status rejection → `UPDATE status = 'closed'` →
  `COMMIT`, rollback on any rejection or error) rather than reusing the
  admin-only `setStatus`, since a user close needs the same
  ownership/terminal-state guarding a reply gets. The admin queue shows a
  user-closed ticket exactly like any other closed ticket — no admin-side
  behaviour changed — and a new `ticket-closed-by-user` admin activity kind
  logs the ticket id and wallet only, never body text.
- Support unread badge and live /support refresh (issue #403). A red dot on
  the Support nav item (both the desktop sidebar utility entry and the
  mobile pill tab, via a shared `SupportUnreadDot` in
  `components/app-navigation.tsx`) appears when a wallet has owner activity
  on a ticket it hasn't seen. Unread state needed no backend response
  change: `GET /api/support/tickets` already returns `status` and
  `updatedAt` per ticket, and a user can never move their own ticket into
  `needs_user` (only an owner reply does that) or `solved` (an admin-only
  status change) — so "status is needs_user/solved and updatedAt is newer
  than last-seen" (`lib/support-unread.ts`'s `hasSupportTicketNews`)
  already captures owner activity without conflating it with the user's
  own reply/close, which move status to `open`/`closed` instead. Last-seen
  is a single `hoodlums.support.lastSeen.v1` localStorage key holding a
  `{ walletLowercased: timestampMs }` map (no existing per-wallet-key
  convention to follow, so this establishes one on the same "one static
  key, map value" shape token-project persistence already uses); a
  successful ticket load on `/support` writes it and clears the dot
  immediately. `lib/use-support-unread.ts` is a module-level singleton
  hook, not per-component state, because `AppNavigation` and
  `MobileBottomNavigation` are always both mounted (CSS just hides
  whichever doesn't match the viewport) — sharing one cached value and one
  in-flight fetch keeps two nav surfaces checking on the same mount/focus
  from doubling the request count. The nav checks unread on mount and
  window focus only, no polling timer; a failed or rate-limited check
  always shows no dot rather than a false alert, and no stored wallet
  skips the check entirely. `/support` itself (`components/support-hub.tsx`)
  gets the one deliberate exception to the app's no-polling rule: it
  refetches on `focus`/`visibilitychange` and on a 60-second timer that
  only ever runs while `document.visibilityState === "visible"`, torn down
  the moment it isn't and on unmount. The refresh is silent by
  construction — `loadTickets` only ever updates the existing `tickets`
  array in place and never resets it to a loading state, so there's no
  spinner flash or scroll jump. Because the 60s timer alone is exactly
  60 reads/hour — already the old `SUPPORT_READ_LIMIT` with zero headroom
  for the nav's own checks, focus refetches, or the initial page load —
  `SUPPORT_READ_LIMIT` is raised from 60 to 150/hour (still a per-IP,
  per-hour cap; the math is spelled out in a comment in
  `lib/server/api-protection.ts`). The post-submit success banner now also
  tells the user plainly that a red dot will appear when there's news, so
  they know they don't need to keep the page open. No admin-side changes —
  this is a pure client-side UX layer over the existing ticket data.
- Milestone A "PR A" (issue #409): curve deploy pipeline, a server-side
  launches record, and a wallet-mismatch guard — implemented for review, and
  deliberately scoped smaller than the full issue per its own suggested
  "PR A (chain + pipeline) / PR B (UI/grid)" split, stated here as required.
  **Part 1** — `contracts/HoodlumsCurveLaunchPipeline.sol` deploys a token
  and a `HoodlumsTestBondingCurve` for it in one transaction (deterministic
  tests in `contracts/HoodlumsCurveLaunchPipeline.t.sol`; no separate fuzz/
  invariant suite exists in this repo despite CLAUDE.md/issue references —
  `test:contracts` runs Hardhat's native `.t.sol` suite only, and these new
  tests were added to that same suite). It does not modify
  `FixedSupplyMemeToken` or `HoodlumsTestBondingCurve` and never holds the
  token or any funds itself, so the curve's existing fee/graduation
  economics (rule 5) and `fundCurve()`'s `onlyCreator` + complete-supply
  invariant (rule 6) are unchanged; it also bypasses `HoodlumsTokenFactory`
  entirely rather than routing through it (routing through it would make
  the factory's own bookkeeping/`TokenLaunched` event report the pipeline
  contract as launcher instead of the real wallet, breaking the Part 2
  reconciliation below). `components/testnet-launcher.tsx`'s Robinhood
  path now chains three wallet signatures (deploy token+curve, approve,
  `fundCurve()`) when `NEXT_PUBLIC_HOODLUMS_CURVE_LAUNCH_PIPELINE_ADDRESSES`
  is configured for the connected chain, falling back to the existing
  factory/direct-deploy token-only path otherwise; deploy parameters
  (graduation target, virtual reserves) come from
  `lib/curve-launch-pipeline-config.ts`, with a low testnet graduation
  target default (4 native tokens) so a faucet-funded wallet can ride a
  token to graduation, never inlined. **Part 2 (backend only)** — a
  `token_launches` table (`db/migrations/029_token_launches.sql`) is
  written via a wallet-signed `POST /api/token-launches`
  (`lib/server/token-launch-auth.ts`, reusing `lib/server/chat-auth.ts`'s
  in-memory challenge primitives — the write is also independently
  reconciled against a live on-chain read of the curve/token contracts
  before any row is inserted, `lib/server/token-launch-reconciliation.ts`,
  so a forged or replayed signature still cannot create a false record;
  the in-memory (not durable `wallet_nonces`-table) challenge store was
  chosen as the stated trade-off, since the on-chain reconciliation is
  the actual security floor here, not the signature's durability). A
  public `GET /api/token-launches` lists recorded launches
  (`lib/server/token-launches-store.ts`); `graduated`/`graduated_at`
  columns exist per the issue's row spec but are not yet kept in sync by
  any job in this PR — only `store.markGraduated()` exists for a future
  caller to use. **The homepage grid switch (New/Bonding/Graduated tabs
  reading from `token_launches` instead of `published_sites`, with live
  30-60s polling per issue #403's pattern) and Part 3's trading UI
  (quote/buy/sell, the graduation clamp UI, fee breakdown) are NOT built
  in this PR** — both are sizeable, mobile-Safari-sensitive UI efforts
  (rule 7) left to a follow-up "PR B"; the backend above (the read route,
  rate limits already sized for that future poll cadence) is ready for it.
  **Part 4** — a wallet-mismatch guard (reusing the `describeWalletMismatch`
  pattern from issue #388) is wired into both real Robinhood-testnet launch
  surfaces: `/testnet`'s `TestnetLauncher`, and — identified during this
  PR as "the tester's real bug today" the issue refers to —
  `components/robinhood-testnet-deployment-controller.tsx`, the studio's
  own launch modal (opened from the homepage builder), whose
  `getProvider()` prefers `window.__launchpadEthereum` (the exact wallet
  `AccountWalletBridge` confirmed) but silently falls back to the bare
  `window.ethereum` on any page load where that in-memory reference wasn't
  set, with no comparison against the wallet actually confirmed via the
  Account panel until now. Both guards compare the wallet app's active
  account against `hoodlums.account.wallet` (the only wallet identity a
  browser-local project draft has, since drafts carry no owner field of
  their own) and offer explicit "switch wallet" / "continue anyway —
  belongs to the other wallet" choices naming both addresses before a
  launch signature is ever requested. The studio launch modal still only
  deploys a plain `FixedSupplyMemeToken` (Part 1's curve pipeline is not
  wired into it in this PR — flagged as a named follow-up, since it is a
  materially different, portal-based component and is the actual primary
  homepage launch surface, deserving its own careful mobile-Safari pass).
  **Rule 10** — `/admin` gained a `token-launches` System Health pipeline
  (isolation, curve-deployment-config, launches-table, launches-24h
  stages) and service-isolation switch, a `token-launched` Activity log
  kind (token address, wallet, name only), and a read-only Launches
  section/list (`GET /api/admin/token-launches`). Not verified on a real
  mobile Safari device this pass (rule 7) — both wallet-mismatch panels'
  390px layout was checked by reading the CSS against each surface's
  existing breakpoint, not on-device; flagged for the owner to confirm.
  `AGENTS.md`'s roadmap section has pre-existing drift from CLAUDE.md
  (stops around issue #358) that predates this PR and was not addressed
  here — out of scope for this change.
- Milestone A "PR B" (issue #412): the homepage grid switches to real
  launches with live updates, and the token page's trading UI gets an
  honest fee breakdown, the graduation clamp, a post-graduation state and a
  creator fee panel — implemented for review, building on PR A (#411).
  **Part 1** — `GET /api/token-launches` (already rate-limit-sized for this
  by PR A) now enriches every non-graduated launch with a live graduation-
  progress read through a new 20s TTL cache, `lib/server/curve-progress-
  cache.ts` (concurrent misses for the same curve share one in-flight RPC
  call, so a burst of homepage polls never becomes a burst of RPC calls),
  and attaches the slug of a linked published site (matched by
  `contractAddress`) when one exists. A launch whose live read discovers
  graduation ahead of the DB row is returned graduated in that same
  response and opportunistically synced via `store.markGraduated()` — the
  029 migration's own comment named this read API as the intended sync
  point, and this PR is that caller; a new `token-graduated` Activity log
  kind (token address, name only) records it. `components/hoodlums-token-
  grid.tsx` is now a self-fetching client component
  (`lib/use-token-launches.ts`) instead of rendering `published_sites` as
  fake 0%-graduation cards: New/Bonding/Graduated map to the `all`/
  `bonding`/`graduated` filters, live progress bars replace the hardcoded
  `0%`, and cards link to a linked site when one exists or the token's
  trade page otherwise. Live updates follow `/support`'s issue #403
  pattern exactly — a visible-tab-only 30s timer plus a focus/
  visibilitychange refetch, silent in-place updates, cleaned up on unmount
  — and a new `lib/token-launch-events.ts` window `CustomEvent`
  (mirroring `lib/workspace-open-request.ts`'s pattern) triggers an
  immediate refetch the moment a wallet's own launch is recorded, from
  both `/testnet` and the studio modal. The studio's own launch modal
  (`components/robinhood-testnet-deployment-controller.tsx`) — PR A's
  named follow-up — now also routes through the curve pipeline's
  3-signature flow (deploy token+curve, approve, fundCurve) when a
  pipeline is configured, reusing the same wallet-mismatch guard PR A
  already wired there, and falls back to the plain `FixedSupplyMemeToken`
  deploy otherwise; this duplicates (rather than imports)
  `components/testnet-launcher.tsx`'s equivalent flow deliberately, so
  that file's own locked-down source-assertion tests are never put at risk
  by a shared-code refactor. **Part 2** — the token page's trading panel
  (`components/token-page/token-left-column.tsx`, already live since issue
  #225) now resolves its curve address per-token via a new
  `lib/server/token-launch-curve-lookup.ts` (looks up the specific curve
  `token_launches` recorded for this token address, falling back to the
  legacy single-curve-per-chain env var) instead of trusting one env var
  for every token on the chain — necessary now that every pipeline launch
  deploys its own curve. Every quote shows an honest 1% fee breakdown
  before signing: a buy's fee is computed with the existing pure
  `lib/bonding-curve-fee-math.ts` mirror (no extra RPC call), a sell's
  fee comes from a new `quoteSellFee` read (added to
  `HOODLUMS_BONDING_CURVE_TRADE_ABI`, since it depends on the curve's
  current reserves). The graduation clamp reads and displays
  `remainingNativeToGraduate()`, caps the buy `MAX` preset at the exact
  gross input that nets to that remaining amount
  (`grossNativeInForExactNet`, already existing pure math), and blocks
  submitting an over-cap buy client-side instead of letting the contract's
  `BuyExceedsGraduationTarget` revert be the user's first signal. Once a
  curve reports graduated, the swap form and mobile quick-buy/sell are
  replaced by an honest "trading closed" panel with a link to the locked
  liquidity pool — the contract itself blocks `buy()`/`sell()` post-
  graduation via the `tradingOpen` modifier, so this UI can never
  advertise a trade that would only revert. A creator fee panel (claimable
  balance + a `withdrawFees()` button, both via a new
  `HOODLUMS_BONDING_CURVE_FEES_ABI`) appears whenever the connected wallet
  is confirmed on-chain as the curve's `creator()`, before and after
  graduation, since fees remain withdrawable either way. **Rule 10** —
  `buildTokenLaunchesPipeline` gained a `curve-progress-read` stage
  reporting the new cache's own last-read success and age (amber until
  the cache is warmed by the grid's first request; this is deliberately
  independent of the `contracts` pipeline's existing general
  `rpc-reachable` stage). **Deliberately out of scope**, consistent with
  the issue's own "and/or" framing for where trading UI could live:
  `/bonding-curve`'s static copy and disabled CTA are unchanged — the
  token page already carries the full live trading experience, and
  updating that page's stale copy is left to a follow-up. Not verified on
  a real mobile Safari device this pass (rule 7) — the grid's card links,
  the fee-breakdown/graduation-clamp/post-graduation panels and the
  creator fee panel were checked by reading the CSS against the existing
  layout and breakpoints, not on-device; flagged for the owner to confirm.
  `npm install`/`npm test`/`npm run lint`/`npm run build` could not be run
  in this session (no shell command execution permission was available),
  so no fresh test/lint/build counts are reported here — flagged for CI or
  the owner to verify before merge.
- Token page v2 part 2 (issue #430): real trade activity, a live candlestick
  chart and live updates, built fresh on top of #429/#431's already-merged
  desktop column-container rearrangement (no per-column wrapper divs; column
  placement resolved purely in CSS on each panel's own class) rather than the
  abandoned pre-#429 branch this issue's thread started from. **Trade data
  source** — `GET /api/token-trades?curve=0x...`
  (`lib/server/token-trades-rpc.ts`) reads `TokensPurchased`/`TokensSold`
  straight off `contracts/HoodlumsTestBondingCurve.sol`'s own events via the
  same Robinhood-testnet RPC config `curve-progress-cache.ts` and
  `token-launch-reconciliation.ts` already use — no new env vars. No launch
  record stores a block number, so the scan's start block is derived for
  real via binary search on `eth_getCode` (bytecode absent before
  deployment, present at/after), cached indefinitely per curve, never
  scanning from block 0. Reads are cached ~10s server-side and shared/
  deduped across concurrent viewers; a genuine RPC failure returns `502`
  with no `trades` key, never an empty array, so it can never be confused
  with a real zero-trade token. Each normalized trade's native amount is the
  post-fee amount (`netNativeIn`/`netNativeOut`) — what actually priced the
  trade against the curve's reserves. **Recent trades tab**
  (`components/token-page/token-center-column.tsx`) now renders this real
  data — newest first, buy/sell badge, wallet, amount, time-ago linking out
  to the explorer tx page — replacing the old `TokenMarketStats.trades`
  field, a Blockscout LP-transfer heuristic that only ever worked once a
  token had a Dexscreener-indexed pool and never for a still-bonding curve
  token; that dead fetch/classifier was removed from
  `lib/server/token-market-stats.ts` entirely rather than left as a wasted
  request on every page load. **Candlestick chart**
  (`components/token-page/token-trade-chart.tsx`) is built on the one new
  pinned dependency, `lightweight-charts@4.1.3`; candles bucket from trades
  via the pure `lib/candle-bucketing.ts` with a 1m/5m/15m/1h selector
  (default 5m). Per the owner's explicit requirement, `createChart`/
  `addCandlestickSeries` mount unconditionally on render, independent of
  trade count, with only a text overlay layered on top for the empty/error
  state — never a placeholder box. **Live updates** — `lib/use-token-trades.ts`
  shares one 12s visible-tab poll (paused hidden, refetched on focus/
  visibilitychange) between the chart and the trades tab, following
  `use-token-launches.ts`'s issue #403 pattern exactly; a new
  `lib/token-trade-events.ts` window `CustomEvent`, dispatched from
  `TokenLeftColumn` only on a genuine non-reverted trade confirmation,
  triggers an immediate refetch for the connected wallet's own trade.
  Because the identity/stats/graduation panel is still rendered by
  `TokenLeftColumn` itself (CSS-placed into the visual right column by
  #429/#431, not lifted into a separate `rightGroup` component with props as
  earlier issue-thread comments assumed before the code was actually read),
  graduation progress and stats for *other* wallets' trades are kept fresh
  by a second, separate 12s visible-tab timer added directly to
  `TokenLeftColumn`'s existing `loadCurve`, independent of the trades poll.
  **Rule 10** — `buildTokenLaunchesPipeline` gained a `trades-read` stage
  (`lib/server/token-trades-rpc.ts`'s own read health), mirroring
  `curve-progress-read`'s shape exactly; the route reuses the existing
  `token-launches` service-isolation switch rather than adding a new one.
  Validated this session: `npm run test:app` — 272 test files / 2873 tests
  passing. `npm run lint` — 0 errors (10 pre-existing unrelated warnings).
  `npm run build` — succeeds, `/api/token-trades` listed in the route
  output. `npm run test:contracts` — 65 passing (untouched, no contract
  changes). Not verified on a real mobile Safari device this pass (rule 7)
  — the chart/tab layout and the compact interval selector were checked by
  reading the CSS against the existing breakpoints, not on-device; flagged
  for the owner to confirm by trading on a live bonding-curve token.
- Token artwork is captured at launch and shown on the homepage grid (issue
  #438) — `token_launches` carried no artwork reference at all, so every
  card fell back to a letter initial even though the studio project's
  `heroImage` was already in memory at record time. `lib/token-artwork-
  thumbnail.ts` is a pure, unit-tested square-cover-crop/quality-stepping
  helper (max 512x512, WEBP with a JPEG fallback when a browser can't
  encode WEBP, ~0.8 quality stepped down up to twice, giving up rather than
  send anything over 120KB) composed with a thin, untested canvas/Image
  driver in the same file — the same tested-pure/untested-DOM split as
  `lib/artwork-compression.ts` and `components/artwork-upload-controller.tsx`.
  `components/robinhood-testnet-deployment-controller.tsx` reads
  `currentProject.heroImage` once, downscales it, and discards it — never
  holding the full-size artwork in React state or a prop, per CLAUDE.md's
  PR #118 iPhone Safari memory rule. The resulting thumbnail rides as an
  optional `artworkThumbnail` field alongside the wallet-signed record
  request, deliberately outside the signed challenge payload, since artwork
  is cosmetic, non-authoritative data. `lib/server/token-launch-artwork-
  validation.ts` validates it server-side before every insert — optional;
  must decode (via the existing `decodeArtworkDataUrl` magic-byte sniffer)
  to a genuine WEBP, JPEG or PNG; 400 above 160,000 decoded bytes — so
  nothing unvalidated is ever stored. Migration `030_token_launch_artwork.sql`
  adds a nullable `artwork_thumbnail` column with a generous defence-in-depth
  `octet_length` CHECK; a double-submitted record fills in missing artwork
  via `COALESCE` without ever overwriting artwork already recorded, so the
  `/testnet` "Record listing" retry and "Record an existing launch" (#425)
  recovery paths can carry art too even though `components/testnet-
  launcher.tsx`'s own standalone form has no `heroImage` of its own to send.
  `GET /api/token-launches` and the admin list both return `artworkThumbnail`
  (null when absent) as part of the existing `TokenLaunch`/`TokenLaunchListItem`
  shape. The homepage grid (`components/token-grid-card-chart.tsx`) renders
  it as the card's edge-to-edge `object-fit: cover` thumbnail, positioned
  behind the existing #436 sparkline overlay and only ever shown in place of
  (never alongside) the letter-initial fallback; `/admin`'s Launches table
  shows the same thumbnail per row. No token page, `/api/token-trades`, or
  #436 sparkline-maths changes; the card visual redesign the issue explicitly
  deferred was not attempted. Validated this session: `npm run test:app` —
  278 test files / 2942 tests passing. `npm run lint` — 0 errors (12
  warnings: the 10 pre-existing plus 2 new `no-img-element` warnings on the
  two new `<img>` thumbnails, consistent with every other data-URL artwork
  `<img>` already in this codebase). `npm run build` — succeeds. Not
  verified on a real mobile Safari device this pass (rule 7) — the grid
  card and admin row thumbnail styling were checked by reading the CSS
  against the existing layout, not on-device; flagged for the owner to
  confirm.
- Token page v2, part 1 of 3 (issue #443): full-screen layout, header band,
  price/mcap toggle and a new Stats/Audit panel, built against the
  owner-approved reference at `design/token-page-v2/`. Part 2 (chart
  internals/live-update rebuild) and part 3 (a holder-stats route for
  Top 10 %/Dev %/Snipers %) are explicitly not attempted here.
  `app/token/[chain]/[address]/layout.tsx` no longer mounts the desktop
  `AppNavigation` sidebar on this route (keeping `AccountOverlayShell` and
  `MobileBottomNavigation`); since that sidebar's own CSS module still sets
  a global `body { padding-left: 238px }` desktop offset regardless of
  whether the component itself is rendered (it's bundled via the still-used
  `MobileBottomNavigation` import), a plain marker class,
  `token-page-full-screen`, on the page's `<main>` nulls that out via
  `:global(body:has(.token-page-full-screen))`, matching the existing
  `:has(.public-generated-site)` pattern. The new
  `components/token-page/token-header-band.tsx` replaces the old `.topbar`:
  artwork (from the launch record's `artworkThumbnail`, falling back to an
  initial-letter tile), name/ticker (preferring the launch record over
  Blockscout), a LIVE pill gated on the curve reporting `bonding`, holder
  count/launch age/chain badge, a graduation block, the price/mcap toggle
  and Contract/Pool link chips (Pool disabled with an "after graduation"
  note until `liquidityPool` is set). It reads its own independent curve
  state via a new `lib/use-token-curve-status.ts` hook (a dedicated
  `HOODLUMS_BONDING_CURVE_HEADER_ABI` in `lib/bonding-curve-config.ts`) and
  its own `useTokenTrades` poll, rather than sharing state with
  `token-left-column.tsx`'s swap panel — a deliberate trade-off (two
  independent curve polls instead of one) since this issue scopes the swap
  panel as "unchanged internally" and its state is already extensively
  pinned by existing tests. The big figure and change pill both derive from
  `tradePriceNativePerToken` (`lib/candle-bucketing.ts`) over the same
  loaded trades — one shared price source, never a second formula — falling
  back to a starting price computed from the curve's
  `initialVirtualTokenReserve`/`initialVirtualEthReserve` before any trade
  exists. `token-left-column.tsx`'s old identity/stats-USD card (market
  cap/liquidity/24h volume in USD) is removed entirely — no USD anywhere on
  this page — replaced by the header band plus a new
  `components/token-page/token-stats-audit-panel.tsx` (Stats/Audit tabs, a
  5M/1H/24H window selector distinct from the chart's own timeframe rail,
  paired rows with split bars computed by a new pure
  `lib/token-trade-stats.ts` over the trades `useTokenTrades` already
  holds — no second fetch/route — plus a collapsible Holder breakdown and a
  static Audit checklist that renders unverified/dimmed when the token has
  no factory launch record). The swap panel gained one small addition: a
  real fee note under the CTA, built from the curve's actual fee constants
  (`TRADING_FEE_BPS`/`PROTOCOL_FEE_SHARE_BPS`/`CREATOR_FEE_SHARE_BPS`, the
  latter two newly exported from `lib/bonding-curve-fee-math.ts`) via a new
  `formatFeeNote` in `lib/token-page-format.ts`, never a hard-coded string.
  `components/token-page/token-right-column.tsx` is deleted outright — its
  About content moved into a fourth tab (`Recent trades / Holders /
  Hoodchat / About`) on the centre column, and its other content (referral
  trade-terminal links) was dead code on the only chain this page supports
  today. The desktop grid drops the old three-column layout (#429) for a
  simple two-column one (swap → Stats/Audit → creator fees, sticky, on the
  left; the chart and its tabs filling the rest), since identity/about no
  longer need a column of their own; mobile stacks header → swap → chart →
  stats → tabs. `lib/token-trade-types.ts`'s `TokenTrade` gained two new
  optional fields, `grossNativeAmountRaw` and `feeChargedRaw`, populated by
  `lib/server/token-trades-rpc.ts` from data the `TokensPurchased`/
  `TokensSold` events already emit — needed for the Stats panel's sell
  volume and total-fees figures, which use a different accounting basis
  than the existing `nativeAmountRaw`; both fields are optional so every
  pre-existing `TokenTrade` test fixture across the repo keeps compiling
  unchanged. Validated this session: `npm run test:app` — 281 test files /
  3022 tests passing. `npm run lint` — 0 errors (12 pre-existing warnings
  only). `npm run build` — succeeds. `npm run test:contracts` — 65 passing
  (untouched, no contract changes). No visual pass was run this session —
  the owner reviews the deployed page against the committed design, per
  this issue's own instruction; new/changed CSS was checked only by
  reading it against the existing breakpoints, not on-device or in a
  browser.
- Token page v2, part 2 of 3 (issue #445): the chart's internals and the
  trades hook's live-update behaviour are rebuilt to the design; layout,
  header band, stats panel and routes are unchanged (part 1's own scope
  split). Two defects drove this work: `timeScale().fitContent()` on every
  poll stretched a low-trade-count token into a single slab-wide candle
  with no `priceFormat` set (axis read "0.00" at ~1e-8 prices), and
  `lib/use-token-trades.ts` replaced its whole `trades` array every 12s
  poll even when nothing changed, forcing a full `setData`+`fitContent`
  and a visible jump; a third, faster (~1s) jump traced to
  `createChart`'s `autoSize: true` option, whose own `ResizeObserver`
  could re-fire on sub-pixel layout noise and feed straight back into
  another reflow. **In-place live updates** — `lib/use-token-trades.ts`
  now folds every poll through a new pure `lib/token-trades-merge.ts`
  (`mergeTokenTrades`, keyed by tx hash + log index): an identical poll
  returns the exact same array reference and skips `setState` entirely,
  new trades are folded in and re-sorted newest-first, and previously-held
  trade objects are never recreated. The hook now also exposes `stale`
  (a poll failed after data had already loaded — distinct from `error`,
  reserved for "never successfully loaded once") and `retry`, threaded
  down through `token-page-view.tsx` → `token-center-column.tsx` to the
  chart. **Candle data flow** — `lib/candle-bucketing.ts`'s
  `CandleInterval` is now the design's fixed rail (5m/15m/1h/6h/1d);
  `resolveAllTimeframeInterval`/`resolveChartInterval` add the "ALL"
  meta-timeframe (finest interval keeping full history at or under ~200
  bars, widening as needed), `Candle` gained a `volume` field (summed
  post-fee native amount per bucket), and new pure `diffTimeSeries`/
  `diffCandles`/`computeMovingAverage`/`resolveInitialVisibleRange`
  helpers do the diffing/MA/visible-range math the chart needs without a
  chart instance. `lib/token-candle-geometry.ts` (the homepage grid
  sparkline, issue #440) reads the same `CANDLE_INTERVALS` list unchanged
  in shape — dropping "1m" and adding "6h"/"1d" only ever makes its own
  coarsest-necessary interval picker more accurate, never a behaviour
  change any existing test depended on. **The chart itself**
  (`components/token-page/token-trade-chart.tsx`) now calls
  `series.setData()` only on first load or a timeframe change (which also
  sets the initial visible logical range to the most recent ~120 bars via
  `resolveInitialVisibleRange` — never `fitContent()`, anywhere, so one or
  two candles render at their fixed `barSpacing`/`minBarSpacing` width
  instead of stretching); every later update diffs against what's already
  rendered and calls `series.update()` for just the mutated last bar and
  any newly appended ones, which is what keeps a scrolled-back viewer's
  position stable while a viewer at the right edge keeps following the
  latest bar for free (lightweight-charts' own `update()` semantics).
  Sizing is now a manually-guarded `ResizeObserver` (skips `chart.resize()`
  entirely unless the rounded pixel size actually changed) instead of
  `autoSize: true`, closing off the suspected feedback-loop source of the
  ~1s jump. The candlestick series' `priceFormat` is `type: "custom"`
  wrapping the existing `formatNativePriceSixSigFigs` (`lib/token-page-
  format.ts`) — the same six-significant-figure formatter the header
  band's big figure already uses — so the axis, the crosshair label and
  the built-in dashed lime last-price line/axis tag can never read
  "0.00" and can never disagree with the header. MA20 (lime) and MA50
  (white) line series are recomputed from `computeMovingAverage` and kept
  in sync via the same diff/update approach; a histogram volume pane is
  added but hidden by default (`visible: false`) behind a small header
  toggle. A left-edge tool rail offers crosshair (default) and a
  horizontal-line tool (`lib/token-chart-tools.ts`'s pure `addHorizontalLine`/
  `removeHorizontalLine`) — clicking the plot with the line tool active
  reads the price at that y-coordinate via `series.coordinateToPrice()`
  and draws a removable `series.createPriceLine()`; entirely client-side
  state, no backend data, per the data inventory's own note. A
  `chart.subscribeCrosshairMove` handler renders a tooltip (time in UTC,
  candle change %, O/H/L/C at six significant figures, volume in ETH) as
  ordinary React state rather than a lightweight-charts primitive. The
  chart's own small last-price label and the zero-trade state's starting
  price both still derive from the exact same shared source part 1
  established (`tradePriceNativePerToken` over the newest loaded trade, or
  the curve's starting price with zero trades) — the chart never computes
  a second, independent last price. Zero-trade and poll-failure-after-data
  states are dedicated overlays/banners (the empty-plot note and a thin
  amber "Live data paused" banner with a wired RETRY calling the hook's
  `retry`); the loading state remains the pre-existing blank-until-first-
  data chart with no new skeleton. Validated this session: `npm run
  test:app` — 283 test files / 3067 tests passing. `npm run lint` — 0
  errors (12 pre-existing warnings only). `npm run build` — succeeds.
  `npm run test:contracts` — 65 passing (untouched, no contract changes).
  No visual pass was run this session, per the issue's own instruction —
  the owner reviews the deployed chart against the committed design; the
  new CSS (fill-height plot, tool rail, tooltip, stale banner) was checked
  only by reading it against the existing breakpoints, not on-device or in
  a browser. Part 3 (a holder-stats route for Top 10 %/Dev %/Snipers %)
  remains out of scope for this PR.
- Token page v2 price-consistency fix (issue #458): the header figure, the
  chart's candles/last-price line and the Stats price-change row could
  disagree after a buy then sells, because "price" was defined as a trade's
  own nativeAmount÷tokenAmount (its AVERAGE execution price), which is not
  where a bonding curve actually lands post-trade. `TokensPurchased`/
  `TokensSold` already emit `virtualTokenReserve`/`virtualEthReserve`
  post-trade, so `lib/server/token-trades-rpc.ts` now copies both onto every
  normalized `TokenTrade` (`virtualTokenReserveRaw`/`virtualEthReserveRaw`,
  optional fields following the existing `grossNativeAmountRaw` convention)
  and `lib/candle-bucketing.ts` gained `tradeSpotPriceNativePerToken`
  (`virtualEthReserve ÷ virtualTokenReserve`) as the one price definition
  used everywhere — `bucketTradesIntoCandles` (close = spot after the last
  trade in a bucket, high/low = max/min spot per trade in the bucket, open =
  the *previous* candle's close carried forward, never this bucket's own
  first trade), the header band, `lib/token-trade-stats.ts`'s price-change
  row, and — for consistency, since they share the same bucketing function —
  the homepage grid's sparkline (`lib/token-sparkline.ts`) and mini
  candlesticks (`lib/token-candle-geometry.ts`). The old average-price
  helper is deleted outright rather than aliased. The chart's own
  incremental-vs-full-resync update logic (issue #445/#451/#453) is
  extracted into a new pure, unit-tested module,
  `lib/token-trade-chart-render.ts`'s `applyTokenTradeChartUpdate` — this
  repo's Vitest suite runs in a plain Node environment with no jsdom, so
  this extraction is what makes the incremental sell-candle regression (a
  buy-bucket followed by a sell bucket rendered via `series.update()`, not
  `setData()`) directly testable against a fake series object
  (`tests/token-trade-chart-render.test.ts`) instead of only a source-string
  assertion; `components/token-page/token-trade-chart.tsx` now only adapts
  real lightweight-charts series into that pure function's duck-typed
  interface. The candlestick series' own built-in `priceLineVisible`/
  `lastValueVisible` are disabled — the one dashed last-price line is now
  drawn and kept in sync (`applyOptions`, not recreated) by the chart
  itself off the same shared spot price the header uses, closing the gap
  where the built-in tag could show a stale pre-sell price after an
  incremental update. The swap panel's sell-side "bal" figure now uses a
  new `formatTokenBalanceAmount` (`lib/token-page-format.ts`, thousands
  separators, max two decimals) instead of raw 18-decimal `formatUnits`,
  which wrapped; the buy-side ETH balance is unchanged. The chart's
  pre-trade whitespace padding (~100 bars) is capped at `launchedAt` minus
  five bars via a new optional `launchedAtUnixSeconds` parameter on
  `buildChartSeriesPoints`, threaded down from `token-page-view.tsx`
  (derived from the `token_launches` record) through `TokenCenterColumn` to
  the chart — a token launched days ago no longer pads a 1D chart back
  months of blank bars. Validated this session: `npm run test:app` — 284
  test files / 3141 tests passing. `npm run lint` — 0 errors (12
  pre-existing warnings only). `npm run build` — succeeds. `npm run
  test:contracts` — 65 passing (untouched, no contract changes). No visual
  pass was run this session — the dashed-line/balance-format/padding-cap
  changes were checked by reading the code and by the new unit/fixture
  tests, not on a live deployed page; flagged for the owner to confirm by
  trading on a live bonding-curve token.

- Token chart flat-fill — the timeline now genuinely ends in a real bar
  (issue #472 follow-up; the "no candles / not smooth in any timeframe"
  defect seen on WERDE after #473 deployed). Root cause, proven against
  `lightweight-charts@4.1.3`'s own source rather than inferred: the
  flat-filled timeline #471/#472 describe was never built in the data
  layer. `bucketTradesIntoCandles` only ever emitted a candle for a bucket
  that contained a trade, and `buildChartSeriesPoints` filled every gap
  with a whitespace `{ time }` point (its doc comment said so). The library
  filters whitespace rows out of every series' row list before computing
  the time scale's base index, then clamps the right offset to roughly one
  screen width (`width / barSpacing − 2` bars) past that base index — so
  the width-derived range the engine requested (ending ~2,900 bars past
  the single WERDE candle at 1M) was silently clamped back to just past
  the launch candle: one lime bar at the left edge, an empty grid after it,
  the axis two days behind "now". On 1S the capped 372-bar window started
  long after the only trade and contained no real bar at all, so there was
  nothing to anchor. #472's `isFlatCandle`/`candleToBar` paint was correct
  but unreachable — the only flat candle that could exist was a
  single-trade bucket with no starting price to open from. Fix, chart-only
  (`lib/candle-bucketing.ts`): `buildChartSeriesPoints` now carries the
  previous close forward as a real flat candle (open = high = low = close,
  volume 0) for every trade-free bucket once any price is known — from the
  launch bucket at the curve's starting price when `launchedAtUnixSeconds`
  and a positive `startingPriceNativePerToken` (new optional sixth
  parameter, threaded from `applyTokenTradeChartUpdate`) are both known,
  else from the first traded candle; buckets before any known price stay
  whitespace, and a capped 1S window that starts after the last trade
  still carries that trade's close, never a re-seeded starting price.
  Nothing is interpolated or invented — a flat bar is the price that
  genuinely stood during that bucket. `bucketTradesIntoCandles` itself is
  unchanged, so MA20/MA50, the volume series, the Stats panel, the homepage
  sparkline and mini candles keep reading traded candles only. Because
  "ALL" previously sized itself from the traded-bucket count alone (a
  two-day-old single-trade token resolved to 1S — six minutes of history),
  `resolveAllTimeframeInterval`/`resolveChartInterval` accept optional
  `nowUnixSeconds`/`launchedAtUnixSeconds` and, when given, pick the finest
  interval whose flat-filled span (earlier of launch and first trade → now)
  fits the existing 200-bar cap (WERDE → 15M); the trade-count-only rule is
  kept when no "now" is supplied. `components/token-page/token-trade-chart.tsx`
  moves its `nowTick` state above the `resolvedInterval` memo so "ALL" can
  read the clock. **Tests changed rather than only added (rule 8, stated
  plainly):** the five #451 `buildChartSeriesPoints` cases asserting that
  gap buckets are whitespace, and one #451 case asserting the timeline's
  candle points exactly equal `bucketTradesIntoCandles`' output, pinned
  the defect itself and were rewritten to assert the flat-fill contract;
  the `tests/token-trades-hook-ui.test.ts` source-string assertion on the
  `resolvedInterval` memo was updated to the new signature. New coverage:
  the WERDE shape at 1M and 1S (last point is a real bar at the current
  bucket; a capped 1S window is all real bars at the old close), the
  starting-price seed from the launch bucket, the span-sized ALL resolver,
  and — through the fake-series engine harness — that the last datum
  reaching `setData` is a flat-coloured OHLC bar and that advancing "now"
  by one bucket appends exactly one flat bar via `update()` and shifts the
  range by one. Deliberately not done: 1M-and-coarser timelines remain
  uncapped (bar count = token age ÷ interval; a 60-day-old token at 1M is
  ~86k flat bars where it was ~86k whitespace points before) — extending
  #470's sub-minute cap to every interval is a named follow-up. Validated
  this session, on the final commit: `npm run test:app` — 287 test files /
  3273 tests passing. `npm run lint` — 0 errors (12 pre-existing warnings
  only). `npm run build` — succeeds. `npm run test:contracts` not run (no
  contract changes). No visual pass was possible from this session — the
  owner verifies on the deployed WERDE page.

- Token chart 1S/15S real-time freeze (second defect on the same PR branch as
  the flat-fill above; found after the owner reported "no candles, not smooth
  in any timeframe" on a screenshot that was still running `main`). The flat
  fill made the timeline end in a real bar, but on the sub-minute intervals
  nothing ever reached the chart at all. `computeSubminuteBarsCap` capped
  1S/15S to a window whose start **slid one bucket per tick**, so every logical
  index referred to a different bucket each render — and
  `diffChartSeriesPoints` compares index-for-index while
  `chartSeriesPointsEqual` never compares `time`. Once no traded candle sat
  inside the window (a two-day-old token at 1S), every index held an identical
  flat bar, the diff reported `{updated: [], appended: []}`, and **zero
  `series.update()` calls were ever made**: the rendered series stayed pinned to
  whatever bucket was current when the chart first loaded while the engine's own
  state marched on, so the axis trailed "now" by exactly the time since page
  load (the owner's screenshot showed 07:23 against a 07:27 clock, four minutes
  after loading). Reproduced directly through the real engine against a fake
  series before any fix: 60 ticks at 1S gave `setData=1, update=0`, series tail
  frozen at load time, lag 60s; 15S identical with lag 900s. Fix, chart-only, in
  two parts. **(1) `lib/candle-bucketing.ts`** — the sub-minute cap is now
  applied at a quantised anchor (`computeAnchoredSubminuteStartTime`: start
  bucket = `floor((endBucket − cap + 1) / cap) * cap`) instead of a sliding
  start, so the head holds still and an ordinary tick is a **pure append** the
  incremental path renders with one `series.update()` — genuinely smooth, and
  identical in kind to how 1M-and-coarser already behaved. The window is still
  bounded, now between `cap` and `2 * cap` bars (≈372–744 at 1S on a 1116px
  chart) rather than exactly `cap`. **(2) `lib/token-trade-chart-render.ts`** —
  `applyTokenTradeChartUpdate` computes a signed `windowSlideBars` from the
  head's movement *before* diffing and, when non-zero, takes a new
  `"window-slide"` branch that resyncs all four series via `setData` and then
  either re-derives the width-based range (viewer at the right edge) or shifts
  the previous range by `−windowSlideBars` (viewer scrolled left, so the same
  wall-clock bars stay in view). The value is signed and tested with `!== 0`
  because a width increase enlarges the cap and moves the head *earlier*. A new
  `"window-slide"` member joins the `TokenTradeChartUpdateMode` union, so the
  existing `?chartDebug=1` readout names this path when it runs. After the fix,
  the same replay gives 60 ticks at 1S → **60 `update()` calls, no extra
  `setData`, lag 0**; 15S → 59 updates plus exactly one re-anchor `setData`,
  lag 0. **Tests changed rather than only added (rule 8, stated plainly):** four
  cases asserted the *sliding* window's exact bar count (`toBe(200)`,
  `toBe(2 * ceil(1116/6))`, `toBeLessThanOrEqual(470)`, and one 1S window-length
  equality) — that contract genuinely changed, so each now asserts the bounded
  `cap … 2 * cap` window instead. New coverage: the head holding still across
  consecutive ticks, the bounded length across a wide range of clock offsets,
  every window bar being real and ending at the current bucket, 1M staying
  unanchored, the series tail tracking the clock with no lag at both 1S and 15S,
  1S ticks being exactly one `update()` each with no extra `setData`, the
  re-anchor taking the `window-slide` branch and landing on the current bucket,
  and a scrolled-left viewer keeping the same wall-clock bars across a
  re-anchor. Deliberately not done: bars near the window's head do fall out of
  view at a re-anchor for a viewer scrolled far left — an accepted consequence
  of capping at all, noted in the test. The 1M-and-coarser uncapped-timeline
  follow-up from the entry above still stands. Validated this session, on the
  final commit: `npm run test:app` — 287 test files / 3285 tests passing.
  `npm run lint` — 0 errors (12 pre-existing warnings only). `npm run build` —
  succeeds. `npm run test:contracts` not run (no contract changes). No visual
  pass was possible from this session — the owner verifies on the deployed page,
  which requires this branch to be merged first, since `main` still carries both
  defects.

- Token chart flat bars no longer stretched — the grey wall and the fabricated
  tooltip (third defect on the same PR branch; the owner's 1S recording after
  the anchored-window fix showed seconds moving correctly but the plot filled
  edge-to-edge with solid grey columns). Issue #472 stretched every flat candle
  to a "minimum body height" so a lone flat bar would not render as a bare 1px
  line. `computeFlatCandleMinBodyHeight` sized that stretch as 0.0015 x the
  high/low span across the token's ENTIRE traded history — for WERDE (launch
  ~2.5e-12 to ~6.16e-8) about 9.2e-11. That was written when the only flat
  candle that could exist was a lone single-trade bucket; once the timeline was
  flat-filled between trades, it became wrong two ways. First, the price scale
  autoscales to the RENDERED bars, so in a window of nothing but flat bars the
  only thing defining the visible range was the stretch itself (genuine visible
  range ~1.2e-10 against a 9.2e-11 body) — self-reinforcing, so every bar filled
  the plot. Second, `subscribeCrosshairMove` reads the rendered bar, so the
  tooltip reported the stretched open/close as real and computed a non-zero
  change for a bucket in which nothing traded — the owner's own screenshot shows
  `O 0.00000006155792 / C 0.00000006164657 / VOL 0 ETH / +0.14%`, whose midpoint
  is exactly the header's `0.00000006160225`, confirming the mechanism from the
  UI alone. Fabricated numbers on a zero-volume bar, which this project does not
  ship. Fix, one function: `candleToBar` now returns a flat candle's own
  unmodified open/high/low/close, distinguished only by `FLAT_CANDLE_COLOR`, and
  `computeFlatCandleMinBodyHeight` is deleted outright rather than retuned —
  there is no correct constant, because the quantity it approximated (a pixel
  height) cannot be expressed in price space without the chart's own visible
  range, which is itself derived from these bars. A run of flat bars at one
  price now renders as one continuous flat line, which is what every other
  trading chart shows and what the flat fill was for. The genuinely-degenerate
  case (every rendered bar at exactly one price) was already handled honestly by
  the candlestick series' `autoscaleInfoProvider` via
  `expandDegeneratePriceRange`'s +/-5% padding — that moves the axis rather than
  the data, and is now the only mechanism doing so. `pointToSeriesDatum` and
  `candleToBar` lose their `minBodyHeight` parameter. **Tests changed rather
  than only added (rule 8, stated plainly):** the #472 case asserting
  `flatBar.high - flatBar.low` equals the minimum body height, and the case
  asserting `computeFlatCandleMinBodyHeight`'s span/degenerate maths, both
  pinned the defect and were replaced — a flat bar's rendered high minus low is
  now asserted to be exactly 0. New coverage: a flat bar reporting a zero
  percentage change (the tooltip can never invent movement), and a run of flat
  bars all rendering at exactly the carried-forward price. Validated this
  session, on the final commit: `npm run test:app` — 287 test files / 3286 tests
  passing. `npm run lint` — 0 errors (12 pre-existing warnings only).
  `npm run build` — succeeds. `npm run test:contracts` not run (no contract
  changes). Still no visual pass from this session — the owner verifies on the
  deployed page after merge.

- Test suite no longer makes real RPC calls (issue #475). A run intermittently
  reported `1 failed / 3285 passed`. Root cause: the on-chain health checks are
  reachable through their admin HTTP routes (`/api/admin/health`,
  `/api/admin/health/pipeline`), which pass no injectable deps, so those tests
  hit the **live Robinhood testnet RPC**. `buildContractsPipeline` issues three
  reads sequentially (`readChainId`, `readFactory`, `readBondingCurve`), each
  wrapped in its own `HEALTH_CHECK_TIMEOUT_MS` (5s) — a worst case of 15s
  against vitest's 5000ms DEFAULT test timeout, since `vitest.config.ts` sets no
  `testTimeout`. CI runs on 2-core `ubuntu-latest`, fewer cores than the dev box
  the timings were measured on, so CI was more exposed, not less. Fix:
  `lib/server/system-health.ts` gains `setContractsClientForTests`, a seam on
  `contractsClient()` following the existing `setPublicHealthPingForTests` /
  `setAdminSessionStoreForTests` pattern — one override covers both
  `checkContractsHealth` and `buildContractsPipeline`, since both resolve their
  client through that function. `tests/setup.ts` installs an instantly-failing
  client for every test, which is faithful (no RPC is reachable from CI, so
  these stages were already resolving red) and removes only the latency. Focused
  contracts tests are untouched: they pass explicit `client`/`readFactory`/
  `readBondingCurve` deps, which take precedence. Separately,
  `tests/system-health.test.ts`'s hung-ping case now uses fake timers instead of
  a real 5s wait, matching `tests/public-health-route.test.ts`'s own hung-probe
  test, and no longer needs its `10_000` override. Measured effect:
  `admin-health-pipeline-endpoint` 2373ms -> 15ms, `admin-endpoints` 2503ms ->
  101ms, `system-health` 5041ms -> 24ms, whole-suite test execution 24s -> 9.65s,
  and the slowest single test is now 250ms against the 5000ms default (a 20x
  margin, where it was previously 5001ms against 5000ms). No test assertions
  were weakened or removed — three new guards were added instead, asserting the
  default failing client is installed, that `contractsClient` returns an
  injected client outright, and that an uninjected contracts check goes through
  it rather than the network. Validated this session, on the final commit:
  `npm run test:app` — 287 test files / 3289 tests passing. `npm run lint` — 0
  errors (12 pre-existing warnings only). `npm run build` — succeeds.

- Token page UI fidelity pass against `design/token-page-v2/` (owner visual
  pass, 3 Sep). The owner compared the deployed page with the approved design
  side by side and reported it had drifted. Audited value-by-value against the
  design file and issue #460's spec first: the master panel recipe (3-stop
  gradient, inset hairline, black ring, deep shadow) is present on every panel,
  the CTA is a solid `#c6f53e` in all four rules (the design-tool commentary
  calling it a gradient was wrong about the code), and the 340px left column is as specified — none of those were changed.
  Seven genuine discrepancies were found in code and fixed. **(1) Header band** — `token-header-band.tsx` rendered
  `showDropArt ? <DROP ART pill> : <meta row>`, so the token's creator (the
  only viewer who ever sees DROP ART) never saw the holders / launched / chain
  line at all; the design shows both, with DROP ART as the art tile's own
  content. DROP ART now lives inside the 50x50 tile (design recipe: mono 700
  6.5px/1.6, letter-spacing 0.1em, `#6f746e`, filling the already-dashed tile,
  still display-only with no handler) and the meta row is rendered
  unconditionally; meta-row gap/letter-spacing corrected to the design's
  7px / 0.08em. **(2) Buy/Sell toggle** — the shared `.tabGroup` track had no
  `flex: 1`, so it shrank to its content and the active segment read as a
  small lime blob beside "Sell"; the design's swap track is `flex:1`. A
  swap-only `.buySellGroup` modifier adds it, leaving the Stats/Audit toggle
  (which reuses `.tabGroup` and is content-sized in the design) untouched.
  **(3) CTA label** — the design reads `Buy $HOODS` / `Sell $HOODS`; the page
  read `Buy` / `Sell`. `token-page-view.tsx` now derives `ticker` with the
  header band's exact expression (`launch?.ticker || (marketStats.supported &&
  marketStats.symbol) || null`) and passes it to `TokenLeftColumn`, so the
  header and the CTA can never disagree; a token with no known ticker falls
  back to the bare verb. **(4) Recent trades rows** — full-width rows divided
  by hairline separators became the design's row cards: a `12px 18px 16px`
  padded `.activityList` with a 4px gap, each `.activityRow` a `9px`-radius
  card with a `rgba(255,255,255,0.06)` border and the
  `rgba(255,255,255,0.035) -> 0.008` gradient, `9px 10px` padding, 12px gap,
  `600 11px` mono; header row `700 8.5px`, letter-spacing 0.13em; per-cell
  scale scoped to the row (wallet `#c3c9c4`, amount/percentage `#e6ebe4`,
  time 10.5px, side badge 700 10.5px, ETH value 700 11px) so the generic
  text classes keep their meaning elsewhere. The `64px 1fr 110px 96px 56px`
  trade grid is unchanged. **(5) Holders rows** — reordered to the design's
  rank, wallet, share bar, then right-aligned percentage, with the design's
  `26px 1fr 130px 52px` columns and `700 10px` rank. **(6) Down colour** — every "down" state (SELL rows, negative stats values,
  the split bar's right half, the negative change pill, down candles and
  wicks) used red `#e2564b`, and an earlier draft of this very entry defended
  that as "the design's own `dn` colour". It is not: the design's `dn` is the
  editable `downColor` prop, whose committed `data-props` default is the grey
  option **`#8d918c`** (options red / orange / grey); issue #460's "red" was
  quoted from the code's `?? '#e2564b'` fallback, not the owner's chosen
  default. A single `--accent-down: #8d918c` token now drives all of those;
  `--accent-red` remains for genuine error states only (`.tradeErrorText`).
  **(7) Chart grid** — the design's `showGrid` default is `false`; the page
  drew a grid. `createChart`'s grid lines are now `visible: false`; #460
  section 7's grid colours came from the file's grid-on branch. A new test
  decodes the design file's own `data-props` and asserts `DOWN_COLOR` and
  `--accent-down` equal its `downColor` default and that `showGrid` is false,
  so these two can never drift from the committed design again. **Tests
  changed rather than only added (rule 8, stated plainly):** the #460
  section 7 chart-options test asserted `DOWN_COLOR = "#e2564b"` and the two
  grid colours — it pinned values the design does not use — and was rewritten
  to the design's defaults. New source-pattern tests
  pin each of the first five (DROP ART inside the tile and no `showDropArt ?` gate
  around the meta row; the tile-text recipe; `.buySellGroup` present on the
  swap track only; row-card recipe and list wrapper on both lists; holders
  order/columns; the shared ticker expression and CTA label). No other existing assertion
  was changed. Not done: the design colours the meta row's numbers
  (`2,417`, `2D AGO`) `#c3c9c4` against the label's `#8d918c`; the current
  labels are single strings pinned by existing tests, so that split was left
  for a follow-up. Validated this session, on the final commit: `npm run
  test:app` — 287 test files / 3297 tests passing. `npm run lint` — 0 errors
  (12 pre-existing warnings only). `npm run build` — succeeds. No visual pass
  was possible from this session — the owner compares the deployed page with
  the design after merge.

- Token page: wallet persists across refresh, and opt-in Quick Trade (owner
  request, 3 Sep). **Bug** — the swap panel's `account` was only ever set
  inside `connectWallet()` via `eth_requestAccounts`, so every page refresh
  showed "Connect wallet" again even though the header band (which already
  did a passive `eth_accounts` read) knew the wallet. `token-left-column.tsx`
  now restores the account on mount with the same passive `eth_accounts` read
  (which only returns an account the wallet has already authorised for the
  site — never a popup) and follows `accountsChanged` with a cleaned-up
  listener; `eth_requestAccounts` remains only in the explicit Connect button
  (asserted: exactly one occurrence, inside `connectWallet`). **Quick Trade**
  — the owner asked for an "instant buy" a user can switch on for a
  fast-paced trading loop. Stated plainly: Hoodlums is non-custodial (rule 4),
  so every trade still requires the wallet's own confirmation; Quick Trade
  removes everything before that tap (type an amount → wait for the quote →
  press the CTA), not the confirmation itself. A signature-less buy would need
  session keys / account abstraction — a custody-adjacent design that is an
  owner decision, deliberately not built. New pure module `lib/quick-trade.ts`
  (unit-tested in Node with an injected storage): the plain-English consent
  message (bound to host and wallet, states that every trade still confirms
  in the wallet and that Hoodlums never holds keys or funds), per-wallet
  storage under one static `hoodlums.quickTrade.v1` key (following
  `hoodlums.support.lastSeen.v1`'s map shape), preset normalisation
  (buy 0.1/0.5/1 ETH, sell 25/50/75/100 %, slippage 50/100/300 bps),
  `quickSellAmountRaw` (exact integer share) and `planQuickBuy` (clamps to the
  exact gross that nets to what is left to graduate via the form's own
  `grossNativeInForExactNet`, refuses an unaffordable preset up front, never
  treats an unread balance as zero). The user enables it by signing that
  consent with `walletClient.signMessage`; the record is re-verified with
  `recoverMessageAddress` against the connected wallet on every load and
  account switch, and anything that does not verify is cleared, never
  trusted. A one-tap Buy/Sell fills the ORDINARY form (side, amount, preset,
  slippage) and, once the existing debounced quote has arrived, an effect
  hands off to the very same `submitTrade()` the CTA uses — one trade path,
  so the graduation clamp, slippage floor, fee note, revert detection and
  `TOKEN_TRADE_CONFIRMED_EVENT` all apply unchanged and `submitTrade` itself
  was not refactored (its pinned test slices are intact; asserted: exactly
  one `functionName: "buy"` and one `"sell"` in the component). A failed or
  slow quote clears the pending state with a plain message (8s timeout).
  UI: an inset well under the Buy/Sell row — Enable (or Connect wallet) when
  off; when on, `Buy 0.1 ETH` (solid CTA recipe) and `Sell 25%` (down token),
  an Edit row reusing the preset/slippage chips, and Turn off. Touch targets
  44px only under `(pointer: coarse)`. **Rule 10, stated plainly:** Quick
  Trade has no server component — the consent and presets never leave the
  browser — so there is nothing for System Health to monitor and no route to
  log from; an Activity-log entry for "quick trade enabled" would need a new
  wallet-signed server route and is left as an owner decision (it would also
  be the first place the app records a UI preference server-side). No
  existing test assertion was changed. Not verified on a real mobile Safari
  device this pass (rule 7) — the new well and buttons were checked by
  reading the CSS against the existing 390px behaviour, not on-device.
  Validated this session, on the final commit: `npm run test:app` — 288 test
  files / 3313 tests passing. `npm run lint` — 0 errors (12 pre-existing
  warnings only). `npm run build` — succeeds.

- Token page v2, part 3 of 3 — the holder-stats route (handover §5 item 1).
  The Stats panel's Holder breakdown rows TOP 10 % / DEV % / SNIPERS %, which
  rendered "—" since #443 part 1, are now real, per the rulings in
  `design/token-page-v2/token-page-data-inventory.md` section 8. New
  `GET /api/token-holder-stats?token=0x…` (`app/api/token-holder-stats/route.ts`,
  backed by `lib/server/token-holder-stats.ts`, cached ~60s server-side with
  in-flight dedupe, mirroring `/api/token-trades`'s shape: `isAddress`
  validation → 400, the shared `token-launches` service-isolation switch, a
  new per-IP `TOKEN_HOLDER_STATS_READ_LIMIT` of 300/hour sized from the 60s
  poll, `Cache-Control: no-store`, and a 502 with no `stats` key on a genuine
  chain-read failure — never a zero-filled breakdown). Every denominator is
  the token's live on-chain `totalSupply()` (the token is burnable) and every
  numerator that can be read on-chain is: Dev % is `balanceOf(creator())`;
  Snipers % is the summed current `balanceOf` of every distinct wallet whose
  FIRST curve `TokensPurchased` landed at or before `CurveFunded`'s block + 10
  (`SNIPER_WINDOW_BLOCKS`), with pool swaps and sells ignored and balance
  reads capped at `MAX_SNIPER_BALANCE_READS` = 100 earliest wallets; Top 10 %
  is Blockscout's `/tokens/{address}/holders` page minus the curve and the
  graduated `liquidityPool()` address, over supply. The curve is resolved
  exactly as the page does (`resolveTokenCurveAddress`) and then confirmed
  on-chain via `token()` before it is trusted, since that lookup's legacy env
  fallback can name another token's curve. The `CurveFunded` block comes from
  one small log query through `lib/server/token-trades-rpc.ts`'s existing
  `resolveStartBlock`/`fetchLogsInRange` (now exported, bodies unchanged —
  the pruned-RPC start-block logic is not duplicated) and is cached
  indefinitely per curve; the buy history comes from the same cached
  `getTokenTrades` read the page already polls. Degradation is per row, never
  whole: a Blockscout outage nulls Top 10 % only, a missing/unverified curve
  nulls Dev/Snipers only, and every `null` renders as "—" via a new
  `formatSharePercent` (one decimal place, per the design) while a real zero
  renders "0.0%"; a brand-new token whose only holder is the curve reports
  Top 10 as `null` ("—"), matching the inventory's "New" column. All
  percentage maths is bigint (`shareOfSupplyPercent`), never a float over
  18-decimal raw amounts. Client side follows "fetch once at the page, pass
  props": a new `lib/use-token-holder-stats.ts` (issue #403 pattern —
  visible-tab-only 60s timer matching the server cache, focus/
  visibilitychange refetch, `TOKEN_TRADE_CONFIRMED_EVENT` refetch, silent
  in-place updates, full cleanup) is called exactly once in
  `token-page-view.tsx` and threaded through `TokenLeftColumn` to
  `TokenStatsAuditPanel` as a `holderBreakdown` prop; the response
  deliberately carries no holder count, so the header's Blockscout count
  stays the single source for every holder-count occurrence. **Rule 10** —
  `buildTokenLaunchesPipeline` gained a `holder-stats-read` stage (amber
  until warmed, green/red with read age) mirroring `trades-read`; the route
  reuses the `token-launches` isolation switch. No migration, no new env
  vars, no contract changes. Not verified on a real device or the deployed
  page from this session — the owner confirms on the live WERDE/FGHJKH pages
  that the three rows show numbers (FGHJKH, graduated, should exclude its
  pool from Top 10). Validated this session, on the final commit: `npm run
  test:app` — 291 test files / 3359 tests passing. `npm run lint` — 0 errors
  (12 pre-existing warnings only). `npm run build` — succeeds,
  `/api/token-holder-stats` listed in the route output.

- Token page crash on the first pump.fun-shaped curve (owner-reported, 3 Sep
  evening, found while verifying the new testnet reserve settings — virtual
  token reserve 1,073,000,000 / virtual ETH reserve 0.0035 / target 0.01,
  which put the starting price at ~3.26e-12 ETH). The whole token page fell
  into the client error boundary ("Something went wrong loading this page")
  the moment curve state arrived. Root cause, proven against
  `lightweight-charts@4.1.3`'s own source and reproduced in Node:
  `computeChartMinMove` (`lib/token-chart-tools.ts`, issue #451) floors at
  `MIN_MOVE_FLOOR`, which was `1e-18`, and a price around 3e-12 lands exactly
  on that floor (`10^(-12-6)`). The library derives an internal integer base
  as `Math.round(1 / minMove)` and requires it to be an exact power of ten
  (or at least a product of 2s and 5s); `1 / 1e-18` in IEEE-754 is
  `999999999999999900`, which is neither, so its tick-span calculator throws
  "unexpected base" during price-axis layout. Every previous token sat near
  2.5e-9 (minMove 1e-15, base exactly 1e15), which is why this never fired
  before. Fix, one constant: `MIN_MOVE_FLOOR` is now `1e-15`, the smallest
  power of ten whose reciprocal is still a safe integer, and is exported so
  the tests can pin it. Below ~1e-9 the axis now carries fewer than six
  significant figures of tick resolution — a cosmetic cost, never a crash;
  the header band's six-significant-figure price is unaffected. **Tests
  changed rather than only added (rule 8, stated plainly):** the two #451
  cases asserting the `1e-18` floor pinned the defect and now assert
  `MIN_MOVE_FLOOR` (1e-15). New coverage: a verbatim replica of the
  library's `isBaseDecimal`/factoring check documents that a 1e-18 minMove
  yields a rejected base and 1e-15 does not, and a sweep of price magnitudes
  from 1e-30 to 1e6 (including the exact new starting price) asserts every
  derived base is a safe integer the library accepts. No other code changed.
  Separately confirmed live this session: the three Vercel curve variables
  now reach the launch flow (a fresh token's header showed
  0.00000000000326188 ETH), and PR #481's holder breakdown rows render real
  figures on the deployed page. Validated this session, on the final commit:
  `npm run test:app` — 291 test files / 3361 tests passing. `npm run lint` —
  0 errors (12 pre-existing warnings only). `npm run build` — succeeds.

- Snipers % is now measured in seconds, creator excluded (owner ruling,
  4 Sep, replacing the data inventory's original "first 10 blocks" rule).
  This chain produces blocks well under a second apart, so "10 blocks" was a
  few seconds wide and would drift with block time; 60 seconds is roughly the
  homepage grid's own poll cadence, so nothing bought inside it came from a
  person browsing the site. `lib/server/token-holder-stats.ts`:
  `SNIPER_WINDOW_BLOCKS` (10n) is replaced by `SNIPER_WINDOW_SECONDS` (60);
  `readCurveFundedAt` reads the `CurveFunded` block's own header timestamp
  (one extra `getBlock`, cached indefinitely per curve alongside the block
  number) and `selectSniperWallets` keeps every distinct wallet whose FIRST
  curve buy's `blockTimestamp` is at or before funding + 60s, now skipping
  the curve's `creator()` wallet outright — a dev buy right after funding is
  already DEV %, and counting it twice would make every launch with a dev
  buy look sniped. The tooltip on the SNIPERS % row
  (`components/token-page/token-stats-audit-panel.tsx`) reads "Wallets that
  bought within 60 seconds of launch · N wallets" using the
  `sniperWalletCount` the response already carried (display only, no API
  change). The two ruling lines in
  `design/token-page-v2/token-page-data-inventory.md` are updated to match,
  with the owner ruling noted inline. The window is a measurement, never a
  gate — nobody is prevented from buying at any moment. **Tests changed
  rather than only added (rule 8, stated plainly):** the `token-page-view-ui`
  and `token-holder-stats-ui` assertions pinning the old "first 10 blocks"
  tooltip string now pin the new base string and the dynamic `title`
  binding; the module tests' block-offset fixtures were rewritten as
  second-offset fixtures around the funded block's timestamp. New coverage:
  the creator is never a sniper (case-insensitively, and treated as an
  ordinary buyer only when no creator is known), 30 buys in 15 seconds all
  count (proving the window is wall-clock, not blocks), and the funded
  block's header read is cached with its log query. Validated this session,
  on the final commit: `npm run test:app` — 291 test files / 3363 tests
  passing. `npm run lint` — 0 errors (12 pre-existing warnings only).
  `npm run build` — succeeds.

- Homepage adopts the token page's design system (owner direction, 4 Sep:
  "the other pages should follow suit — tabs, colours, fonts, panelling, the
  premium look; the fixed sidebar stays"). Root cause of the "close but
  settling" the owner described: the token page defines its whole look as
  CSS custom properties scoped to its own `.page` root
  (`components/token-page/token-page.module.css`), while every other page
  runs on the older global palette (`app/globals.css` — `#55ff78`/`#bce759`
  greens, gold, flat panels, "Black Ops One" display) under three global
  override stylesheets carrying 129 `!important` rules, so each page could
  only ever be tuned toward the token page by eye. Fix: a new shared
  `app/hoodlums-premium-theme.css` defines the token page's exact 44-variable
  set under a `.hoodlums-premium` scope class (generated from the token
  page's own block; `tests/hoodlums-premium-theme.test.ts` parses both and
  asserts they are identical, value for value, so they can never drift).
  Scoped to a class rather than `:root` deliberately — `--display` already
  exists globally with the older Black Ops One value and this rollout is one
  page per PR. The homepage root (`components/hoodlums-market-home.tsx`)
  opts in; Archivo Black is added to `globals.css`'s Google Fonts import so
  `--display` resolves there. `hoodlums-market-home`, `hoodlums-token-grid`,
  `robinhood-trending-panel` and `hoodlums-graduating-row` module CSS are
  re-pointed at the shared recipes with layout untouched: the master panel
  recipe (border/22px radius/3-stop gradient/inset hairline + black ring +
  deep shadow) on cards, the trending panel and the empty state; the inset
  well recipe on art tiles; the chip track + glowing chip recipe (lime
  border at 50%, lime gradient fill, lime inset highlight + drop glow, lime
  text-shadow) on the New/Bonding/Graduated tabs and the Solana/Robinhood
  Chain tabs; the solid-lime CTA recipe (never a gradient, sans 800, lime
  drop glow) on every homepage button; section labels in the token page's
  `.sectionLabel` recipe (mono 600 9.5px, 0.18em, uppercase); the hero
  headline in `--display` (Archivo Black); the four-tier text greys
  throughout; and the settled up/down ruling (lime up, the design's grey
  `--accent-down` for down — the trending panel's red percentages become
  grey; `--accent-red` stays for genuine errors). The sidebar
  (`components/app-navigation.module.css`) is shared chrome, so its recolour
  applies to every page's sidebar at once, stated plainly: lime `#b9ef4d` →
  `#c6f53e`, the greenish `rgba(131,183,139)` hairlines → white 9%/7%
  hairlines, the active item and active step take the glowing chip recipe,
  the step tile and testnet note take the inset well recipe; the fixed
  238px layout, the mobile header/menu/bottom nav and every `:global`
  overlay rule are untouched. The pinned sparkline colours (`#91f0b6` /
  `#ff5f56`, issue #440) are chart semantics and are left exactly as they
  were. **Tests changed rather than only added (rule 8, stated plainly):**
  two `hoodlums-market-home` assertions pinning the graduating row's
  hard-coded `#bce759` and one `token-grid-card-chart-ui` assertion pinning
  `.cardTicker`'s `#566054` now pin `var(--accent-lime)` /
  `var(--text-label)`. New coverage in `tests/hoodlums-premium-theme.test.ts`:
  theme = token page variable set, class scope (never `:root`), layout
  import, font import, homepage opt-in, no legacy palette hex left in the
  four homepage stylesheets, and the chip/panel/well/CTA/display/down
  recipes present on the named rules. No admin, route, data or layout
  changes; rule 10 needs nothing (no feature, page or integration added).
  Not verified in a browser or on a device from this session (rule 7) — the
  owner compares the deployed homepage against the token page and reports;
  a fix round is expected. Validated this session, on the final commit:
  `npm run test:app` — 292 test files / 3373 tests passing. `npm run lint` —
  0 errors (12 pre-existing warnings only). `npm run build` — succeeds.

- `/social` adopts the shared premium theme (second page in the owner's
  4 Sep "follow suit" rollout, after the homepage). This page had already
  been tuned toward the token page by hand — its stylesheet carried the
  token palette as literal hexes (`#c6f53e`, `#f4f7f1`, `#8d918c`, …) plus
  its own `@import` of Archivo Black — but the recipes underneath still
  differed: folder-style section tabs with a lime top underline instead of
  the chip track, a 26px panel radius and bespoke shadows instead of the
  master panel recipe, lime **gradient** CTAs (`#c6f53e → #a7dd4a`) where
  the token page rule is solid lime, never a gradient, and flat inputs
  instead of the inset well. `components/social-hub.tsx`'s root `<main>`
  now opts in to `.hoodlums-premium`; `components/social-hub.module.css`
  drops its own font import (globals.css loads Archivo Black for every
  `(app)` page since the homepage PR) and every hand-copied hex resolves
  through the shared variables. Recipes aligned, layout untouched: the
  studio panel takes the master panel recipe and the tab bar the header
  wash; Setup / Calendar & Schedule / Queue & History / Settings & Rules
  sit in the chip track with the glowing active chip (the 860px mobile
  grid layout of that track is kept, its pill-radius and underline
  overrides removed so the same chip renders on phones); the PRO badge,
  live-tools pills, connected/coming-soon states and the metaPill take the
  chip-active recipe; the project picker and inner cards (connection,
  bot, performance, schedule, template, composer) take the raised recipe;
  text inputs take the inset well; Approve, the publish button, the
  no-project CTA, selected chips/toggles/calendar days and the mascot tile
  become solid `--cta-bg`; the shell background matches the token page's
  own two lime radials over `#0a0b09`; eyebrows take the section-label
  recipe; headings resolve `--display`. The sticky mobile tab bar contract
  (issue #390: `position: sticky; top: 72px; z-index: 80`) and every
  44px touch-target rule are unchanged. **Tests changed rather than only
  added (rule 8, stated plainly):** one `social-studio-queue-action-row`
  assertion pinned Approve's lime gradient
  (`linear-gradient(180deg, #c6f53e, #a7dd4a)`) — the exact pattern the
  CTA rule forbids — and now pins `var(--cta-bg)`. New coverage in
  `tests/hoodlums-premium-theme.test.ts`: page opt-in, no own font import,
  no hand-copied hex or lime-gradient CTA left, panel/chip/CTA/well recipes
  on the named rules, and the #390 sticky contract still present. Not
  verified in a browser or on a device from this session (rule 7) — the
  owner compares the deployed `/social` against the token page. Validated
  this session, on the final commit: `npm run test:app` — 292 test files /
  3377 tests passing. `npm run lint` — 0 errors (12 pre-existing warnings
  only). `npm run build` — succeeds.

- Studio header band and workspace label removed (owner direction, 4 Sep).
  `components/token-studio.tsx` no longer renders the sticky `.topbar`
  header — the "H" brand mark, the "PRIVATE BUILD / Meme Token Studio"
  eyebrow and title, the "Safe mode" badge, and the visible "Projects N" /
  "+ New token" buttons — and `components/token-studio-workspace.tsx`'s bar
  loses its "PRIVATE WORKSPACE OPEN" label and live dot, keeping only
  "Saved launches" and "Save & close" (pushed right via
  `.workspaceBar > .workspaceActions { margin-left: auto }`). The two
  header actions survive as `hidden` buttons with the same labels, because
  the workspace shell drives the studio by button text
  (`findStudioButton("new token" | "projects")`) from the homepage's Create
  new token CTA and the Saved launches button — `hidden` keeps them out of
  layout, the tab order and the accessibility tree while `button.click()`
  still fires. The stale "Safe mode" wording is gone too: the notice bar now
  starts empty and only renders when there is a message (previously it
  opened on "Safe mode is on — no launch transaction can be sent from this
  build.", which has been false since the studio launched to testnet for
  real), and the wallet-connected notices drop their "Safe mode still
  prevents deployment/mint creation" tails. The launch summary's "Mainnet
  transaction · BLOCKED IN SAFE MODE" row is a true statement (testnet-first)
  and is deliberately kept. The now-unreferenced `.topbar`/`.brand-lockup`/
  `.safe-badge` rules in `app/globals.css` are left in place (other pages'
  CSS is not this PR's concern). **Tests changed rather than only added
  (rule 8, stated plainly):** `tests/create-token-flow.test.ts` pinned the
  visible `<button className="primary-button compact" onClick={startNewProject}>`
  and now pins the hidden driver button. New
  `tests/studio-header-trim.test.ts` asserts the header, badge and label are
  gone, the two hidden driver buttons and the workspace's label-driven
  contract remain, the notice bar is conditional, and the safe-mode tails
  are gone while the mainnet row stays. Rule 10 needs nothing (wording
  removal, no feature). Not verified in a browser from this session (rule 7)
  — the owner opens the studio and confirms the band is gone and Create new
  token / Saved launches still work. Validated this session, on the final
  commit: `npm run test:app` — 293 test files / 3382 tests passing.
  `npm run lint` — 0 errors (12 pre-existing warnings only). `npm run build`
  — succeeds.

- Graduation fee (owner decision, 4 Sep 2026: 5% of the raised ETH at
  graduation, 100% to the treasury — mirroring pump.fun's original 6-of-85
  SOL migration take as the stepping stone before an own-swap fee model).
  `contracts/HoodlumsTestBondingCurve.sol` gains `GRADUATION_FEE_BPS = 500`:
  `_graduate()` now calls a new `_chargeGraduationFee()` (its own function
  because `_graduate()` already sits at the legacy codegen's stack limit —
  CI's solc rejected the inline version with "Stack too deep"), which
  computes `_graduationFee(realNativeReserve)` (floor-rounded, so rounding
  favours pool liquidity), credits it to `treasuryFeeBalance` and
  `totalFeesAccrued` before any external call, emits
  `FeeAccrued(treasury, fee)` plus a new `GraduationFeeCharged(amount)`, and
  seeds the pool with the remaining 95% (`Graduated.nativeLiquidity` is that
  post-fee figure). The creator receives none of it and the 60/40 carry is
  untouched; it is pull-payment only via the existing `withdrawFees()`. A new
  `graduationFeeAtTarget()` view exposes the fee, and `minimumCurveFunding()`
  measures its pool-liquidity floor against the post-fee amount. The fee never
  changes pricing, the target, `remainingNativeToGraduate()` or the buy clamp.
  **Tests changed rather than only added (rule 8, stated plainly):** two
  `.t.sol` assertions pinning the pool's WETH at exactly `target` and the
  `_predictGraduationDesiredAmounts` helper's `nativeLiquidity = target` pinned
  the no-fee behaviour and now use `target - fee`; the dust test's expected
  accrual chain gained the graduation fee between the final trading fee and
  the sweep. Five new Solidity tests cover the exact 5%, treasury-only
  accrual and event, treasury-only withdrawal, 0.2 ETH / 3.8 ETH at the 4 ETH
  target, unchanged target/clamp/progress, and the post-fee funding floor.
  Frontend: `lib/bonding-curve-fee-math.ts` mirrors the constant
  (`graduationFee`, `graduationPoolLiquidity`); because every already-deployed
  testnet curve predates the fee, the UI never trusts that mirror — a new
  single-function `HOODLUMS_BONDING_CURVE_GRADUATION_FEE_ABI` is read per
  curve in `lib/use-token-curve-status.ts` with a revert treated as `0n`, and
  `formatGraduationFeeNote` (`lib/bonding-curve-status.ts`) returns `null` for
  `0n`, so the swap panel's new note under the fee line (bonding and trading-
  closed states) only ever describes a fee the specific curve charges; the
  trading-closed copy no longer says the "full curve balance" moved to the
  pool. `/bonding-curve`'s static model copy and README document the fee.
  **Rule 10, stated plainly:** no new page, route or integration — the fee
  accrues to the same on-chain `treasuryFeeBalance` the trading fee already
  uses, which `/admin`'s Money section does not track today either (it shows
  verified plan payments only); one on-chain treasury-fee revenue reader
  covering both streams is the named follow-up. **Deploy note:** the live
  testnet pipeline (`0x3c6a…72ed`) deploys the previous curve bytecode, so
  this fee reaches new launches only after `npm run contracts:compile &&
  npm run deploy:curve-launch-pipeline:robinhood` and updating
  `NEXT_PUBLIC_HOODLUMS_CURVE_LAUNCH_PIPELINE_ADDRESSES`; existing curves are
  immutable and never gain it. `npm run test:contracts` could not run in this
  session — the proxy denies `binaries.soliditylang.org` (403, organisation
  egress policy), so the Solidity suite is validated by CI's `npm test`.
