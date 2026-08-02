# Token page & swap integration — research and planning

Research and planning only, per request — no code changes. Grounded against
`contracts/HoodlumsTestBondingCurve.sol`, `contracts/HoodlumsTestLiquidityPool.sol`,
and the current state of `main` (commit `b7bdac1`) in
`tyroneblakestewart-dot/launch-pad`, which already includes more relevant
groundwork than this task's brief assumed — see §0 and the "Existing
groundwork" section before reading Parts 1–3, so nothing here gets
duplicated or contradicted by the UI work in progress.

---

## 0. Flag this first: a live bug matches exactly what this research was asked to check

`lib/trade-terminal-links.ts` (merged via PR #206, referencing "issue
#203's research") already builds referral-coded "Trade on GMGN / Axiom /
Maestro / Ave.ai" buttons, rendered today by `components/token-trade-buttons.tsx`
on `app/token/[chain]/[address]/page.tsx`. All four terminal entries declare
`chains: ["robinhood"]`. But `lib/chains.ts`'s `CHAIN_CONFIG.robinhood`
resolves to **Robinhood Chain *Testnet*** — its `explorerBaseUrl` is
`https://explorer.testnet.chain.robinhood.com/address/`, chain ID `46630`.

Per a separate, later verification pass against each platform's official
docs (summarized in §1 of Part 2 below and not repeated in full here): none
of GMGN, Axiom, Maestro, or Ave.ai have any presence on chain `46630`. Every
one of their confirmed Robinhood Chain integrations is on **mainnet**
(chain ID `4663`), a different chain. So right now, on `main`, a visitor to
any `/token/robinhood/{address}` page sees four live "Trade on X ↗" buttons
that, for a genuinely testnet-only token, send them to a terminal that has
never heard of that chain. This isn't a future risk to plan around — it's
already shipped. Flagging it here since it's the single most concrete,
actionable finding in this whole research pass; fixing it is a follow-up
task, not part of this research-only deliverable.

(To be fair to whoever built this: the "issue #203 research" it cites likely
predates the follow-up verification pass that caught the mainnet/testnet
distinction — the two research passes happened in separate sessions, and
this is exactly the kind of gap that falls through when they don't cross-reference.)

---

## Part 1 — Swap integration research

### 1.1 Calling `buy()` — exact steps, straight from the contract

Read directly from `contracts/HoodlumsTestBondingCurve.sol`:

```solidity
function buy(uint256 minTokensOut, uint256 deadline)
    external payable nonReentrant tradingOpen beforeDeadline(deadline)
    returns (uint256 tokensOut)
```

**`buy()` requires no token approval — it's a straight native-currency send.**
The function is `payable`; it takes ETH as `msg.value` and pushes the
purchased tokens *out* to the buyer via `token.safeTransfer(msg.sender, tokensOut)`.
There is no `transferFrom` on the buy path, so there's nothing for a buyer
to approve.

Exact browser-wallet flow:
1. **Connect wallet** (MetaMask/Rabby), confirm chain is Robinhood Chain
   Testnet (`46630`) — the contract itself doesn't check chain ID (that's
   enforced by the wallet/dapp, same pattern already used by
   `components/testnet-launcher.tsx` for the factory).
2. **Get a quote** — call the free `quoteBuy(grossNativeIn)` view function
   (or `quoteBuyFee` for just the fee) to show the expected `tokensOut`
   before the user commits to anything. No wallet interaction needed for this.
3. **Compute `minTokensOut`** from the quote minus the user's slippage
   tolerance (e.g., quote × (1 − tolerance%)).
4. **Compute `deadline`** — current time + a few minutes.
5. **Call `buy(minTokensOut, deadline)`** with `value: grossNativeIn` (wei).
   This is the *only* wallet confirmation in the whole flow.
6. Wallet shows the ETH value + gas estimate; user confirms; transaction
   mines; `TokensPurchased` event fires; UI reflects the new token balance.

**Two behaviors to design the panel around, both enforced on-chain, not just
suggested:**
- If the net (post-fee) input would push `realNativeReserve` past
  `graduationTarget`, the call reverts with `BuyExceedsGraduationTarget`
  — it does **not** partially fill and refund the rest. The panel needs to
  cap the max buy input at the remaining amount to graduate (readable via
  `remainingNativeToGraduate()`) and communicate that cap, rather than
  letting a user submit a doomed transaction.
- A buy whose net input lands `realNativeReserve` **exactly** on
  `graduationTarget` triggers `_graduate()` inline, in the same
  transaction, atomically. The panel should be able to tell the user
  "this trade will graduate the token" when their input would hit that
  exact remaining amount.

### 1.2 Calling `sell()` — this one *does* need an approval first

```solidity
function sell(uint256 tokensIn, uint256 minNativeOut, uint256 deadline)
    external nonReentrant tradingOpen beforeDeadline(deadline)
    returns (uint256 nativeOut)
```

Unlike `buy()`, `sell()` pulls tokens *from* the seller via
`token.safeTransferFrom(msg.sender, address(this), tokensIn)` — standard
ERC-20 behavior, which means the seller must have approved the bonding
curve contract to move `tokensIn` (or more) first. This is the same
two-transaction shape as any Uniswap-style token→ETH swap:

1. Connect wallet, confirm chain.
2. Check current allowance: `token.allowance(seller, curveAddress)`.
3. If allowance is insufficient, call `token.approve(curveAddress, tokensIn)`
   — **wallet confirmation #1.** (Standard UX choice to make explicitly:
   approve the exact amount each time, or approve `type(uint256).max` once
   so future sells skip this step — a real UX/security tradeoff worth a
   deliberate call, not a default.)
