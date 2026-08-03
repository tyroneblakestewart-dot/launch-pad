# UX copy audit — hoodlums.dev

Audit only, no code changed. Every finding below was traced to an exact
file/line and, where a claim depended on runtime behavior rather than the
text alone (a feature existing, a value getting stripped before shipping,
a payment flow existing), verified directly against the code rather than
assumed from the copy.

## Methodology

Read in full: `lib/page-content-registry.ts`, `lib/launch-paths.ts`,
`components/token-path-chooser.tsx`, all 6 admin components
(`admin-dashboard.tsx`, `admin-login-screen.tsx`,
`admin-operations-sections.tsx`, `admin-pages-section.tsx`,
`admin-subscribers-section.tsx`, `admin-system-health.tsx`), the homepage
chrome (`hoodlums-market-home.tsx`, `hoodlums-welcome-modal.tsx`,
`app-navigation.tsx`), and every studio/provider/allocation/testnet/public-
page/social component and page file plus every `app/api/**/route.ts` error
string — roughly 750 distinct user-facing strings across 45+ files. Every
issue below cites its exact location; strings not mentioned were reviewed
and found to be clear, consistent, and on-brand, so they aren't listed
(this is a findings report, not a full transcript).

One flagged candidate was checked and **ruled out**, noted here so it
isn't re-investigated: `docs/free-site-template-source.html` contains a
"DEMO CONTROL PANEL — remove before ship" block. Confirmed in
`lib/free-site-template.ts:236-253` that this exact block (CSS, markup,
and JS) is stripped out via `removeBetween()` before the template is used
to generate a real published site. Not a live issue.

---

## P1 — Confusing or broken, fix before launch

### 1. Paid plans can be "purchased" with no payment ever collected

- **Location:** `components/token-path-chooser.tsx` (renders real prices
  for `bond-pro-site` and `pro`) → `components/token-studio.tsx:290`
  (`confirmLaunchPath` → `updateProject("launchPath", path)`).
- **Current text:** "Bond + Pro Site" — "~$10 in ETH · one-off"; "Pro" —
  "$30/month · USDT"; "By clicking this button, you agree to the Terms and
  Conditions, Privacy Policy, and certify that you are over 18 years old."
- **Problem:** Selecting either paid plan only writes a string to local
  browser state. No payment/checkout/subscribe API route exists anywhere
  in `app/api/` — confirmed by directory listing. Yet `admin-subscribers-
  section.tsx` has a fully built read-only dashboard for tracking real
  subscribers (`lastPaymentAmountEth`, `expiresAt`, etc.) with no possible
  way for a row to ever get created. A user can click through legal-sounding
  agreement language for a transaction that never happens.
