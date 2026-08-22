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