4. Get a quote via `quoteSell(tokensIn)`, compute `minNativeOut` with
   slippage tolerance.
5. Call `sell(tokensIn, minNativeOut, deadline)` — **wallet confirmation #2.**
6. Tokens move to the curve, native ETH moves to the seller.

**So: buy = 1 wallet confirmation, sell = 2 (unless a prior max-approval
already covers it).** This asymmetry is worth calling out explicitly in
whatever UX copy or loading-state design the swap panel gets, since users
coming from single-click "ape in" flows on other platforms may be confused
by the extra step on the way out.

### 1.3 What happens post-graduation, and where the panel should point users

This is the part of the research that changes the shape of Part 3, so it's
worth being precise about what `_graduate()` actually does (not what a
"bonding curve graduation" does on other platforms):

```solidity
function _graduate() internal {
    ...
    HoodlumsTestLiquidityPool pool = new HoodlumsTestLiquidityPool(address(token));
    liquidityPool = address(pool);
    token.forceApprove(address(pool), tokenLiquidity);
    pool.addLiquidity{value: nativeLiquidity}(tokenLiquidity, tokenLiquidity, nativeLiquidity, 0, block.timestamp);
    ...
    uint256 lpLocked = pool.balanceOf(address(this));
    if (lpLocked == 0 || !pool.transfer(LP_LOCK_ADDRESS, lpLocked)) revert LiquidityLockFailed();
    ...
}
```

**Graduation deploys a brand-new instance of `HoodlumsTestLiquidityPool`
(a bespoke, from-scratch constant-product AMM Hoodlums wrote itself),
seeds it with the curve's full remaining token balance and native reserve,
and sends 100% of the resulting LP tokens to `address(1)` — a real,
verifiable, permanently-unrecoverable address (not the standard `address(0)`
burn address, notably; `address(1)` specifically). It does not add liquidity
to Uniswap, or to any other existing DEX, at all.**

Reading `HoodlumsTestLiquidityPool.sol` itself: it's a genuine, if minimal,
Uniswap-V2-style xy=k pool — `swapExactEthForTokens` / `swapExactTokensForEth`,
a 0.3% swap fee (`FEE_BPS = 30`), `addLiquidity`/`removeLiquidity`, its own
ERC-20-like LP token (`HTLP`). It's a real, working AMM. But it's **entirely
self-contained and Hoodlums-specific** — it doesn't implement the Uniswap V2
factory/pair interface, its `Swap`/`Sync` events aren't the standard Uniswap
V2 event signatures, and nothing about it registers the pool with any
external DEX aggregator or router.

**Practical consequence: post-graduation, on the current contract design,
Dexscreener will not find this pool, and none of GMGN/Axiom/Maestro/Ave.ai
will route a trade through it, because none of them know it exists.** A
graduated Hoodlums token's only tradeable venue is whatever swap UI Hoodlums
itself builds against that specific `HoodlumsTestLiquidityPool` instance's
`swapExactEthForTokens`/`swapExactTokensForEth` functions. This is explored
further, with a competitive comparison, in Part 3.

