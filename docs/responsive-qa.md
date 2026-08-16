# Responsive QA for generated token sites (issue #303)

Generated sites (the bespoke `lib/site-page-openai-pipeline.ts` AI pipeline
and the free-site `lib/free-site-template.ts` template) are required to look
deliberately designed at mobile (390px), tablet (768px) and desktop (1280px+)
widths — see `lib/generated-site-page.ts` for the automated baseline this
document extends.

## What is already automated

- The generation prompt (`lib/site-page-openai-pipeline.ts`) requires a
  viewport meta tag, fluid units/media queries, a centred max-width desktop
  container, comfortable mobile stacking, `scroll-behavior: smooth`, and no
  horizontal overflow. See `tests/generate-site-page.test.ts` for prompt
  assertions.
- `isCompleteGeneratedPageHtml` (`lib/generated-site-page.ts`) rejects a page
  that is missing the viewport meta tag, that has zero CSS media queries and
  zero responsive units (so it made no attempt at a responsive layout), that
  hardcodes a wide fixed-pixel container outside any breakpoint (the
  clearest way a page overflows a 390px viewport), or that declares a
  multi-column CSS grid or an unstacked (`flex-wrap: nowrap`) flex row
  outside any `min-width` media query at all — the "desktop layout squished
  onto the phone" bug (issue #323, tightened by issue #338 to a strict
  mobile-first rule: side-by-side layout may only ever appear inside a
  `min-width` breakpoint, never at the base, no matter what stacks it
  later). This is the shared acceptance gate for both the bespoke AI
  pipeline and the free-site template, and runs before either can be
  published — see `tests/generated-site-page.test.ts`'s "responsive
  baseline" suite. When a bespoke AI page is rejected for this reason alone,
  the generation route (`app/api/generate-site-page/route.ts`) retries once
  automatically with corrective feedback before failing.
- `prepareGeneratedPageForPreview` also injects a code-enforced overflow
  clamp (`html,body{max-width:100%;overflow-x:hidden}` plus
  `img,video,table,pre{max-width:100%}`, plus a `min-width:0`/box-sizing/
  overflow-wrap layer at ≤640px — see issue #338 fix 2) into every prepared
  page, and the served `/[slug]` route's own page shell
  (`app/[slug]/public-site-reset.css`) carries the same clamp — a rarely-
  needed safety net, not something that dictates flex/grid direction, that
  holds even if some generated markup slips past the mechanical baseline
  above. Because that baseline tightened after issue #326, rendering
  already-stored content (this function, and `app/[slug]/page.tsx`) checks
  only structural/safety completeness
  (`isStructurallyCompleteGeneratedPageHtml`), not the strict mobile-first
  gate — a pre-#326 page still renders behind the clamp, and the studio
  shows a "Regenerate for mobile" prompt on reopen instead of silently
  relying on it.

This is a mechanical baseline, not a design review: a page can pass it and
still look bad at some width (cramped spacing, an awkward line break, a
button that's too small to tap). That gap is the reason for the manual pass
below — nothing before this document actually *renders* the page.

## Manual screenshot pass (do this before calling a layout change done)

You need a browser. No new project dependency is required — everything
below uses tools already on a developer machine.

### Quickest: browser DevTools responsive mode

1. Open the generated page (the studio preview iframe, or a saved
   `generatedSiteHtml` string pasted into a local `.html` file and opened
   directly).
2. Open DevTools → toggle device toolbar (Cmd+Shift+M in Chrome, Cmd+Option+M
   in Firefox).
3. Set the viewport to exactly **390 × 844** (iPhone-class) and inspect:
   nothing cut off, no horizontal scrollbar, tap targets comfortable, hero
   readable without zooming.
4. Set the viewport to exactly **1280 × 800** (or wider) and inspect: content
   sits in a centred column rather than stretching edge-to-edge, spacing
   feels intentional rather than sparse.
5. Also check **768 × 1024** as the midpoint if the layout has a tablet-only
   breakpoint.

### Scripted: on-demand Playwright screenshots

For a repeatable artifact (e.g. to attach to a PR), Playwright can be run
via `npx` without adding it as a project dependency — it downloads its own
browser binary on first run:

```bash
npx --yes playwright screenshot --viewport-size=390,844 --full-page \
  path/to/generated-page.html mobile-390.png

npx --yes playwright screenshot --viewport-size=1280,900 --full-page \
  path/to/generated-page.html desktop-1280.png
```

Eyeball both PNGs side by side for the same failure modes as the DevTools
pass: overlapping or cut-off elements, distorted images, a sticky/absolute
element covering content on the mobile shot, and a desktop shot that isn't
just the mobile layout stretched wide.

## What still needs a human

The automated baseline proves the page *attempted* a responsive layout. It
cannot judge whether spacing is comfortable, whether a hero image is
cropped awkwardly, or whether a sticky header overlaps the first section on
a short viewport. Run the manual pass above whenever the generation prompt,
the free-site template (`docs/free-site-template-source.html`), or the
responsive baseline validator changes.
