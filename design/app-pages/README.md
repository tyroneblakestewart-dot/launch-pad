# App pages — design reference

Design reference only. Nothing in this folder is served or imported by the app.
Open a page by double-clicking it; each one loads `support.js` from this folder,
which pulls React and Babel from unpkg, so they need internet to render.

These were produced in the Claude Design tool over several passes and handed
over on 4 Sep 2026. They are a **reference, not a spec**. The live look — the
token page and the pages already migrated onto its shared premium theme — wins
wherever the two disagree, and several of these pages were drawn before
features that now exist. `design-vs-live.md` records every difference found on
first read, so nobody has to re-derive them.

## Pages

| File | What it shows |
| --- | --- |
| `hoodlums-private-builder-form.html` | The studio (Build 01 token setup + Build 02 site/socials), launch-readiness bar, live preview card. |
| `hoodlums-token-setup-form.html` | A later revision of the same studio page — prefer this one where they differ. |
| `hoodlums-social-studio.html` | The full Social Studio: connections, voice training, mascot, calendar, queue, rules. |
| `hoodlums-ai-social-panel.html` | A tighter four-step version of Social Studio setup, plus the kill switches. |
| `hoodlums-social-showcase.html` | The homepage marketing carousel for Social Studio. |
| `hoodlums-hoodchat.html` | Main Hoodchat feed and the per-token chat tab. |
| `hoodlums-plans-page.html` | The full pricing page (four tiers, billing toggle, FAQ). |
| `hoodlums-plan-modal.html` | Plan picker as a modal. Needs `doc-page.js` as well. |
| `hoodlums-plan-modal-transparent.html` | Same modal over a transparent backdrop. |

## Specs

- `social-studio-style-spec.md` — exact literal values (panel, tab rail, pills,
  chips, mobile chrome) pulled out of `hoodlums-social-studio.html`.

## Runtime files

`support.js` (all pages), `doc-page.js` (plan modal only), `image-slot.js`
(AI social panel only). Copied from the design tool, not written here.