For now, concretely: **where should the panel point post-graduation?**
Given the above, "point users to a DEX" isn't currently a real option for a
graduated Hoodlums token — there's no DEX indexing it. The panel's only
correct move today is to detect `graduated == true` (already read by
`components/bonding-curve-graduation-status.tsx`, which exposes
`liquidityPool`), and swap its own buy/sell calls over to that pool's
`swapExactEthForTokens`/`swapExactTokensForEth` instead of the curve's
`buy()`/`sell()` — both revert post-graduation via the `tradingOpen`
modifier's `graduated` check, so the panel must switch targets, not just
disable itself.

### 1.4 Risks worth surfacing in the UI

- **Price impact.** The curve is a virtual-reserve constant-product curve
  (`tokensOut = netIn × virtualTokenReserve / (virtualEthReserve + netIn)`),
  same shape as any xy=k AMM — larger buys move the price more, especially
  early when reserves are smallest relative to trade size. The panel should
  show price impact (expected price before vs. after the trade) per input
  size, not just the final quote.
- **Slippage.** `minTokensOut`/`minNativeOut` are hard on-chain floors — if
  the quote moves between fetch and mine time, the whole transaction
  reverts (`SlippageExceeded`) rather than filling at a worse price. That's
  investor-protective, but it means a slippage tolerance that's too tight
  causes frequent failed transactions (wasted gas) in an active market, and
  one that's too loose exposes the trader to a materially worse fill. This
  needs a visible, adjustable slippage setting with sane defaults, not a
  hardcoded constant.
- **Front-running / MEV — genuinely different here than on most EVM chains,
  worth getting right rather than copy-pasting generic Ethereum MEV
  warnings.** Robinhood Chain runs on the Arbitrum Orbit stack with a
  single Robinhood-operated sequencer that orders transactions by arrival
  time, not by gas-price auction — **there is no public mempool** in the
  traditional sense a bot can watch to front-run a pending trade. Classic
  priority-gas-auction sandwich attacks (the dominant Ethereum L1 MEV
  pattern) don't have their usual lever here, since outbidding doesn't move
  a transaction earlier in the queue. That said, this isn't a zero-MEV
  guarantee: (a) a party with privileged, low-latency access to the
  sequencer's own transaction feed (there's tooling in the wild for
  decoding it — see sources) could in principle still react to a pending
  trade before it's broadly visible, a softer, feed-latency-based edge
  rather than classic front-running; and (b) whether Robinhood ever adopts
  Arbitrum's Timeboost (a paid-priority-ordering auction) is an open
  question noted by outside analysts — if adopted, that would reintroduce
  a real ordering-based MEV lever. Fair summary for UI copy: "front-running
  risk is lower here than on most EVM chains because there's no public
  mempool, but slippage protection still matters — set it deliberately."
- **Not a risk, but worth stating plainly since it's a genuine structural
  positive:** because CLAUDE.md's standing rule 6 requires the complete
  token supply to enter the curve with no creator-held launch allocation,
  there's no hidden creator bag that can be dumped into buyers — a
  structural difference from launchpads that allow a "dev buy" (see Pons,
  Part 2). Worth surfacing as reassurance copy near the swap panel, not
  just an internal design note.

---

## Part 2 — Pons competitor analysis

### 2.1 How Pons's token page and swap mechanic actually work

**The most important structural fact: Pons does not use a separate bonding-curve
contract that later migrates liquidity anywhere.** Per Pons's own
documentation and multiple independent write-ups: each token and its WETH
pool are deployed **in one transaction**, directly into a **Uniswap V3**
position (V2 launched with V3 pools; a V2-of-the-platform upgrade to route
through Uniswap V4 was announced mid-2026). Liquidity is locked
automatically and the token is tradeable immediately — there's no discrete
"graduation" event that moves the pool to a different contract.