- **Suggested replacement:** Wire real payment collection before these
  tiers are selectable, or mark them "Coming soon" / disable selection
  with an honest note ("Payment isn't live yet — this plan can't be
  activated") until it exists.

### 2. "Terms and Conditions" / "Privacy Policy" aren't links, and neither page exists

- **Location:** `components/token-path-chooser.tsx:97-98`,
  `components/hoodlums-welcome-modal.tsx:170-171`.
- **Current text:** `<span>Terms and Conditions</span>`,
  `<span>Privacy Policy</span>` — both plain, un-linked `<span>` elements.
  No `/terms` or `/privacy` route exists anywhere under `app/`.
- **Problem:** The surrounding sentence says "by clicking this button, you
  agree to the Terms and Conditions, Privacy Policy" — but there is
  nothing for a user to click through and read. This is a legal-disclaimer
  integrity issue, not a cosmetic one.
- **Suggested replacement:** Wrap in real `<a href="/terms">`/`<a
  href="/privacy">` once those pages exist. Until they do, don't reference
  documents that can't be produced on request.

### 3. "Bond + Site" advertises a feature that shipped and was reverted

- **Location:** `lib/launch-paths.ts:26` (bullet: "5 design variants").
- **Current text:** Bond + Site plan bullets: "Everything in Bond", "AI-
  generated website", "5 design variants", "Dexscreener chart", "Holder
  stats".
- **Problem:** PR #118 ("Add five selectable artwork-driven site designs")
  was reverted via PR #119/#120 after a mobile Safari crash. Confirmed: no
  design-variant-selection code exists anywhere in the current generation
  pipeline (`lib/free-site-*.ts`). The plan promises a feature that isn't
  there.
- **Suggested replacement:** Remove the bullet, or replace it with what's
  actually shipped (single AI-generated design per project via the free-
  site template, with an optional bespoke path).

### 4. NOXA is presented as a live launch provider — it shut down July 11, 2026

- **Location:** `components/provider-launcher.tsx:48-52` (provider card
  copy), `:398,401,405` (verification status copy checking against
  "NOXA's factory"), `components/studio-provider-transfer.tsx:77`.
- **Current text:** "NOXA Fun — Launch + immediate buy handoff — Prepare
  the launch pack here, complete the wallet-signed launch on NOXA, verify
  the token, then continue straight to the official provider for the
  creator buy."; "Select Robinhood Chain in the studio before copying to
  NOXA or Pons."
- **Problem:** Per earlier research in this project, NOXA — Robinhood
  Chain's former largest launchpad — shut down after a bot-spam incident.
  The app still offers it as a working provider option and still checks
  transaction proofs against "NOXA's factory."
- **Suggested replacement:** Remove NOXA from the selectable provider list
  (or mark it clearly discontinued) until/unless it's confirmed active
  again.

### 5. Systemic: raw exception messages shown directly to users

- **Location:** ~35 call sites across 10+ components, all following the
  same `catch (error) { setStatus(error instanceof Error ? error.message
  : fallback) }` pattern (or the shared `readError()` helper). Worst
  examples:
  - `token-allocation-desk.tsx:483` — a failed ERC-20 transfer can surface
    a raw Solidity revert string (e.g. "ERC20: transfer amount exceeds
    balance") directly.
  - `testnet-launcher.tsx:238` — "Supply multiplied by decimals exceeds
    Solana's u64 token limit." — exposes an internal data-type detail no
    non-developer has context for.
  - `liquidity-lab.tsx:153,174` — can surface raw AMM contract revert text.
  - `bonding-curve-graduation-status.tsx:117` — raw RPC/ABI-decode failure
    text shown in the "UNAVAILABLE" state.
  - `app/api/generate-site-page/route.ts:359-360` — "...still resembled
    the legacy terminal fallback..." ships literal internal implementation
    jargon into a user-facing error.
  - `app/api/generate-free-site/route.ts:278` — a raw thrown exception's
    `.message` returned to the client unfiltered.
  - `app/api/social/telegram/route.ts:84-85` — could surface a raw
    Telegram Bot API error string verbatim.
- **Problem:** Directly violates the "human-readable, actionable, no
  internal jargon" audit criterion, and it's not a one-off — it's the
  default error-handling pattern across the wallet/contract-interaction
  surfaces.
- **Suggested replacement:** One shared "humanize wallet/contract error"
  helper: map known patterns (user rejection, insufficient balance, wrong
  network, common revert reasons) to plain sentences, and fall back to a
  generic actionable message ("Something went wrong sending this
  transaction — check your balance and try again") instead of the raw
  string. Apply it everywhere `readError`/`error.message` currently
  reaches the UI. This is one reusable fix, not 35 separate rewrites.

### 6. Developer-only instructions shown to end users in Liquidity Lab

- **Location:** `components/liquidity-lab.tsx:201`.
- **Current text:** "Deploy contracts/HoodlumsTestLiquidityPool.sol in
  Remix with the HOODLUMS address as its constructor argument, then paste
  the new contract address."
- **Problem:** A literal Solidity file path, the Remix IDE, and
  "constructor argument" — this is a developer runbook, not product copy,
  for a page a token creator is meant to use themselves.
- **Suggested replacement:** If this tool is meant for non-developer
  creators, it needs a guided/automated deploy step, not manual Remix
  instructions. At minimum, reframe: "This lab needs a test trading pool
  contract. If you don't have one yet, ask a developer to deploy one — see
  [setup guide]."

### 7. Leftover internal/dev framing in user-facing copy

- **Location:** `components/token-studio.tsx:826`, `:73`.
- **Current text:** "The deployment adapter is deliberately not active in
  this first commit. The next step is a testnet-only wallet transaction,
  followed by a reviewed mainnet switch." / "Something went wrong."
- **Problem:** "In this first commit" is git/developer language a user has
  no reason to parse. "Something went wrong" gives no context or next
  action (the audit's own clarity criterion calls this out explicitly).
- **Suggested replacement:** "Deployment isn't connected yet — this
  preview shows what your transaction will look like once it is." For the
  generic error: name what failed and what to try next, even briefly.

### 8. Broken empty state: a token's Supply can render as literally nothing

- **Location:** `components/public-token-fallback.tsx:27` (via
  `formatSupply()`, lines 4-7).
- **Current text:** N/A — `formatSupply()` returns its input unchanged
  when it isn't a finite number; if `site.supply` is `""`, the value next
  to the "Supply" label is a blank string.
- **Problem:** This is the exact "shows nothing" failure this audit was
  asked to catch.
- **Suggested replacement:** Fall back to "—" or "Not set", matching the
  pattern already used elsewhere in the app (e.g. the allocation desk's
  "Not loaded" / "—").

---

## P2 — Inconsistent, fix soon

### 9. The core "start a token" action has at least five different names

- **Location:** "Create new token" (homepage primary CTA,
  `hoodlums-market-home.tsx:30`), "Create & Bond" (sidebar nav label,
  `app-navigation.tsx:11`), "+ New token" (studio topbar,
  `token-studio.tsx:422`), "Create token" / "Create new token →" (token
  grid empty states, `hoodlums-token-grid.tsx:57,87`), "Bond" (path-chooser
  plan name, `lib/launch-paths.ts:16`).
- **Problem:** No single, reinforced term for the top-level action a new
  visitor is meant to take.
- **Suggested replacement:** Standardize on one term for "start here" (e.g.
  "Create a token") and reserve "Bond"/"Create & Bond" specifically for
  describing the plan or workflow step, not the entry-point button.

### 10. Duplicate error strings drifting independently within the same file

- **Location:** "Upload artwork before generating the website."
  (`full-website-generator.tsx:183` and `:254`); "The site could not be
  made live." (`full-website-generator.tsx:175` and `:471`); "The wallet
  returned no account." repeated with slightly different wording across
  `token-studio.tsx:340`, `full-website-generator.tsx:137`,
  `provider-launcher.tsx:250`, `token-allocation-desk.tsx:263` ("no valid
  account"), `liquidity-lab.tsx:89` ("No wallet account returned"),
  `testnet-launcher.tsx:156`, `monad-testnet-launcher.tsx:106`.
- **Problem:** Not wrong today, but each copy will drift independently the
  next time one gets edited, quietly reintroducing inconsistency.
- **Suggested replacement:** Extract to one shared constant/helper per
  message so a future edit updates every call site at once.

### 11. Admin section labels are terse enough to be ambiguous at a glance

- **Location:** `components/admin-dashboard.tsx:29-36` (`SECTIONS` list).
- **Current text:** "Money", "Issues".
- **Problem:** "Money" could mean revenue, treasury balance, or
  withdrawable fees before you open it (it's actually live factory
  launch-fee/recipient-balance data). "Issues" reads as generically vague
  before you see it's health warnings plus manual circuit breakers.
- **Suggested replacement:** "Money" → "Treasury" or "Factory Revenue";
  "Issues" → "Health & Circuit Breakers" (or keep "Issues" and lean on the
  already-good intro copy to carry the meaning).

### 12. Testnet-mode indicator is hidden from the main nav by default

- **Location:** `components/app-navigation.tsx:20,72-74`.
- **Current text:** The "Testnet mode — Robinhood Chain · 46630" sidebar
  note only renders when `NEXT_PUBLIC_SHOW_TESTNET_TOOLS` is `"true"`,
  which defaults false as of the recent nav-tab flag change (PR #193).
- **Problem:** With testnet-only nav items now hidden by default, there's
  no persistent chain-ID reminder in the primary chrome for a regular
  visitor — chain ID does still appear in various in-flow disclaimers
  (testnet launcher, provider desk, allocation desk), but not in the
  always-visible nav shell anymore.
- **Suggested replacement:** Worth a deliberate check against "chain IDs
  must never be softened or removed" — confirm this is an acceptable
  tradeoff rather than an accidental side effect of the nav-flag change.

### 13. Subscriber tier labels don't match the plan names shown to users

- **Location:** `components/admin-subscribers-section.tsx:31-32` vs.
  `lib/launch-paths.ts:23,30`.
- **Current text:** Admin: "Bond+Site", "Bond+Pro Site" (no spaces around
  `+`). Path chooser / marketing: "Bond + Site", "Bond + Pro Site"
  (spaced).
- **Problem:** Small, easy-to-fix, directly inconsistent.
- **Suggested replacement:** Match the spaced format everywhere.

### 14. A few genuinely bare labels, and inconsistent close-button accessibility

- **Location:** "Continue" (`hoodlums-welcome-modal.tsx:166`); bare `"×"`
  close buttons with no `aria-label` at `token-studio.tsx:781,809`, versus
  `wallet-provider-selector.tsx:281`, which does add one for the same kind
  of control.
- **Problem:** "Continue" alone doesn't say what happens (minor here since
  context is clear from the modal, but still the audit's own no-bare-verbs
  rule); the accessibility gap is a real, fixable inconsistency.
- **Suggested replacement:** Add `aria-label="Close"` (or similar)
  everywhere a bare "×" button appears.

### 15. Buy-flow copy in the provider desk focuses on custody safety but never states investment risk

- **Location:** `components/provider-launcher.tsx` — "BUY TOKEN",
  "OPEN {PROVIDER} & BUY {amount} ETH ↗", "Before signing — Confirm chain
  ID 46630, launch fee, creator buy, slippage, wallet and every approval."
- **Problem:** This is a real financial action (opening an actual buy flow
  with test ETH). The existing disclaimers cover wallet/custody safety
  well but never carry a "not financial advice" framing the way the
  published-site footer and trending panel do elsewhere in the app.
- **Suggested replacement:** Not a strict violation (nothing was removed —
  it may just never have been added here), but worth adding the same
  disclaimer pattern already used well elsewhere in the app.

---

## P3 — Tone/polish, nice to have

### 16. Empty-state voice is inconsistent

- **Location:** `hoodlums-token-grid.tsx:53-54` ("No Hoodlums tokens on
  the curve yet. Be the first — create a token and open its bonding
  market.") vs. `token-studio.tsx:784` ("No saved projects yet.").
- **Problem:** The token grid's empty states are genuinely on-brand and
  confident; the studio's saved-projects empty state is flatly generic by
  comparison.
- **Suggested replacement:** Bring the flatter ones up to the grid's
  standard rather than the reverse.

### 17. "Coming next" vs. "Coming soon" for the same not-built-yet state

- **Location:** `app/(app)/account/page.tsx:105,125` ("Coming next") vs.
  `components/robinhood-trending-panel.tsx:84,102` and the published-site
  template's `BUY_PENDING`/`CONTRACT_PENDING`/`CHART_UNKNOWN` blocks
  ("Coming soon").
- **Suggested replacement:** Pick one term and use it everywhere.

### 18. Two disclaimers worth using as the house template, not the exception

- **Location:** `robinhood-trending-panel.tsx:142-144` — "External market
  data via Dexscreener. Not Hoodlums launches. Not financial advice.
  Refreshes every 60s."; `docs/free-site-template-source.html:788` —
  "{{TOKEN_NAME}} is a meme coin with no intrinsic value. Not financial
  advice. DYOR."
- **Note:** These are exactly the tone the brief asks for — dark,
  confident, crypto-native, and legally clear without being corporate.
  Worth explicitly reusing this pattern (short, plain, on-brand,
  unambiguous) anywhere else in the app a disclaimer is needed, rather
  than treating these two as one-offs.

---

## 7. The path chooser (`components/token-path-chooser.tsx`, `lib/launch-paths.ts`)

- **Plan ladder is clear and logically ordered:** Bond → Bond + Site →
  Bond + Pro Site → Pro, each visibly building on the last ("Everything in
  Bond", "Everything in Bond + Site"). No issue.
- **"Recommended" badge on Bond + Site makes sense** — it's free and adds
  the most visible, immediate value (a real generated website) over bare
  Bond. No issue.
- **Pro's feature bullets describe capabilities that don't exist in the
  codebase yet:** "Telegram buy bot", "X account AI posting", "Holder
  analytics dashboard" — confirmed by search: no Telegram-buy-bot code, no
  live X-auto-posting implementation (a research/spec document exists for
  this, but no implementation), no holder-analytics-dashboard route. This
  is the same "advertises unbuilt functionality" problem as finding #3,
  now on the highest-priced tier. **Fold into P1 alongside #1** — a paid
  tier promising features that don't exist is a more serious version of
  the same issue.
- **Pricing formats aren't visually consistent:** "Free" / "~$10 in ETH ·
  one-off" / "$30/month · USDT" — three different formats and currencies
  shown side by side with no shared visual pattern (P3, minor).

## 8. The admin dashboard

- Beyond the "Money"/"Issues" naming already covered in finding #11, the
  admin dashboard is genuinely well executed: the Pages CMS's draft →
  publish language is consistent and clear throughout
  (`admin-pages-section.tsx`), the service-isolation copy explicitly says
  what can and can't be isolated and why ("Database, deployment and admin
  authentication are monitoring-only here and cannot be disabled,
  preventing an accidental lockout" — exactly the kind of specific,
  operator-useful copy this audit is looking for), and the Subscribers
  section states its own limits plainly ("Read-only; no payment controls
  here").
- **One open item, not a confirmed issue:** System Health's per-check
  `message` field is server-generated and wasn't independently audited in
  this pass for the same raw-error pattern found on the client side
  (finding #5). Worth a follow-up check of `lib/server/admin-operations.ts`
  and the health-check implementations specifically.

---

## Priority order

**P1 — fix before launch**
1. Paid plans collect no payment (finding #1, and Pro's unbuilt-feature
   bullets from §7)
2. Terms/Privacy referenced but nonexistent and unlinked (#2)
3. "5 design variants" advertises a reverted feature (#3)
4. NOXA presented as a live provider; it's defunct (#4)
5. Raw exception messages shown to users, systemic (#5)
6. Developer-only Remix/Solidity instructions in Liquidity Lab (#6)
7. Leftover dev framing ("this first commit") and bare "Something went
   wrong." (#7)
8. Broken empty state: Supply can render blank (#8)

**P2 — fix soon**
9. Five names for one core action (#9)
10. Duplicate error strings drifting independently (#10)
11. Ambiguous admin section names "Money"/"Issues" (#11)
12. Testnet indicator hidden from main nav by default (#12)
13. "Bond+Site" vs. "Bond + Site" spacing mismatch (#13)
14. Bare "Continue" and inconsistent close-button accessibility (#14)
15. Provider buy-flow missing investment-risk framing (#15)

**P3 — polish**
16. Inconsistent empty-state voice (#16)
17. "Coming next" vs. "Coming soon" (#17)
18. Reuse the trending-panel/published-site disclaimer pattern more
    broadly (#18)
19. Path-chooser pricing format inconsistency (§7)
