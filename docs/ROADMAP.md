# HOODLUMS Roadmap

A consolidated view of where the platform stands, grouped by theme. Built from
`CLAUDE.md`, the README, git history, and open GitHub issues — not from an
external chat transcript (this session has no access to chat history outside
this repo; see note at the bottom).

Legend: 🟢 Shipped · 🟡 Specced, ready to build · ⚪ Idea / future

---

## 1. Launch Studio & AI Site Generation

🟢 **Shipped**
- Studio: create/save/reopen/delete/export token projects in browser storage;
  configure name, ticker, description, supply, decimals, slug, contract
  address, X/Telegram links; target Solana or Robinhood Chain Testnet.
- Artwork upload (up to 20MB) with in-browser optimization.
- AI site generation: OpenAI-vision style analysis + full-page generator,
  streamed rather than waited-for-in-one-shot, with a raised output budget
  and a faster AI Gateway model.
- Free-site template path (`docs/free-site-template-source.html`) is now the
  Studio default, with the bespoke AI pipeline as a secondary option — a
  typed renderer, server-side generation, and shared artwork-identity retry
  logic between the two pipelines.
- Free-site correctness fixes: sections are optional with per-section
  toggles; tokenomics/socials are derived from facts instead of being
  invented by the model; new projects no longer default to the Hoodlums
  identity; hero artwork no longer crops/fades unintentionally; reveal
  animations no longer hide content when JS fails; preview returns
  placeholder-bearing HTML correctly.