What still gets called "graduation" in their UI is different from
Hoodlums's meaning: the pool starts as a **single-sided** Uniswap V3
position (only the token side seeded), and the concentrated-liquidity math
of a single-sided V3 position naturally produces a bonding-curve-shaped
price action as buyers add WETH to the pool. "Graduating" is the pool's WETH
side crossing a threshold (reported as 4.2 ETH) — a milestone *inside* the
same continuously-tradeable Uniswap V3 pool, not a migration to a new one.
This is a real, non-trivial technique (using a real DEX's own concentrated
liquidity as the curve, instead of a bespoke virtual-reserve contract) — and
it's the direct reason Pons tokens are visible on Dexscreener, GMGN, and
every other terminal from block one: they're real Uniswap V3 pools the
entire time, never anything bespoke.

Their creation form collects: token name, ticker, description, image,
social links, website, creator wallet, and an **optional developer
purchase** (a creator-side pre-buy at launch) — a direct contrast to
Hoodlums's no-creator-allocation rule, discussed in §2.3. Reported
mechanics: a 0.0005 ETH launch fee, non-custodial (Pons never holds user
funds or keys), every action wallet-approved.

Token page elements found in third-party coverage: live price chart
(sourced from GeckoTerminal/Dexscreener-style feeds, since it's a real
Uniswap pool), contract address, a graduation progress indicator, and
trade inputs showing price impact, slippage, and the final expected amount
— broadly the same category of information this research's Part 1 already
recommends for Hoodlums's own panel.

**Liquidity source:** entirely Uniswap V3 (and soon V4), on Robinhood Chain
mainnet. Nothing bespoke.

### 2.2 Revenue/scale figures — reconcile with care

The figures given in this task ($1.67B all-time volume, 238K launches,
$2.63M protocol revenue) weren't independently reproduced verbatim in this
research pass — they read as plausible current numbers pulled directly off
ponsfamily.com, which is the right source to trust for a live, fast-moving
counter like this. What this research did independently find, from
DefiLlama and press coverage, for context/cross-checking rather than
correction:
- ~$15.24M in fees over a trailing 30-day window, ~$4.14M of that as
  protocol revenue; annualized from that window, ~$292.72M fees / ~$79.61M
  revenue.
- Pons had captured roughly 69% of daily token deployments on Robinhood
  Chain as of late July 2026.
- **100% of protocol fees to PONS token holders** is consistent with what
  this task states; a separate "PonsShare" product routes *creator* fees
  (a different pool from protocol fees) to a creator's X account.

These numbers move fast and different sources define "revenue" differently
(gross fees vs. net protocol take vs. trailing-30-day vs. all-time), so
treat the ponsfamily.com live figures as ground truth and this research's
numbers as directional color, not a correction.

**One more piece of market context worth knowing:** NOXA, Robinhood
Chain's other major direct-to-Uniswap-V3 launchpad (60,000+ tokens, ~75%
of deployments at its peak, ~$12M in fees), **shut down on July 11, 2026**
after a flood of botted copycat-token spam overwhelmed its infrastructure,
compounded by a domain-registrar issue that left the team locked out of
their own site. This is effectively why Pons is now the dominant player
rather than one of several. It's also a concrete, chain-specific cautionary
tale: bot/copycat-token spam is a proven failure mode on this exact chain,
not a hypothetical one, and is worth designing against deliberately
(rate-limiting or anti-spam measures on token creation) rather than
assuming it won't recur.

### 2.3 What Hoodlums does differently or better — grounded in real structural differences, not just marketing

- **No creator pre-buy / no hidden allocation.** Pons explicitly offers an
  "optional developer purchase" at launch. CLAUDE.md's standing rule 6
  requires the entire token supply to enter Hoodlums's curve before trading
  opens, with no unlocked creator allocation — structurally impossible for
  a creator to dump a hidden bag on buyers. This is a real, verifiable
  difference worth emphasizing directly, not just a vague "we're safer"
  claim.
- **Pull-payment fees, immune to a griefing recipient.** Hoodlums's fee
  design (`treasuryFeeBalance`/`creatorFeeBalance`, claimed via
  `withdrawFees()`) means a reverting or malicious treasury/creator address
  can never block a trade, another party's withdrawal, or graduation
  itself. Whether Pons's fee-routing has the same property isn't confirmed
  either way in this research pass — worth checking their docs before
  claiming superiority here specifically, rather than asserting it.
