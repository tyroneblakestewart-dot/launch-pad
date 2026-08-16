import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FULLSCREEN_CONTROLS_ENTRY_VISIBLE_MS,
} from "@/components/full-website-generator";
import {
  ARTWORK_PLACEHOLDER,
  isCompleteGeneratedPageHtml,
  isGeneratedPageRejectedForLayoutOnly,
  prepareGeneratedPageForPreview,
} from "@/lib/generated-site-page";

const ARTWORK = "data:image/webp;base64,aGVsbG8=";

function completeGeneratedHtml(): string {
  const padding = "Mobile generated-site safety content. ".repeat(130);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mobile generated-site test</title>
<style>
*{box-sizing:border-box}body{margin:0}.stats{display:grid;grid-template-columns:1fr;gap:20px}.row{display:flex;gap:16px}img{max-width:100%}@media(min-width:700px){.stats{grid-template-columns:repeat(3,1fr)}}
</style>
</head>
<body>
<header><nav><a href="#about">About</a><button type="button">Menu</button></nav></header>
<main>
<section id="hero"><h1>Mobile generated-site test</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Uploaded artwork"></section>
<section id="about"><h2>About</h2><p>${padding}</p></section>
<section id="tokenomics"><h2>Tokenomics</h2><div class="stats"><article>Supply</article><article>Community</article><article>Launch</article></div></section>
<section id="roadmap"><h2>Roadmap</h2><div class="row"><article>Start</article><article>Grow</article></div></section>
<section id="how-to-buy"><h2>How to buy</h2><ol><li>Connect</li><li>Choose</li><li>Swap</li></ol></section>
<section id="community"><h2>Community</h2><button type="button">Join</button></section>
</main>
<script>document.body.dataset.ready='true';</script>
</body>
</html>`;
}

function safetyCss(prepared: string): string {
  const match = prepared.match(
    /<meta http-equiv="Content-Security-Policy"[^>]*><style>([\s\S]*?)<\/style>/,
  );
  expect(match).not.toBeNull();
  return match![1];
}

function tapBridge(prepared: string): string {
  const start = prepared.indexOf("var interactive=");
  expect(start).toBeGreaterThan(-1);
  return prepared.slice(start);
}

describe("generated-site mobile safety layer", () => {
  it("keeps the original desktop reset byte-for-byte before the mobile media query", () => {
    const prepared = prepareGeneratedPageForPreview(completeGeneratedHtml(), ARTWORK);
    const css = safetyCss(prepared);
    const mobileStart = css.indexOf("@media (max-width:640px)");

    expect(mobileStart).toBeGreaterThan(-1);
    expect(css.slice(0, mobileStart)).toBe(
      "html,body{max-width:100%;overflow-x:hidden}img,video,table,pre{max-width:100%}",
    );
    expect(css.slice(0, mobileStart)).not.toContain("grid-template-columns");
    expect(css.slice(0, mobileStart)).not.toContain("flex-direction");
  });

  it("is a targeted seatbelt at 640px and below, never one that dictates flex/grid direction (issue #338 fix 2)", () => {
    const prepared = prepareGeneratedPageForPreview(completeGeneratedHtml(), ARTWORK);
    const css = safetyCss(prepared);
    const mobile = css.slice(css.indexOf("@media (max-width:640px)"));

    expect(mobile).toContain("width:100%;max-width:100vw;overflow-x:hidden;overflow-y:auto");
    expect(mobile).toContain("box-sizing:border-box;min-width:0");
    expect(mobile).toContain("overflow-wrap:anywhere;word-break:break-word");

    // The #333 blanket force-stack reset must not come back: real stacking
    // is the mobile-first generation prompt's and the responsive-baseline
    // check's job (issue #326, #338 fix 4), not this seatbelt's.
    expect(mobile).not.toContain("grid-template-columns");
    expect(mobile).not.toContain("grid-auto-flow");
    expect(mobile).not.toContain("flex-direction");
    expect(mobile).not.toContain("flex-wrap");
    expect(mobile).not.toContain("align-items");
    expect(css).not.toContain("!important");
  });

  it("also repairs existing published sites because the public route uses the same default injection", () => {
    const pageSource = readFileSync(
      path.join(process.cwd(), "app", "[slug]", "page.tsx"),
      "utf8",
    );
    const prepared = prepareGeneratedPageForPreview(completeGeneratedHtml(), ARTWORK);

    expect(pageSource).toContain(
      "prepareGeneratedPageForPreview(html as string, site.heroImage)",
    );
    expect(prepared).toContain("@media (max-width:640px)");
    expect(prepared).not.toContain("hoodlums-generated-page-tap");
  });
});

describe("mobile full-screen background tap reporting", () => {
  it("uses movement-aware pointer events with a touch fallback for iPhone Safari", () => {
    const prepared = prepareGeneratedPageForPreview(
      completeGeneratedHtml(),
      ARTWORK,
      { reportTaps: true },
    );
    const bridge = tapBridge(prepared);

    expect(bridge).toContain("'PointerEvent'in window");
    expect(bridge).toContain("addEventListener('pointerdown'");
    expect(bridge).toContain("addEventListener('pointermove'");
    expect(bridge).toContain("addEventListener('pointerup'");
    expect(bridge).toContain("addEventListener('pointercancel'");
    expect(bridge).toContain("addEventListener('touchstart'");
    expect(bridge).toContain("addEventListener('touchmove'");
    expect(bridge).toContain("addEventListener('touchend'");
    expect(bridge).toContain("Math.abs(x-startX)>10||Math.abs(y-startY)>10");
  });

  it("reports only a stationary non-interactive background tap, from a narrowed selector of genuinely clickable elements (issue #338 fix 1)", () => {
    const prepared = prepareGeneratedPageForPreview(
      completeGeneratedHtml(),
      ARTWORK,
      { reportTaps: true },
    );
    const bridge = tapBridge(prepared);

    expect(bridge).toContain("target.closest(interactive)");
    expect(bridge).toContain(
      "a[href],button,input,select,textarea,summary,audio[controls],video[controls],[role='button'],[role='link']",
    );
    // PR #333 widened this to [tabindex], [onclick], bare label and a long
    // role list; a generated page wrapping whole sections in a tabindexed or
    // onclick-bearing container then swallowed the reveal gesture almost
    // everywhere. None of those belong in the narrowed selector.
    expect(bridge).not.toContain("[onclick]");
    expect(bridge).not.toContain("[tabindex]");
    expect(bridge).not.toContain(",label,");
    expect(bridge).not.toContain("[role='menuitem']");
    expect(bridge).not.toContain("[role='option']");
    expect(bridge).not.toContain("[role='switch']");
    expect(bridge).not.toContain("[role='checkbox']");
    expect(bridge).not.toContain("[role='radio']");
    expect(bridge).not.toContain("[contenteditable]");
    expect(bridge).toContain(
      "var report=!moved&&!startedInteractive&&!isInteractive(target)",
    );
    expect(bridge).toContain(
      "reporter.addEventListener('click',function(){parent.postMessage({type:'hoodlums-generated-page-tap'},'*')})",
    );
  });

  it("never consumes the generated site's own link, button or scrolling gestures", () => {
    const prepared = prepareGeneratedPageForPreview(
      completeGeneratedHtml(),
      ARTWORK,
      { reportTaps: true },
    );
    const bridge = tapBridge(prepared);

    expect(bridge).not.toContain("preventDefault");
    expect(bridge).not.toContain("stopPropagation");
    expect(bridge).not.toContain("stopImmediatePropagation");
    expect(bridge).toContain("addEventListener('pointercancel',cancel,{passive:true})");
    expect(bridge).toContain("addEventListener('touchcancel',cancel,{passive:true})");
  });

  it("retains the two-second teaching window and subtle fade on mobile full-screen entry", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components", "full-website-generator.tsx"),
      "utf8",
    );

    expect(FULLSCREEN_CONTROLS_ENTRY_VISIBLE_MS).toBe(2000);
    expect(source).toContain(
      "showFullScreenControls(FULLSCREEN_CONTROLS_ENTRY_VISIBLE_MS);",
    );
    expect(source).toContain(
      "transition: transform .22s ease, opacity .22s ease;",
    );
    expect(source).toContain(
      ".full-generated-page-fullscreen.full-generated-page-controls-visible .full-generated-page-controls",
    );
  });
});

// Issue #338 fix 4a tightened the responsive-baseline rule enough that real,
// already-accepted pre-#326 desktop-first content now fails it. Fix 4b keeps
// that content rendering (structural/safety checks only, never the strict
// mobile-first gate) and instead surfaces a visible prompt, so a stricter
// mechanical check can never silently break an already-published site or
// crash the studio's reopen flow for an old draft.
describe("legacy pre-#326 content still renders with a visible prompt instead of throwing (issue #338 fix 4b)", () => {
  function desktopFirstHtml(): string {
    const padding = "Legacy desktop-first generated-site content. ".repeat(130);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Legacy generated-site test</title>
<style>
*{box-sizing:border-box}body{margin:0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}img{max-width:100%}
</style>
</head>
<body>
<header><nav><a href="#about">About</a><button type="button">Menu</button></nav></header>
<main>
<section id="hero"><h1>Legacy generated-site test</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Uploaded artwork"></section>
<section id="about"><h2>About</h2><p>${padding}</p></section>
<section id="tokenomics"><h2>Tokenomics</h2><div class="grid"><article>Supply</article><article>Community</article><article>Launch</article></div></section>
<section id="roadmap"><h2>Roadmap</h2><div class="grid"><article>Start</article><article>Grow</article><article>Ship</article></div></section>
<section id="how-to-buy"><h2>How to buy</h2><ol><li>Connect</li><li>Choose</li><li>Swap</li></ol></section>
<section id="community"><h2>Community</h2><button type="button">Join</button></section>
</main>
<script>document.body.dataset.ready='true';</script>
</body>
</html>`;
  }

  it("fails the strict acceptance gate but is recognised as a layout-only, otherwise-safe rejection", () => {
    expect(isCompleteGeneratedPageHtml(desktopFirstHtml())).toBe(false);
    expect(isGeneratedPageRejectedForLayoutOnly(desktopFirstHtml())).toBe(true);
  });

  it("prepareGeneratedPageForPreview renders it instead of throwing", () => {
    expect(() => prepareGeneratedPageForPreview(desktopFirstHtml(), ARTWORK)).not.toThrow();
  });

  it("still throws for genuinely incomplete or unsafe HTML, not just anything that fails the strict gate", () => {
    expect(() => prepareGeneratedPageForPreview("<html></html>", ARTWORK)).toThrow(
      "The generated website document is incomplete.",
    );
  });

  it("the studio renders a visible regenerate-for-mobile prompt around the same rejection signal", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components", "full-website-generator.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'import { isGeneratedPageRejectedForLayoutOnly, prepareGeneratedPageForPreview } from "@/lib/generated-site-page";',
    );
    expect(source).toContain("const needsMobileRegeneration = isGeneratedPageRejectedForLayoutOnly(html);");
    expect(source).toContain("full-generated-page-mobile-warning");
    expect(source).toContain("if (mobileRegenerateWarning) controls.append(mobileRegenerateWarning);");
  });

  it("the served /[slug] route and the studio preview both render on the structural/safety check alone, not the strict mobile-first gate", () => {
    const pageSource = readFileSync(
      path.join(process.cwd(), "app", "[slug]", "page.tsx"),
      "utf8",
    );

    expect(pageSource).toContain(
      "const hasGeneratedHtml = isStructurallyCompleteGeneratedPageHtml(site.generatedSiteHtml);",
    );
    expect(pageSource).not.toContain("isCompleteGeneratedPageHtml(site.generatedSiteHtml)");
  });
});
