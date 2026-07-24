# AGENTS.md — standing context for AI coding sessions

Read this before making any change. It is the project's source of truth for
intent, rules, and workflow. `CLAUDE.md` contains the same content for
Claude sessions.

## What this project is

HOODLUMS Launch Platform (Next.js 16 + TypeScript) — a browser-based,
non-custodial workspace for preparing and testing meme-token launches.
It is **testnet-first**: no unattended mainnet deploys, no custody of funds,
never asks for seed phrases or private keys. Project data lives in the
browser; every blockchain action is signed in the user's own wallet.

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
```

## Architecture map

- `app/` — routes: `/` studio, `/providers`, `/allocations`,
  `/liquidity-lab`, `/bonding-curve`, `/testnet`, `/monad`, `/social`,
  `/account` (disabled preview), `/[slug]` (public generated token site —
  route/renderer complete, not yet publishable). See README route table
  for status of each.
- `app/api/` — server routes: `generate-site-style` (OpenAI-backed),
  `dexscreener-pair`, `social/telegram`.
- `app/[slug]/artwork/route.ts` — HTTP-fetchable OG/artwork image for a
  public generated site; not under `app/api`, so it is not part of
  `backend-inventory.test.ts`'s API route inventory.
- `lib/server/` — server-side logic incl. `api-protection.ts`
  (shared-secret + origin check + per-IP rate limiting) and
  `public-generated-sites.ts` (the public-site repository boundary —
  default adapter always returns no record; see README).
- `lib/slug.ts` — shared website-path validation/reserved-word rules used
  by both the studio save flow and the public route.
- `lib/site-design-variants.ts` / `lib/generated-site-variants.ts` — the five
  stable artwork-driven design directions, response validation and structural
  diversity guard used by the protected full-page generator and selector.
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
2. **Secrets stay server-side.** `OPENAI_API_KEY` must never appear in
   client code or a `NEXT_PUBLIC_` variable. Never hardcode real secrets;
   fallback defaults must be treated as public.
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
7. **Tests are the referee.** Every behaviour change ships with tests, and
   the full existing suite must pass. Never mark work complete with failing
   tests, and never edit a test's assertions just to make it pass —
   if a test seems wrong, say so in the PR instead.
8. **Keep changes reviewable.** One concern per PR, plain-English
   description of what changed and why, note any trade-offs or caveats.

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
- Artwork-driven full-page generation now returns five selectable directions (issue #117): Editorial Poster, Cinematic Showcase, Modular Cardscape, Kinetic Collage and Minimal Gallery. One protected browser request reuses one artwork/inspiration analysis and fans out to five parallel full-page OpenAI calls. Live sandboxed thumbnails let the creator switch locally; only the chosen validated HTML plus variant ID/label is saved. The shared-secret, allowed-origin and 10-request/hour request limit are unchanged, while full-page model usage per generation is roughly fivefold.
- Public generated token site infrastructure is merged (issue #114): a
  root dynamic route `app/[slug]/page.tsx`, its data contract
  (`lib/public-site.ts`), a server-only repository boundary
  (`lib/server/public-generated-sites.ts`), dynamic metadata plus an
  HTTP-fetchable OG/artwork image (`app/[slug]/artwork/route.ts`),
  shared slug validation/reserved words (`lib/slug.ts`) enforced at save
  time in the studio, and local capture of the validated generated HTML
  onto `TokenProject` for a future publish payload. **No site is publicly
  reachable yet** — the repository boundary's default adapter always
  returns no record, so every slug 404s until a durable store, an
  authenticated/authorised publish write path, and an atomic server-side
  unique-slug constraint are built. No user accounts were added.