- **Testnet-first, explicit safety posture.** Hoodlums is deliberately
  non-custodial and testnet-first with documented chain-ID guards; this is
  a genuine trust/transparency difference from a platform running real
  money from day one, though it's also currently a real limitation (see
  §0 and Part 3) rather than a pure advantage — the honest framing is
  "safer to build and test on, not yet a live revenue competitor."
- **What Hoodlums does *not* yet do that Pons does:** launch directly into
  a real, externally-indexed DEX pool. This is the gap that matters most
  competitively, and it's covered in depth in Part 3 — worth not
  soft-pedaling it here.

### 2.4 Public API or on-chain data source for Pons's tokens

Two real options found, not mutually exclusive:

1. **An official Pons partner API exists.** `docs.ponsfamily.com` documents
   `POST https://api.ponsfamily.com/v1/flywheels` (Pons calls each token
   deployment a "flywheel") for deploying tokens programmatically, and
   `GET /v1/flywheels/{id}` for polling deployment status
   (pending/confirmed/active). Access requires an API key, available to
   "integration partners" by contacting `contact@ponsfamily.com` — not
   self-serve, but their own docs specifically mention supporting
   "those indexing launches, deriving prices, wiring trades, or verifying
   onchain state," which is close to exactly what a Hoodlums third-party
   row would want. **Reaching out to request partner API access is a
   real, concrete option worth pursuing directly**, rather than
   reverse-engineering on-chain data.
2. **On-chain indexing is also viable**, since every Pons launch goes
   through a specific factory contract. Reported addresses (found via
   search, **not independently verified against a block explorer — treat
   every address below as needing on-chain confirmation before any
   implementation, since a single wrong character makes it a different,
   likely non-existent contract**):
   - Active factory: `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` (start block 8,991,118)
   - Legacy factory: `0x0c37a24F5D23A486FA692d1500881d698B1F77a4`
   - V3 factory: `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`
   - Position manager / swap router / Quoter V2 addresses were also
     reported, consistent with Pons wrapping standard Uniswap V3 periphery
     contracts rather than writing its own.
   
   If confirmed, watching this factory's deployment events would give
   Hoodlums a self-serve, no-permission-needed feed of every new Pons
   token, independent of whether the partner API request is granted.

Given both paths exist, the pragmatic recommendation is to pursue both in
parallel: email `contact@ponsfamily.com` for partner API access (best data
quality, official support) while separately verifying the factory address
as a fallback/backup source that doesn't depend on Pons's goodwill.

---

## Part 3 — Post-graduation DEX

### 3.1 What DEX options actually exist on Robinhood Chain mainnet (4663)

This one has an unusually clean answer: **Uniswap is not just "an option,"
it's essentially the entire DEX landscape on Robinhood Chain mainnet.**
Uniswap v2, v3, v4, and UniswapX all went live on Robinhood Chain mainnet
from day one (July 1, 2026), alongside a Chainlink price oracle — reported
directly on Uniswap's own blog as a headline integration, not a minor
listing. Both major launchpads on the chain (Pons, and the now-shut-down
NOXA) built directly on top of Uniswap V3 rather than writing or adopting
any alternative DEX engine. No other independently-corroborated DEX was
found in this research pass; a "DYORSWAPDEX" name surfaced in an earlier,
separate research pass on trading-terminal DEX coverage but wasn't
corroborated here and shouldn't be relied on without direct verification.

**Practical reading: for a mainnet-facing graduation design, "which DEX"
isn't really an open question — it's Uniswap (almost certainly V3 or V4
given the ecosystem's default), the same choice every other serious
launchpad on this chain has already made.**

### 3.2 Build a custom AMM UI on the locked pool, or route through Uniswap — which is actually better?

This question has two layers that are easy to conflate: **what the pool
itself is** (a protocol-level decision — how graduation seeds liquidity)
versus **what UI trades against it** (an application-level decision). The
research changes the shape of the second question depending on the answer
to the first:

**If graduation keeps deploying Hoodlums's own bespoke pool** (as the
current `HoodlumsTestLiquidityPool` contract does): building a simple
custom swap UI against it isn't just feasible, it's the *only* option —
there is no external DEX or aggregator that will ever discover this pool
on its own, so "route through an existing DEX" isn't actually available as
a choice here. The tradeoff is real and worth naming plainly: Hoodlums
would own 100% of the trading UX and fee capture forever, but graduated
tokens stay permanently invisible to Dexscreener, GMGN, Axiom, Maestro,
Ave.ai, and every other tool this and the prior research session covered
— none of that ecosystem, or its referral revenue, would ever apply to a
graduated Hoodlums token.

