# AI X (Twitter) posting behaviour — research and spec (Pro subscribers)

Research and planning only, no code. Written to be detailed enough for a
developer to implement from this document alone, per request. Grounded
against what already exists in `tyroneblakestewart-dot/launch-pad`
(`components/social-hub.tsx`, the existing `/admin` dashboard, and the
house conventions in `lib/free-site-openai-pipeline.ts`) and against
current X (Twitter) platform rules and AI image-consistency practice.

## 0. Grounding: what already exists, and what's genuinely new here

Read `components/social-hub.tsx` before anything else in this spec — it's
the existing `/social` route, and this feature extends it rather than
replacing it:

- **Posting today is manual by design, not automated.** X posting opens
  `https://x.com/intent/post?text=...` in a new tab — a human reviews the
  pre-filled composer and clicks Post themselves. Telegram posting calls
  `/api/social/telegram` directly with a bot token the user pastes in and
  that is never stored. The component's own footer text says it plainly:
  *"This version does not create social accounts, solve captchas, store
  passwords or schedule background posts. Full one-click X API publishing
  requires an X Developer application, OAuth authorization and encrypted
  server-side token storage."* **This spec is that next step** — it
  requires genuinely new infrastructure, not a UI addition on top of what
  exists.
- **`/admin` already exists** (see `README.md`'s "Admin dashboard"
  section) — wallet-signed or password-based session auth, a System Health
  panel, and a Pages CMS with an explicit **draft → publish** pattern. The
  approval workflow in Part 4 should be a new section inside this existing
  dashboard, reusing its session/auth model and mirroring its
  draft-then-publish pattern, not a new standalone admin surface.
- **"Pro subscriber" is a new concept.** Nothing in the codebase or
  `CLAUDE.md` currently defines a paid tier, billing, or feature-gating
  mechanism. This spec assumes a "Pro" flag exists on a project/account and
  gates this entire feature behind it, but **defining what Pro means,
  what it costs, and how it's enforced is a prerequisite decision for the
  owner, not something this spec invents.**
- **Two hard external constraints, found in this research, shape almost
  everything below** — read these before designing anything else:
  1. X's automation policy requires **all automated posting to go through
     the official X API** — screen scraping and browser automation (which
     is closer to what `/social` does today) are explicitly prohibited for
     anything that posts *without* a human clicking the final button. Any
     genuinely scheduled/triggered auto-posting needs a real X Developer
     App, OAuth, and (for meaningful volume) a paid API tier.
  2. **Deploying or operating any AI-generated reply bot requires prior,
     explicit, written approval from X — a separate process from normal
     API access**, not something granted through the standard developer
     portal signup. This directly affects the "replies to mentions"
     category in Part 3 — treat it as a phase-2 capability pending X's
     approval, not an MVP feature.

---

## Part 1 — Style learning from examples

### How the extraction should work technically

Don't feed raw pasted examples straight into a generation prompt as the
only mechanism — that's fragile (the model tends to over-fit to whichever
example is most recent or most stylistically extreme) and gives the owner
nothing to inspect or correct. Instead, use a two-stage pipeline, mirroring
the structured-output pattern this codebase already uses in
`lib/free-site-openai-pipeline.ts` (a single model call constrained to a
strict JSON schema):

**Stage 1 — extraction call.** Send every pasted example to the model in
one call with instructions to *analyze*, not imitate, and return a
structured **voice profile** object, not prose. What it should extract and
store, matching the dimensions named in the task:

| Field | What it captures |
|---|---|
| `tone` | Where it sits on hype ↔ measured ↔ community-warm ↔ edgy — store as a labeled position, not just one word, since real accounts blend these |
| `vocabulary` | A short list of recurring words/phrases actually observed (not invented) — e.g. "wagmi," "fam," "no cap" — flagged separately from generic crypto-Twitter boilerplate so the profile captures what's *distinctive* about this voice |
| `cadence` | Short/punchy vs. longer storytelling; average post length; sentence rhythm (fragments vs. full sentences) |
| `emoji` | Density (emoji per post) and which specific emoji recur — a voice that uses 🚀🔥 constantly is different from one that uses 😂💀 |
| `hashtags` | Whether hashtags are used at all, how many, and whether they're placed inline or appended |
| `opener` | How posts typically start — GM posts, direct announcements, a question, a bold claim — store as a small set of observed opener patterns, not a single rule |
| `formality` | Casual ↔ formal, and whether capitalization/punctuation is deliberately dropped (a stylistic choice on crypto-Twitter, not sloppiness) |
| `signoff` | Whether posts end with a CTA, a link, a tag list, or just trail off |

