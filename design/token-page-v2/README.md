# Token page v2 — design reference

Design reference only. Nothing in this folder is served or imported by the app.

- `hoodlums-token-page-v2.html` — the target layout for the full-screen token page.
- `hoodlums-token-page-build-states.html` — the non-happy-path states: non-creator header with no art, zero-trade chart, live-data-paused chart, Hoodchat with no wallet, unverified audit row.
- `token-page-data-inventory.md` — every value the page displays, its format and fallbacks, plus the backend mapping (section 8).
- `token-page-style-spec.md` — the exact literal values (panel recipe, wells, chips, CTA) behind the premium look. Two of its statements are out of date: it says the down colour is red `#e2564b` and that the chart draws grid lines, but the design file's own `data-props` defaults are grey `#8d918c` and no grid, and those defaults are what the build follows.
- `support.js` — Claude Design runtime the two HTML files need to render. Loads React and Babel from unpkg, so the pages need internet to open.

Every figure in the mockups is illustrative. Nothing is hard-coded in the build.
