# CLAUDE.md — standing context for AI coding sessions

Read this before making any change. It is the project's source of truth for
intent, rules, and workflow. `AGENTS.md` contains the same content for other
AI tools.

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
  `/account` (disabled preview). See README route table for status of each.
- `app/api/` — server routes: `generate-site-style` (OpenAI-backed),
  `dexscreener-pair`, `social/telegram`.
- `lib/server/` — server-side logic incl. `api-protection.ts`
  (shared-secret + origin check + per-IP rate limiting).
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

- HoodlumsTokenFactory is merged (PR #91) but **not yet deployed
  on-chain**. Next: deploy to Robinhood Chain Testnet with zero fee,
  verify on the explorer, route the `/testnet` deploy button through
  `launchToken()`.
- HoodlumsTestBondingCurve is merged (PR #103). The `/bonding-curve` route
  is the fifth visible workflow step and currently explains the approved
  lifecycle. The curve is not deployed or factory-connected yet, and live
  quote/buy/sell controls are not active. Platform/creator/reserve fee
  percentages remain undecided and must not be invented.