**Stage 2 — store both the profile *and* a small curated few-shot set.**
Keep the structured profile as the primary steering input for every future
generation call (inspectable, editable by the owner, stable across many
generations), but also keep the 3–5 examples the model judged most
representative of the *resolved* voice as a literal few-shot supplement in
the generation prompt — profiles alone can miss "voice texture" (a
specific recurring joke format, a particular way of trailing off) that's
easier to transmit by literal example than by description.

### How to weight multiple examples when styles conflict

Don't silently average. Two concrete mechanisms:

1. **Let the owner label each pasted example** at paste time with where it
   came from: *"from our own account,"* *"a project I like,"* or *"just a
   post I liked."* Weight in that order — a project's own posting history,
   when it exists, should dominate the resolved voice; other people's posts
   are directional inspiration, not a script to imitate verbatim (imitating
   another specific account's voice too closely is also a real
   authenticity/plagiarism risk worth avoiding on principle, separate from
   the technical question).
2. **When examples genuinely conflict** (one is measured, another is
   unhinged-degen), the extraction call should not quietly split the
   difference — it should say so. Have Stage 1 also return a short
   `conflicts` field naming what it noticed ("example 2 is notably more
   aggressive than the others; resolved toward the majority tone") so the
   owner sees *why* the resolved profile landed where it did, and can
   correct it in one click rather than reverse-engineering a black box.

### How the system knows there's enough to be reliable

There's no magic threshold, but a concrete, buildable heuristic:

- **Minimum 5 examples** before "auto" (unattended) generation is offered
  at all; fewer than that, the feature works in "draft only, always
  reviewed" mode regardless of the owner's automation settings elsewhere.
- **A computed confidence signal**, not just a count. Ask the same
  extraction call to self-rate internal consistency across the submitted
  examples (do they actually sound like one voice, or several?) and surface
  it plainly as **low / medium / high**. Gate full-auto posting on at least
  *medium*.
- **A mandatory preview step regardless of confidence**: before a voice
  profile is used for anything live, generate 2–3 sample posts from it and
  show them to the owner with an explicit "does this sound right?"
  confirmation. This is cheap to build, catches extraction misses a
  numeric score won't, and gives the owner a concrete reason to trust (or
  fix) the profile before it starts writing on the project's behalf.
- **Treat extraction as incremental, not one-shot.** Every time new
  examples are added, re-run Stage 1 against the full accumulated set
  (previous examples + new ones) rather than only the new batch, so the
  profile keeps converging rather than drifting from one new example.

---

## Part 2 — Mascot/meme generation

### Source material

No new upload flow is needed — reuse the exact artwork already stored as
`TokenProject.heroImage` at token-creation time (the same field
`components/social-hub.tsx` already reads for the "download artwork"
action). This matters for the consistency approach below: there's
typically exactly **one** reference image per project, not a curated
photoset, which rules out some techniques and points clearly at others.

### What actually works for consistent character reproduction (2026 state of the art)

Three broad approaches exist; only one fits this product's real
constraints:

- **Reference-image-conditioned generation** — pass the actual mascot image
  into an image model's edit/reference input on every generation call,
  rather than describing the character in text alone. This is the
  dominant, most practical 2026 technique (Gemini's "Nano Banana," Grok's
  "Aurora," and OpenAI's current image-generation models all support
  direct reference-image conditioning) and it's the right fit here: it
  needs only the one image already on hand, no training step, and no extra
  upload flow.
- **LoRA fine-tuning** (training a small custom adapter on 10–20+ images of
  the character) produces the strongest long-run consistency, but needs an
  image count this product's typical project doesn't have. **Not
  recommended for v1** — flag it as a possible future upgrade only if the
  product later collects multiple reference images per project (e.g., if
  creators start uploading a small artwork set instead of one hero image).
- **Text-only description** ("a green cartoon frog with sunglasses...") is
  the weakest option and the one to explicitly avoid as the primary
  mechanism — it's well documented to drift character appearance
  generation-over-generation, exactly the failure mode this task asks to
  avoid.

### Concrete pipeline to avoid drift

1. **One-time, at Pro activation (or first meme request):** generate a
   small **reference sheet** from the single uploaded `heroImage` — 3–4
   variants (different angle/expression, same character) using the source
   image as the conditioning reference. Store this sheet alongside the
   original artwork.
