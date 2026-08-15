import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FULLSCREEN_CONTROLS_ENTRY_VISIBLE_MS,
} from "@/components/full-website-generator";
import {
  ARTWORK_PLACEHOLDER,
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
*{box-sizing:border-box}body{margin:0}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.row{display:flex;gap:16px}img{max-width:100%}@media(max-width:700px){.stats{grid-template-columns:1fr}.row{flex-direction:column}}
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
  const end = prepared.indexOf("<\\/script>", start);
  expect(end).toBeGreaterThan(start);
  return prepared.slice(start, end);
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

  it("stacks generated grids and flex rows into one full-width vertical flow at 640px and below", () => {
    const prepared = prepareGeneratedPageForPreview(completeGeneratedHtml(), ARTWORK);
    const css = safetyCss(prepared);
    const mobile = css.slice(css.indexOf("@media (max-width:640px)"));

    expect(mobile).toContain("max-width:100vw!important");
    expect(mobile).toContain("overflow-x:hidden!important");
    expect(mobile).toContain("overflow-y:auto!important");
    expect(mobile).toContain("grid-template-columns:minmax(0,1fr)!important");
    expect(mobile).toContain("grid-auto-flow:row!important");
    expect(mobile).toContain("flex-direction:column!important");
    expect(mobile).toContain("align-items:stretch!important");
    expect(mobile).toContain("flex:0 1 auto!important");
    expect(mobile).toContain("grid-area:auto!important");
  });

  it("makes cards, media, tables and long text fluid without adding any desktop rule", () => {
    const prepared = prepareGeneratedPageForPreview(completeGeneratedHtml(), ARTWORK);
    const mobile = safetyCss(prepared).split("@media (max-width:640px)")[1];

    expect(mobile).toContain('[class*="card"]');
    expect(mobile).toContain('[class*="stat"]');
    expect(mobile).toContain("img,picture,video,canvas{display:block;max-width:100%!important;height:auto!important}");
    expect(mobile).toContain("table-layout:fixed!important");
    expect(mobile).toContain("overflow-wrap:anywhere!important");
    expect(mobile).toContain("white-space:pre-wrap!important");
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

  it("reports only a stationary non-interactive background tap", () => {
    const prepared = prepareGeneratedPageForPreview(
      completeGeneratedHtml(),
      ARTWORK,
      { reportTaps: true },
    );
    const bridge = tapBridge(prepared);

    expect(bridge).toContain("target.closest(interactive)");
    expect(bridge).toContain("a,area[href],button,input,select,textarea,label,summary,iframe");
    expect(bridge).toContain("[onclick]");
    expect(bridge).toContain("[role='button']");
    expect(bridge).toContain("[role='link']");
    expect(bridge).toContain("[tabindex]:not([tabindex='-1'])");
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
