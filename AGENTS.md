# AGENTS.md — standing context for AI coding sessions

Read this before making any change. It is the project's source of truth for
intent, rules, and workflow. `CLAUDE.md` contains the same content for
Claude sessions.

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