2. **Every meme generation call after that** conditions on the *original*
   `heroImage` plus the stored reference sheet — never on a previously
   *generated* meme. This is the specific rule that prevents compounding
   drift: each generation should trace back to the one golden source, not
   chain off the last output, which is the well-known way these pipelines
   silently mutate a character over time.
3. Keep the reference sheet **static** once generated (don't regenerate it
   opportunistically) — it's a stability anchor, not something that should
   itself drift between meme requests.

### Meme formats that work for crypto communities on X

From current crypto-X practice, several concrete, repeatable formats worth
building as named templates (not an open-ended "generate something funny"
prompt, which is much harder to keep on-brand and on-tone):

- **Reaction-to-price-movement** — mascot's expression matched to the
  market moment (excited on a pump, dramatically distressed on a dip,
  played for humor either way — see guardrails in Part 5 on *never*
  implying financial meaning, only reacting to the vibe).
- **"FAFO"-style** — bold caption + dramatic framing, a currently popular
  crypto-Twitter format pairing strong text overlay with a chart or moment
  screenshot.
- **Milestone celebration** — mascot celebrating a graduation, a holder
  count, an anniversary.
- **GM (good morning) post** — wholesome, low-effort-to-produce, high
  posting-frequency format; a strong default for the "stay active without
  much to say" cadence gap.
- **Chart-reaction composite** — the mascot overlaid reacting to an actual
  Dexscreener chart screenshot (the platform already has Dexscreener pair
  data wired up per the earlier token-page work — this format is a natural
  fit, pulling a real chart image rather than a generic stock graphic).
- **Community in-joke / running-bit format** — a recurring visual gag
  specific to the project, reused deliberately over time rather than always
  novel, which is how real community mascots build recognizability.
- **Well-known meme-template substitution** (Drake format, distracted-boyfriend,
  etc., with the mascot substituted in) — effective and very shareable,
  but flag one caution: these are broadly treated as fair-use/parody in
  practice on crypto-Twitter, but it's still third-party template IP,
  worth the owner's awareness rather than treating it as risk-free.

### How the owner sets meme tone

A single tone dial per project (e.g., a labeled slider or preset: wholesome
↔ degen-humor ↔ aggressive/edgy), stored alongside the voice profile from
Part 1. Feed the same dial into **both** the text-caption generation and
the image-style guidance for memes, so captions and visuals don't drift
apart in tone from each other. This is the same directive mechanism Part 4
extends with a temporary "this week, be more X" override.

---

## Part 3 — What to post and when

| Category | Trigger | Data needed | Cadence guidance | Notes |
|---|---|---|---|---|
| **Milestone announcements** | Bonding-curve progress crossing a threshold (25/50/75/90%), graduation, holder-count milestones (100/500/1,000...) | On-chain curve state (same read pattern as `components/bonding-curve-graduation-status.tsx`) and holder data (same source as `lib/server/token-holders.ts`) | Event-triggered only, never scheduled; a cooldown per threshold so a value flapping near a boundary doesn't refire | High-confidence, low-risk category — good candidate for earlier full-auto trust |
| **Market moments** | Volume spike or price move past a magnitude threshold in a rolling window | Dexscreener pair data (`lib/server/dexscreener.ts`, already integrated) polled server-side | Threshold + dedup/cooldown window so a volatile hour doesn't fire five posts | Highest guardrail sensitivity — must read as observation/vibe, never prediction or advice (Part 5) |
| **Community posts — GM** | Scheduled, once daily, at a *randomized* time within a window (not a robotic identical timestamp) | Voice profile + tone dial only | 1×/day by default, owner-adjustable | Good default filler for "stay active" without needing real news |
| **Community posts — engagement (questions/polls)** | Scheduled, low frequency | Voice profile | Owner-adjustable, low by default | — |
| **Community posts — replies to mentions** | Incoming mention | Voice profile + the mention's content | **Not available for MVP** — requires X's separate prior written approval for AI reply bots (§0) | Build the review-queue UI for this later; don't wire live auto-replies until that approval exists |
| **Meme drops** | Owner-configured cadence (e.g. "N per week") plus opportunistic triggers off milestones/market moments | Reference sheet + voice/tone profile | Approval-required by default; auto-post only after the owner explicitly opts a project in | — |
| **Scheduled regular content** | Named calendar slots the owner defines (e.g. "Tuesday token facts," "Friday GM") | Voice profile | Owner-defined | Simple named-slot scheduler, not a general cron the owner has to hand-configure |