- Provider failure messages surface the actual failure kind/status
  (timeout vs HTTP code) instead of one generic sentence (issue #148 →
  merged PR #149).
- Isolated preview iframe with automatic Dexscreener chart detection for a
  saved contract address.
- **Dexscreener chart embedded in the page** instead of a link-out card
  (issue #179 → merged PR #180): `frame-src` scoped to exactly
  `https://dexscreener.com`, the page-sanitiser allows only an iframe
  pointing at that one origin, the outer sandbox gained `allow-popups`
  (not `allow-same-origin`) so the fallback "Open Chart ↗" link works, and
  the embed URL is a new platform-facts placeholder. The bespoke pipeline
  gained nothing from this change.

🟡 **Specced, ready to build**
- Nothing currently open in this sub-theme (chart embed above is done).

### AI generation quality

🟡 **Specced, ready to build**
- **Generated copy reads generic and clichéd** (e.g. "neon-hearted mischief
  in the metaverse"). A prompt-only fix has been proposed but not yet
  confirmed/tested. Two further levers are identified but untried:
  - Raise the free-site copy call's `reasoning.effort` from `"minimal"` to
    `"medium"` (`lib/free-site-openai-pipeline.ts:202`) — it was dropped to
    minimal for latency (#152); that may be trading away copy quality.
  - Fix `lib/site-page-openai-pipeline.ts:224`, where the bespoke page's
    artwork call passes `detail: "low"` while every other artwork call in
    the codebase uses `detail: "high"` — an inconsistency, not a deliberate
    choice, and a plausible contributor to generic output.
  None of the three (prompt fix, reasoning effort, image detail) has been
  tested in isolation yet, so it's not yet known which lever(s) actually
  move the clichéd-copy problem.

⚪ **Idea / future**
- Nothing further queued here beyond the quality levers above.

---

## 2. Durable Public Publishing

🟢 **Shipped** (implemented, flagged in `CLAUDE.md` as "for review" — owner
must deliberately run the production migration and enable first write)
- Postgres-backed `published_sites` / `wallet_nonces` via server-only
  `DATABASE_URL`, migration-managed schema, unique-slug constraint at the DB
  level.
- Wallet-signed publish flow: `POST /api/publish/challenge` issues a
  5-minute, single-use, SHA-256-hashed nonce bound to wallet/slug/chain/
  domain/purpose; `POST /api/publish` verifies the signature, atomically
  consumes the nonce, sanitises and size-caps the HTML/artwork, and inserts
  the site. Owner wallet address comes only from the verified challenge.
- Public read path: `app/[slug]/page.tsx` reads live from Postgres on every
  request (`force-dynamic`); unknown slugs 404; `app/[slug]/artwork/route.ts`
  serves validated artwork for OG/Twitter metadata.
- Signed draft publishing + an owner "go-live" flow (PR #137).
- Published site now gets a server-rendered, standalone layout (escaping the
  studio shell) with Google Fonts preserved (#160, #162).
- **Platform facts resolved at request time, not baked in** (issue #173 →
  merged): the stored HTML keeps placeholders for contract address,
  Dexscreener chart, and buy link; `lib/free-site-platform-facts.ts`
  substitutes current values (including a live Dexscreener lookup, now
  cached per #177) on every request, HTML-escaped, with themed coming-soon
  panels before each fact exists. User-supplied facts (X, Telegram, website)
  stay resolved once at generation time and are simply omitted when blank —
  never shown as "coming soon."
- `db/migrations/003_lp_locked_at.sql` adds the nullable `lp_locked_at`
  column the facts substitution reads from (migration numbering collision
  with `002_draft_visibility.sql` fixed, issue #174).
- Dexscreener pair lookups are cached to cut redundant calls (#177).

🟡 **Specced, ready to build**
- **#158 — Owner republish over their own slug.** Today `publishWithChallenge`
  uses `ON CONFLICT (slug) DO NOTHING`, so a slug can only ever be written
  once — an owner can't push an updated generation over their own live/draft
  site. Spec: inside the existing locked transaction, if the row's
  `owner_wallet_address` matches the signing wallet, `UPDATE` the HTML/
  artwork/metadata instead of no-op'ing; a different wallet still gets
  `slug_conflict`; visibility (live vs draft) and the draft token must be
  preserved across the update. Test list included in the issue.
- **#97 — Account-page wallet connect is misleading.** `/account` is a
  disabled preview, but its Connect button shows a live confirm dialog that
  never resolves (dialog doesn't close, connection state never updates).
  Owner explicitly scoped this down to two acceptable fixes — either disable
  the buttons and label the section "coming soon" like the rest of the page,
  or make the in-session connect state actually work — and said to pick
  whichever is less code, not to build persistent accounts yet.

⚪ **Idea / future**
- No account-based dashboard, private cross-device draft sync, ownership
  transfer, or site-deletion flow (explicitly out of scope per the README's
  safety-model section — publishing today is a one-shot durable write once
  #158 lands).
- Dedicated object storage for artwork — currently a validated, size-capped
  data-URL stored directly in Postgres.
- Writing `lp_locked_at` itself at graduation time — the column exists and
  is read by the facts substitution, but nothing populates it yet (this
  waits on bonding-curve deployment below).

---

## 3. Token Deployment & Bonding Curve (on-chain)

🟢 **Shipped**
- `HoodlumsTokenFactory` — **deployed and verified on Robinhood Chain
  Testnet** (`0x39207baa4d0a30a5194770563ec586978c9fbcb3`, owner
  `0x3990b0...C966a`, treasury `0x505217...2AF1F5`, launch fee `0`).
  `/testnet` routes through `launchToken()` automatically whenever a factory
  address is configured for the connected chain, falling back to the direct
  `FixedSupplyMemeToken` deploy otherwise. **Milestone 1 is complete.**
- `HoodlumsTestBondingCurve` contract is merged, including the fully decided
  trading-fee model (issue #112): 1% fee on every buy/sell, split 60%
  treasury / 40% creator, pull-payment only (`withdrawFees()`), fees excluded
  from `realNativeReserve` and the graduation target so a reverting fee
  recipient can never block trading or graduation.
- `HoodlumsTestLiquidityPool` — private test-only constant-product AMM for
  the Liquidity Lab (manual deploy + register flow).
- Fixed-supply, burnable ERC-20 test deploys on Robinhood Testnet, Solana
  devnet (mint + revoke authority), and Monad Testnet (chain ID `10143`
  guard).
- `/bonding-curve` route exists as the fifth workflow step, explaining the
  approved lifecycle (full-supply-into-curve, wallet-signed trading,
  graduation target, automatic pool creation, permanent initial LP lock).

🟡 **Specced, ready to build**
- **#101 — Wallet-signed factory deployment UI**, as originally scoped
  (a testnet-only admin panel that deploys `HoodlumsTokenFactory` through the
  owner's own wallet, with chain-ID and exact-owner-address gating, and an
  on-chain read-back verification). Note: the factory is *already* deployed
  and verified — but that happened through the manual Hardhat script
  (`npm run deploy:factory:robinhood`) documented in the README, not through
  the in-app wallet-signed flow this issue specifies. Worth a decision: close
  #101 as superseded, or still build the UI for future redeployments.

⚪ **Idea / future**
- Deploying `HoodlumsTestBondingCurve` itself and wiring `/bonding-curve` to
  live quote/buy/sell controls — the contract and fee model are locked, but
  no deployment or UI wiring has started.
- Bonding-curve → `lp_locked_at` write-back once graduation is live (see
  Publishing section above).

---

## 4. Allocation, Liquidity Lab & Social Tools

🟢 **Shipped**
- Allocation desk: reads token metadata/balance from a deployed Robinhood
  Testnet ERC-20, plans liquidity/community/team/reserve splits with an
  exact-100% check, sends wallet-approved ERC-20 transfers, records tx
  hashes, saves plans locally and as downloadable JSON. Production liquidity
  router deliberately disabled; no vesting contracts.
- Robinhood provider desk: loads a saved project, connects to chain `46630`,
  copies the launch package/artwork, opens the provider for a wallet-signed
  launch, verifies the resulting contract, tracks the creator buy, refreshes
  balances, and saves the verified address back to the project.
- Liquidity Lab: register a separately deployed `HoodlumsTestLiquidityPool`,
  approve spending, add initial liquidity, inspect reserves (test-only, not
  an audited AMM).
- Social workspace (`/social`): reusable launch/contract-live/community
  announcement drafts, local edit/save, copy, artwork download, X composer
  handoff, and Telegram publishing with a one-time (not stored) bot token.

🟡 **Specced, ready to build**
- Nothing currently open in this theme.

⚪ **Idea / future**
- Nothing currently tracked; would follow from bonding-curve deployment
  (e.g., allocation/liquidity flows that assume curve-based launches instead
  of direct AMM seeding).

---

## 5. Platform, Security & Infra

🟢 **Shipped**
- `/api/generate-site-style` and full-page generation are protected by
  Origin check + shared secret (`GENERATE_SITE_STYLE_SHARED_SECRET` /
  `NEXT_PUBLIC_...` bridge) + 10 req/hour per-IP rate limiting (issue #92's
  ask — already implemented per `CLAUDE.md` standing rule #1 and the README;
  worth closing #92 as done rather than treating it as open work).
- Publish endpoints (`/api/publish/challenge`, `/api/publish`) have their own
  separate per-IP rate limits plus signature verification.
- `lib/slug.ts` is the single source of truth for slug rules (lowercase
  ASCII, 48 chars max, reserved-word rejection), shared by studio save,
  publish, and the public route.
- `tests/backend-inventory.test.ts` intentionally fails on any new API route
  added without matching tests.
- Migration collision (`002_draft_visibility.sql` vs a duplicate `002_...`)
  fixed by renaming to `003_lp_locked_at.sql` (#174).

🟡 **Specced, ready to build**
- **#93 — Update README** to describe current features. Likely already
  satisfied — the current README is a detailed, up-to-date feature and route
  inventory — so this is probably safe to close rather than build.

⚪ **Idea / future**
- Nothing else queued; this theme is mostly "keep the referee tests honest"
  as new routes ship.

---

## 6. Mobile Safari Stability

🟢 **Shipped**
- Standing rule added after PR #118 caused a mobile Safari memory crash from
  multiple simultaneously-mounted live iframes: only one active preview
  iframe at a time, large generated HTML/artwork kept out of React state and
  the initial client bundle, iframe `srcDoc`/refs/listeners cleaned up on
  unmount.
- The five-selectable-site-designs release (#118) that caused the crash was
  rolled back in production and then reverted in source (PR #119, #120).
- Mobile wallet-connect button prominence, published-site mobile containment
  fixes shipped along the way.

🟡 **Specced, ready to build**
- **PR #53 — Reduce mobile wallet button prominence** is still open
  (style-only: 30px→24px min height, smaller padding/font, same colour, no
  logic change). Small and stale — worth merging or closing deliberately
  rather than leaving it open.

⚪ **Idea / future**
- None tracked beyond the standing rule itself.

---

## 7. Accounts (explicitly deferred)

⚪ **Idea / future** — nothing shipped or specced yet
- `/account` remains a disabled preview of Google/GitHub/X/MetaMask/Rabby/
  Phantom account options; wallet connections inside individual tools work
  independently of it.
- No account-based dashboard, cross-device private draft sync, or site
  ownership-transfer flow exists. `#97` (above, in Publishing) is the one
  concrete, scoped piece of account-page work currently open — and even that
  is explicit about *not* building persistent accounts yet.

---

## 8. Mainnet Path (deliberately gated)

⚪ **Idea / future**
- **Issue #3 — "Complete wallet-signed testnet launches"** is the owner's
  manual QA checklist (not a code spec): prove both the Robinhood
  Chain-testnet and Solana-devnet launch flows end-to-end, record the
  transaction/contract/mint evidence, and confirm full-supply-to-signer with
  no external mint. The issue is explicit that **mainnet deployment must not
  be enabled until both are verified.**
- No mainnet deploy path, real-fund flow, or removal of the chain-ID guards
  (Robinhood Testnet `46630`, Monad `10143`) is planned or in progress —
  `CLAUDE.md` standing rule #3 requires an explicit owner request before any
  of that starts.

---

## Housekeeping worth doing alongside the next build

A few open issues look already resolved by later merges, based on git
history and the current README/CLAUDE.md — closing them would keep the
issue tracker matching reality:
- **#92** (protect site-style API) — protection already shipped.
- **#148** (surface provider failure kind/status) — shipped via PR #149.
- **#174** (migration numbering collision) — shipped via the commit that
  produced `003_lp_locked_at.sql`.
- **#93** (update README) — README already looks current; worth a quick
  read-through to confirm, then close.
- **#178** — duplicate of #179; #179 was closed out by merged PR #180, but
  #178 is still open and should be closed as a duplicate.

---

## Note on sources

This document was assembled from files and history inside the
`tyroneblakestewart-dot/launch-pad` repository — `CLAUDE.md`, `README.md`,
`git log`, and open GitHub issues/PRs — because this session does not have
access to chat history from a separate claude.ai conversation. If there's
context from that chat that isn't reflected in an issue, PR, or the README
yet (e.g. an idea you discussed but never turned into a GitHub issue), it
won't appear here — paste or summarize it and this doc can be extended.