**If graduation instead seeds a real Uniswap pool** (matching what both
Pons and the former NOXA do): "build a custom AMM UI" stops being
necessary at all — any Uniswap-compatible frontend, chart, or terminal
already knows how to trade against it, for free, with no Hoodlums-side
swap UI work beyond linking out (exactly the trade-button pattern already
built in §0's `lib/trade-terminal-links.ts`, minus its current chain-ID
bug). This is a smaller, cheaper engineering lift than maintaining a
bespoke swap UI, and it's the path that makes graduated tokens visible on
Dexscreener and eligible for the referral programs already researched.
The real cost isn't UI work, it's a **contract-level redesign**: either
have `_graduate()` add liquidity into a live Uniswap pool instead of
deploying `HoodlumsTestLiquidityPool`, or move to a Pons/NOXA-style
single-sided-Uniswap-position model from the start (no separate bonding
curve at all) — either is a materially different contract design from what
exists today, not a UI-layer change.

**Recommendation, framed as a decision for the owner, not a foregone
conclusion (this is squarely a "contract economics/design are owner
decisions" call per CLAUDE.md rule 6, and any of this is inherently a
mainnet-facing design question, which rule 3 requires an explicit owner
request to pursue at all):** given that literally every serious competitor
on this specific chain has already converged on "launch directly into a
real Uniswap pool, no separate bonding-curve migration," and given that
doing the same is what makes Hoodlums tokens compatible with Dexscreener
charts and the referral-earning trade buttons already built, this is worth
a deliberate, explicit conversation before any mainnet path is pursued —
not a default "we'll figure it out later." The current testnet-only
bespoke-pool design is fine to keep exactly as-is for continued testnet
proof-of-concept work; it's specifically the "what does mainnet graduation
look like" question that has a real, current, well-evidenced answer:
match what the rest of the chain already does.

### 3.3 Restating the core tension plainly

