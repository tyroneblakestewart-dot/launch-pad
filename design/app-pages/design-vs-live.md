# Design files vs the live build — read this before building from them

Written 4 Sep 2026, on first read of all 17 handover files. The rule the owner
set: **the current live look wins.** These pages are for panels, layout and
ideas — not for pasting, and not for reverting anything that already works.
Everything below is a difference found by reading the design against the code,
so it does not have to be found again mid-PR.

## 1 · Already true in the live build

- **Pricing.** `hoodlums-plans-page.html` matches `lib/launch-paths.ts` exactly:
  Bond free, Bond + Site free, Bond + Pro Site $10 one-off, Pro $50/month per
  token, Pro Bundle $120/month or $288/3 months, with the Monthly / 3-months
  −20% toggle. The FAQ and the "Drop your style" / "Drop your mascot" callouts
  are already in `lib/plans-section.ts`.
- **Token subdomains.** The plans page's `[token].hoodlums.dev` promise is real
  — `lib/subdomain-routing.ts`.
- **Posting cadence.** The showcase's "5 posts/day" ceiling is
  `MAX_POSTS_PER_DAY = 5` in `lib/social-studio-types.ts`.

## 2 · Design is stale — do NOT restore these

- **`hoodlums-plan-modal.html` says Pro is $30/month.** It is $50. The plans
  page is the current one; treat the modal as layout only.
- **Studio "Safe mode" pill, and the visible `Projects N` / `+ New token`
  buttons.** Removed on purpose (PR #486) — safe mode has been false since the
  studio started launching to testnet for real, and the two buttons still exist
  as hidden drivers because the workspace shell clicks them by label.
- **Free-site "Roadmap" and "FAQ" sections** in the builder form. Removed
  outright in issue #303; stored flags on old drafts are ignored.
- **Telegram bot-token paste field** (AI social panel). Live uses the platform
  bot plus an admin check, with credentials AES-256-GCM encrypted at rest
  (issue #335). The design's approach is weaker; keep the live one.
- **`token-page-style-spec.md` §1/§7 say down is red `#e2564b` and the chart
  has grid lines.** The design file's own committed `data-props` defaults say
  down is grey `#8d918c` and `showGrid` is false. The data-props defaults won
  (they are what the owner picked in the tool) and a test now pins them.
  `--accent-red` survives for genuine errors only.
- **`hoodlums-private-builder-form.html`** is superseded by
  `hoodlums-token-setup-form.html` — same page, later wording.

## 3 · Design shows something better than live — worth building

- **Launch readiness bar.** A single percentage over six named checks, in the
  studio. Live has the checklist but no percentage.
- **Export project JSON.** Not built.
- **Sticky live-preview market card** in the studio, showing the token as a grid
  card while you type. Live has a preview but not this card.
- **Per-plan quota pill** — "3/5 posts · 1/2 AI images" — visible in Social
  Studio. Live enforces the post cadence but shows no running count, and there
  is no AI-image quota at all.
- **Quiet hours** on the calendar, and "I'll post my own" as a real upload path.
  Both are still "coming soon" placeholders in `components/social-hub.tsx`.
- **"Tell Telegram about every buy"** with a minimum-size threshold
  (0.01 / 0.05 / 0.1 ETH). Not built.
- **Words to avoid** and a tone nudge in Rules. Live has the direction brief
  (issue #358) but no banned-word list.
- **Hoodchat "Hot right now"** panel with per-token message counts, an online
  count, and a character counter that turns lime near the limit. Live has the
  280-char cap but none of the three.
- **DROP ART only for the creator.** The build-states page is explicit: a
  non-creator sees the initial-letter tile with no upload affordance. Live shows
  the same tile to everyone.

## 4 · Runtime notes

- Every page needs `support.js` from this folder. `hoodlums-plan-modal.html`
  also needs `doc-page.js` (a print/paged shell that is not portable into the
  app), and `hoodlums-ai-social-panel.html` needs `image-slot.js`.
- All figures in the mockups are illustrative. Nothing in them is a data source.
