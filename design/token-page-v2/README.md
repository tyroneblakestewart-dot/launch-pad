# Token page v2 — design reference

Design reference only. Nothing in this folder is served or imported by the app.

- `hoodlums-token-page-v2.html` — the target layout for the full-screen token page.
- `hoodlums-token-page-build-states.html` — the non-happy-path states: non-creator header with no art, zero-trade chart, live-data-paused chart, Hoodchat with no wallet, unverified audit row.
- `token-page-data-inventory.md` — every value the page displays, its format and fallbacks, plus the backend mapping (section 8).
- `support.js` — Claude Design runtime the two HTML files need to render. Loads React and Babel from unpkg, so the pages need internet to open.

Every figure in the mockups is illustrative. Nothing is hard-coded in the build.