Hoodlums's current bonding-curve-then-bespoke-pool design and the
"trade buttons + Dexscreener chart + holder stats" token page work already
shipped (§0, and the prior research session's spec) are, as currently
architected, **pulling in different directions**: the trade buttons and
chart infrastructure assume tokens live on real, externally-indexed DEX
pools, while the bonding curve's own graduation path deliberately does
not produce one. This isn't a bug in either piece individually — it's a
gap between two pieces of work that haven't yet been reconciled, and it's
worth resolving explicitly (which direction graduation should point)
before more UI work goes into a swap panel whose target contract's
production shape is still an open question.

---

## Existing groundwork already in the codebase (don't duplicate)

So the parallel token-page-UI work in progress doesn't rebuild any of this
from scratch:
- `lib/bonding-curve-config.ts` / `components/bonding-curve-graduation-status.tsx`
  — read-only curve state (funded/bonding/graduated, progress, locked pool
  address), no wallet needed, already live on `/bonding-curve`. No buy/sell
  wired yet — this research's Part 1 is exactly the next step for that.
- `lib/bonding-curve-fee-math.ts` — an off-chain reimplementation of the
  contract's exact fee rounding, currently only used by an owner-run
  graduation drill script, but directly reusable for the swap panel's
  quote-preview math.
- `app/token/[chain]/[address]/page.tsx`, `lib/trade-terminal-links.ts`,
  `components/token-trade-buttons.tsx`, `lib/server/token-holders.ts` — the
  zero-friction third-party token page from the prior research session's
  spec, already built. Contains the chain-ID bug flagged in §0.
- `lib/server/token-holders.ts` already excludes the LP pool address from
  the top-holders list (the exact pitfall flagged in the prior research
  session's spec) — good, already done correctly.
- A design reference for the token page UI exists in the repo (committed at
  the repo root as `hoodlums-token-page.html` — note the commit message
  says `public/design-refs/hoodlums-token-page.html`, but that's not where
  it actually landed; worth a quick look before assuming its location).
  It's a compiled/bundled export rather than plain readable HTML, so this
  research pass didn't inspect its contents in detail.

---

## Open questions for the owner

1. **Fix the chain-ID mismatch in `lib/trade-terminal-links.ts`** (§0) —
   not really "open," more a "this needs a decision on priority": ship a
   quick fix now (e.g., only show those four buttons once a token has
   graduated to a real mainnet-visible pool, or hide them entirely for
   testnet tokens), or accept the current broken state until the bigger
   Part 3 design question resolves it structurally.
2. **What should mainnet graduation actually deploy into** — keep the
   bespoke pool (full control, zero external visibility) or match
   Pons/NOXA's direct-to-Uniswap model (external visibility, referral
   revenue, chart compatibility, but a real contract redesign)? This is
   the highest-leverage open question in this whole document.
3. Given rule 3's testnet-first posture, is it time to scope a deliberate,
   explicit mainnet path at all, or is that still premature? Everything in
   Part 3 is inherently mainnet-facing.
4. Should Hoodlums pursue Pons's partner API (`contact@ponsfamily.com`) for
   the third-party row, independently verify their factory address for
   on-chain indexing, or both in parallel (this research's recommendation)?
5. For the sell-flow approval step (§1.2): approve-exact-amount each time,
   or approve-max once? Real UX/security tradeoff, not just an implementation detail.

---

## Sources

- `contracts/HoodlumsTestBondingCurve.sol`, `contracts/HoodlumsTestLiquidityPool.sol` (this repo, read directly)
- `lib/trade-terminal-links.ts`, `lib/chains.ts`, `lib/server/token-holders.ts`, `app/token/[chain]/[address]/page.tsx`, `components/bonding-curve-graduation-status.tsx`, `lib/bonding-curve-config.ts`, `lib/bonding-curve-fee-math.ts` (this repo, read directly)
- [Pons docs](https://docs.ponsfamily.com/), [Pons launchpad](https://www.ponsfamily.com/launchpad), [Pons V2 / Uniswap V4 announcement — crypto.news](https://crypto.news/robinhood-chain-launchpad-pons-announces-v2-with-uniswap-v4-upgrade/)
- [Pons fees & revenue — DefiLlama](https://defillama.com/protocol/pons)
- [Pons.family runs more than half of Robinhood Chain's transactions — CryptoTimes](https://www.cryptotimes.io/2026/07/27/pons-family-now-runs-more-than-half-of-robinhood-chains-transactions/)
- [PONS Launchpad guide — Bitrue](https://www.bitrue.com/blog/what-is-pons-launchpad-pons-token)
- [PonsShare](https://www.ponsshare.com/)
- [NOXA goes dark after $12M in fees — CryptoTimes](https://www.cryptotimes.io/2026/07/18/noxa-goes-dark-after-12m-in-fees-exposing-robinhood-chains-single-point-of-failure/)
- [The launchpad that fueled Robinhood Chain's memecoin boom just gave away all its revenue — CoinDesk](https://www.coindesk.com/business/2026/07/15/the-launchpad-that-fueled-robinhood-chain-s-memecoin-boom-just-gave-away-all-its-revenue)
- [Uniswap is live on Robinhood Chain — Uniswap blog](https://blog.uniswap.org/robinhood-chain-is-live)
- [Who is the biggest winner of the Robinhood Chain launch? Uniswap, but not really... — OAK Research](https://oakresearch.io/en/analyses/investigations/who-is-biggest-winner-robinhood-chain-launch-uniswap-but-not-really)
- [How Robinhood Chain works: consensus, sequencer, rollup — Bitrue](https://www.bitrue.com/blog/how-robinhood-chain-works-consensus-sequencer-rollup)
- [Robinhood built its own chain, it still pays rent — crypto.news](https://crypto.news/robinhood-chain-arbitrum-revenue-share/) (Arbitrum Orbit / revenue-share context)
- [Robinhood Chain sequencer feed decoder — GitHub](https://github.com/chainstacklabs/robinhood-chain-sequencer-feed) (evidence a sequencer-feed-latency channel exists, distinct from a public mempool)
- Robinhood Chain mainnet (`4663`) vs. testnet (`46630`) chain IDs: carried forward from the prior research session's verification (The Graph's Robinhood Chain Mainnet docs, Chainlist's testnet listing, Robinhood's own chain docs)