**Cadence ceiling to design around:** X's platform-wide cap for unverified
accounts is **50 original posts and 200 replies per day** (in effect since
May 2026, independent of whatever API tier is purchased) — that's the hard
ceiling, not a target. The practical default this spec recommends is far
below it: **1–4 posts per day per project**, owner-adjustable, with
per-category cooldowns so simultaneous triggers (a milestone hit during a
volume spike) don't stack into a burst.

**What it must never say**, regardless of category or learned style —
expanded on in Part 5, but the bare list belongs here too since it's part
of "what to post":
- Price predictions or targets
- Financial or investment advice ("you should buy/sell," "this is a good
  entry")
- Securities-style language (guarantees of returns, "investment
  opportunity" framing)
- Competitor attacks or disparagement of other projects
- Anything implying insider knowledge or non-public information
- Manufactured urgency/scarcity pressure ("last chance," "don't miss out"
  used as a pressure tactic rather than a genuine time-bound fact)

---

## Part 4 — Owner control

### Fully automatic vs. approval-required

A per-category default, with an explicit per-project override the owner
controls (not a single global switch):

| Category | Default |
|---|---|
| Milestone announcements | Auto-post allowed once voice confidence is *medium+* (Part 1) |
| GM / scheduled regular content | Auto-post allowed once voice confidence is *medium+* |
| Market moments | **Approval-required by default** — highest guardrail sensitivity |
| Meme drops | **Approval-required by default** |
| Mention replies | Not available until X's separate approval exists (§0) |

### Setting direction

A lightweight free-text directive field per project (e.g. *"focus this
week on community,"* *"be more aggressive"*) that layers on top of the
stored voice profile and tone dial as a **temporary override with an
expiry** — default 7 days — rather than a silent permanent mutation of the
voice. The current active directive (if any) and its expiry should be
visibly shown in the dashboard, with a one-click clear. This stops a
short-term mood from quietly becoming the project's permanent voice
because nobody remembered to revert it.

### Pause / kill switch

A single, always-visible toggle in `/admin`, per project (and a
platform-wide one for genuine emergencies) that:
- Immediately stops any further triggers from firing.
- **Cancels anything already queued for approval or scheduled** — this has
  to be a real server-side gate checked at send-time, not just a UI
  element that hides the queue while a background job still fires.
- Is unambiguous about scope (this project only vs. every project) so an
  owner managing multiple tokens doesn't accidentally kill the wrong one
  under pressure.

### Approval workflow, in `/admin`

A new section in the existing admin dashboard, reusing its existing
wallet-signed/password session auth rather than inventing new auth. Mirror
the **draft → publish** pattern the Pages CMS section already established
(per `README.md`'s admin dashboard docs) rather than a new UI paradigm:
- A **review queue**: each pending post shown with its full text, its
  generated image (if any), which category/trigger produced it, and which
  voice-profile version it was generated from.
- **Approve / edit / reject** actions per item — edited text should be
  captured as a signal back into the voice-learning loop (an owner
  consistently editing the same thing out is exactly the kind of feedback
  Part 1's profile should incorporate, not just a one-off fix).
- A **history/log** of everything actually posted, with timestamp, trigger,
  and category, so the owner (and, if needed, a support/compliance review)
  can see what went out and why.

---

## Part 5 — Safety guardrails

### Absolute never-list (regardless of learned style, owner directive, or tone dial)

These override everything above them in this document — no owner
directive, no learned voice, and no tone-dial setting should be able to
unlock them:
- Financial or investment advice, price predictions, or price targets
- Securities/solicitation language or return guarantees
- Claims of insider or non-public information
- Competitor disparagement or attacks
- Harassment, hate speech, or targeted negativity toward any individual
- Misleading engagement bait (fake urgency, fake scarcity, fake
  partnerships/listings)
- Anything that could read as coordinated pump/market-manipulation language
- Impersonation of another person, account, or project

### Handling FUD and negative reactions

Default posture: **do not auto-reply to negative sentiment at all** — this
is consistent with §0's finding that AI reply automation needs separate X
approval regardless, so there's no live capability to restrain here yet,
but the rule should hold even after that approval exists. Two concrete
rules for whenever replies do become available:
- **Never mention or quote a specific critical account or post** in
  outgoing content, automated or approved — arguing with critics from the
  project's own voice is a reputational risk regardless of how well-reasoned
  the reply is.
- Surface a **spike in negative replies/mentions as a dashboard signal** to
  the owner (a human decision point) rather than ever auto-responding to
  it. The system's job is to flag, not to engage.

### X rate limits and automation rules relevant to this feature

Restating the hard findings from this research, since they're binding
constraints on implementation, not just background color:
- **All automated posting must go through the official X API** — no
  browser automation or scraping for anything that posts without a human
  clicking the final button (the existing `/social` X-intent flow stays
  compliant precisely because a human does click; a scheduled/triggered
  auto-post cannot use that same mechanism).
- **Automated accounts must be labeled**, with no grace period — either
  via X's "Automated Account" label or clear bio disclosure ("Bot by
  @Hoodlums" style), for any account whose posts are triggered by
  automation rather than direct human action per post. Recommend labeling
  by default for any project that enables even one auto-post category,
  rather than trying to draw a fine line between "some categories are
  automated, others aren't" on a single account.
- **AI-generated reply bots require prior, explicit written approval from
  X**, obtained outside the standard developer portal flow — build the
  mention-reply capability's UI/data model now if useful, but don't plan
  to ship it live until that approval is in hand.
- **Posting caps**: X's platform-wide cap for unverified accounts is 50
  original posts and 200 replies per day (since May 2026), independent of
  API tier. API tiers themselves add their own monthly/15-minute-window
  caps on top of that (paid tiers use more forgiving 15-minute windows;
  the free tier uses much stricter 24-hour windows) — exact current
  pricing and quota numbers move often enough that they should be
  re-verified against X's developer portal at implementation time rather
  than hardcoded from this research.
- **Follow/unfollow automation is out of scope and should stay that way**
  — it's the most aggressively policed automation pattern on the platform
  and has no role in this feature (which is posting-only).

---

## Part 6 — Full combined specification

### 6.1 Pipeline, end to end

```
Voice examples (pasted, labeled by source)
        │
        ▼
Style-extraction call (structured JSON schema output,
mirroring lib/free-site-openai-pipeline.ts conventions)
        │
        ▼
Stored voice profile (tone / vocabulary / cadence / emoji /
hashtags / opener / formality / signoff) + curated few-shot set
+ confidence rating + preview approval
        │
        ├──────────────► Tone dial + temporary directive (Part 4) layer in here
        │
        ▼
Trigger evaluators (on-chain watcher, market-data watcher,
scheduler) — one per category in Part 3's table
        │
        ▼
Draft generation
  • text: voice profile + few-shot + tone/directive → caption
  • image (meme categories only): reference-image-conditioned
    generation off the golden heroImage + reference sheet,
    never off a prior generated meme
        │
        ▼
Guardrail pass (Part 5's never-list checked against every draft,
independent of what the voice profile or directive requested)
        │
        ▼
Per-category routing: auto-post gate OR approval queue (/admin)
        │
        ▼
X API post (OAuth-authenticated, labeled account) + Telegram
(reusing the existing /api/social/telegram path) if configured
        │
        ▼
Post history/log (per project, visible in /admin)
```

The kill switch (Part 4) is a gate checked at the trigger-evaluator stage
*and* immediately before the final X API call — both, so a switch flipped
mid-flight still stops an in-progress item.

### 6.2 New data needed (described, not modeled as code)

- **Voice profile** per project: the structured fields from Part 1, a
  version/history (so edits and re-extractions are traceable), the
  confidence rating, and the curated few-shot example set.
- **Reference sheet** per project: the generated angle/expression variants
  derived once from `heroImage`, plus a pointer back to the original
  `heroImage` as the permanent source of truth.
- **Tone dial + active directive** per project, with the directive's
  expiry timestamp.
- **Per-category automation settings** per project (auto vs.
  approval-required, cadence limits, cooldowns) — defaults from Part 4's
  table, owner-overridable.
- **Approval queue entries**: draft content, source trigger, category,
  voice-profile version used, state (pending/approved/edited/rejected),
  timestamps.
- **X OAuth credentials**, per project, **server-side and encrypted** —
  this is a new class of secret this codebase hasn't handled before
  (`GENERATE_SITE_STYLE_SHARED_SECRET`-style shared secrets and
  `GMGN_API_KEY`-style server-only API keys exist today, but nothing
  per-project-owner-authorized like an OAuth token yet). Must follow
  `CLAUDE.md` rule 2 (secrets stay server-side, never a `NEXT_PUBLIC_`
  value) and needs its own storage design — this is worth flagging as a
  meaningfully new security surface, not a small addition.
- **Post history/log** per project.

### 6.3 New server-side surfaces needed (described)

- A style-extraction endpoint (Stage 1/2 from Part 1), structured-output,
  short-lived, no different in shape from the existing OpenAI-pipeline
  endpoints in terms of protection needs (origin check + rate limiting,
  per `CLAUDE.md` rule 1, since this spends money on every call).
- A meme-generation endpoint (reference-image-conditioned image call),
  same protection posture — image generation is normally the more
  expensive call of the two, worth its own tighter rate limit.
- Background trigger evaluators: an on-chain watcher (curve/holder state),
  a market-data watcher (Dexscreener polling), and a scheduler (GM/regular
  content slots) — each producing draft entries into the approval-queue
  data model, not posting directly.
- An X-posting endpoint, OAuth-token-authenticated, that performs the
  actual API call once a draft is approved (or auto-approved per Part 4's
  routing) — this is the one surface that actually touches X's API and
  should be the narrowest, most heavily logged piece of the whole pipeline.
- A kill-switch endpoint/flag, checked by both the trigger evaluators and
  the X-posting endpoint (§6.1).

### 6.4 Decisions the owner needs to make before this gets built

Listed here because several of them are blocking, not just "nice to know":

1. **What "Pro" actually means** — pricing, gating mechanism, whether it's
   per-project or per-account. Nothing here assumes an answer.
2. **Which image-generation vendor/model** to use for reference-conditioned
   meme generation, and its cost profile at expected volume (this is likely
   the most expensive per-call piece of the whole feature).
3. **Committing to the X Developer API application process** — including,
   separately, whether to pursue the AI-reply-bot approval now or defer the
   mention-reply category entirely for a first release.
4. **Where encrypted OAuth token storage lives** — a genuinely new
   secret-handling surface for this codebase, worth a deliberate design
   pass on its own rather than bolting onto the existing `DATABASE_URL`
   Postgres store without thinking through the encryption-at-rest story.
5. **Default automation posture at launch** — this spec recommends
   approval-required-by-default for the higher-risk categories (market
   moments, memes) and auto-eligible-once-confident for the lower-risk ones
   (milestones, GM), but the actual launch defaults are a trust/product
   call for the owner to make explicitly, not something to infer silently
   from this document.

---

## Sources

- `components/social-hub.tsx`, `README.md`'s "Admin dashboard" section,
  `lib/free-site-openai-pipeline.ts` (this repo, read directly)
- [X's automation development rules — X Help](https://help.x.com/en/rules-and-policies/x-automation)
- [Introducing Automated Account Labeling — X Developers](https://devcommunity.x.com/t/introducing-automated-account-labeling/166830)
- [Developer Guidelines — X](https://docs.x.com/developer-guidelines)
- [X/Twitter Automation Rules 2026: What's Allowed vs. What Gets You Banned — OpenTweet](https://opentweet.io/blog/twitter-automation-rules-2026)
- [X (Twitter) Automation Rules and Rate Limits in 2026 — SocialNexis](https://socialnexis.com/guides/twitter-automation-safe-2026)
- [X (Twitter) API Pricing in 2026: All Tiers — Postproxy](https://postproxy.dev/blog/x-api-pricing-2026/)
- [How to Generate the Same Character Across Multiple Images — ArtSmart](https://artsmart.ai/blog/ai-character-consistency/)
- [How to Create Consistent Characters with AI (2026 Guide) — getimg.ai](https://getimg.ai/blog/how-to-create-consistent-characters-with-ai)
- [Best AI Image Generators for Consistent Characters in 2026 — Mage Space](https://blog.mage.space/article/best-ai-image-generators-consistent-characters-2026/392f47f0-6619-4021-9b07-ba3ed8c86ba8)
- [Where to Find FAFO Memes and Crypto Charts — Bitget Academy](https://www.bitget.com/amp/academy/fafo-memes-crypto)
- [X (Twitter) Content Strategy 2026 — Metadata Reactor](https://metadatareactor.com/blog/x-twitter-content-strategy-2026/)
- [Crypto Twitter Marketing Guide for Web3 Projects for 2026 — TheKollab](https://thekollab.io/articles/crypto-twitter-marketing/)
