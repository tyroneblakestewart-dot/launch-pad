import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GENERATED_PAGE_ANCHOR_BRIDGE_SCRIPT,
  prepareGeneratedPageForPreview,
} from "@/lib/generated-site-page";

// Owner report, 13 Sep 2026: the generated site's nav (About / Tokenomics /
// How to Buy / Community) "goes to an error page" when clicked. Both the
// studio preview and the published /[slug] page render the document through
// iframe.srcdoc, whose base URL is the PARENT page's URL, so a plain
// href="#community" resolves to https://hoodlums.dev/#community and the
// browser navigates the sandboxed iframe to the Hoodlums app instead of
// scrolling. Reproduced in headless Chromium before the fix: the iframe's URL
// became `<parent url>#community` with the parent's body inside it and
// scrollY still 0. After the fix the iframe stays on its own document and
// scrollY moves to the section, in both frames, for the placeholder "#" link
// (no-op), a missing id (no-op) and "#top" (back to the top).

const ARTWORK = "data:image/webp;base64,aGVsbG8=";

function completeGeneratedHtml(): string {
  const padding = Array.from(
    { length: 80 },
    (_, index) => `.pad-${index}{--pad:${index};color:inherit;background:transparent}`,
  ).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>567TY</title>
<style>
body{margin:0;font-family:sans-serif}
section{min-height:900px;padding:24px}
.wrap{max-width:1100px;margin:0 auto}
@media (max-width:640px){section{padding:12px}}
${padding}
</style>
</head>
<body>
<header><nav><a href="#about">About</a> <a href="#community">Community</a> <a href="#">Buy</a></nav></header>
<section id="hero"><h1>hero</h1><img src="{{ARTWORK_DATA_URL}}" alt=""></section>
<section id="about"><h2>about</h2></section>
<section id="how-to-buy"><h2>how to buy</h2></section>
<section id="community"><h2>community</h2></section>
<script>document.body.dataset.ready='true';</script>
</body>
</html>`;
}

describe("generated page in-page anchor bridge", () => {
  it("is injected for the served page (default options) and the studio preview (reportTaps), once each, last before </body>", () => {
    for (const options of [undefined, { reportTaps: true }] as const) {
      const prepared = prepareGeneratedPageForPreview(completeGeneratedHtml(), ARTWORK, options);
      const occurrences = prepared.split(GENERATED_PAGE_ANCHOR_BRIDGE_SCRIPT).length - 1;
      expect(occurrences).toBe(1);

      const anchorAt = prepared.indexOf(GENERATED_PAGE_ANCHOR_BRIDGE_SCRIPT);
      const heightAt = prepared.indexOf("hoodlums-generated-page-height");
      expect(heightAt).toBeGreaterThan(-1);
      expect(anchorAt).toBeGreaterThan(heightAt);
      if (options?.reportTaps) {
        // The tap bridge's own preventDefault-free contract is pinned by
        // slicing up to its closing tag; the anchor bridge must sit after it.
        expect(anchorAt).toBeGreaterThan(prepared.indexOf("hoodlums-generated-page-tap"));
      }
      expect(prepared.slice(anchorAt + GENERATED_PAGE_ANCHOR_BRIDGE_SCRIPT.length)).toMatch(
        /^<\/body>\s*<\/html>\s*$/i,
      );
    }
  });

  it("only ever handles same-document links, and leaves everything else to the browser", () => {
    const script = GENERATED_PAGE_ANCHOR_BRIDGE_SCRIPT;
    expect(script).toContain("target.closest('a[href]')");
    expect(script).toContain("if(href.charAt(0)!=='#')return;");
    // Outbound links (the trade page, the explorer, X, Telegram) are never
    // intercepted, so allow-popups link-outs on the published page still work.
    expect(script).toContain("event.preventDefault()");
    expect(script.indexOf("if(href.charAt(0)!=='#')return;")).toBeLessThan(
      script.indexOf("event.preventDefault()"),
    );
  });

  it("stands down for the page's own handlers, modifier-key and non-primary clicks", () => {
    expect(GENERATED_PAGE_ANCHOR_BRIDGE_SCRIPT).toContain(
      "if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;",
    );
    // Registered in the bubble phase (no capture flag), so a generated page's
    // own click handler runs first and can preventDefault to opt out.
    expect(GENERATED_PAGE_ANCHOR_BRIDGE_SCRIPT).toContain("document.addEventListener('click',function(event){");
    expect(GENERATED_PAGE_ANCHOR_BRIDGE_SCRIPT).not.toContain("},true)");
    expect(GENERATED_PAGE_ANCHOR_BRIDGE_SCRIPT).not.toContain("capture:true");
  });

  it("treats the templates' bare href=\"#\" placeholder as a no-op instead of a jump to the top", () => {
    // Before this bridge a bare "#" was the same bug: it navigated the iframe
    // to the parent page's URL. It is now swallowed and does nothing.
    expect(GENERATED_PAGE_ANCHOR_BRIDGE_SCRIPT).toContain("var id=href.slice(1);if(id==='')return;");
  });

  it("scrolls the target section into view itself, honouring reduced motion, decoding the id, and never scrolling for a missing id", () => {
    const script = GENERATED_PAGE_ANCHOR_BRIDGE_SCRIPT;
    expect(script).toContain("decodeURIComponent(id)");
    expect(script).toContain("(prefers-reduced-motion: reduce)");
    expect(script).toContain("var behavior=reduce()?'auto':'smooth';");
    expect(script).toContain("document.getElementById(id)");
    expect(script).toContain("destination.scrollIntoView({behavior:behavior,block:'start'})");
    // A missing id (e.g. a nav item whose section the model never wrote)
    // does nothing; only a literal "#top" with no such element scrolls to 0.
    expect(script).toContain(
      "if(!destination){if(id==='top')window.scrollTo({top:0,left:0,behavior:behavior});return}",
    );
  });

  it("is a single inline script that cannot terminate the document early and never touches location", () => {
    const script = GENERATED_PAGE_ANCHOR_BRIDGE_SCRIPT;
    expect(script.startsWith("<script>")).toBe(true);
    expect(script.endsWith("</script>")).toBe(true);
    expect(script.split("<script>").length - 1).toBe(1);
    expect(script.split("</script>").length - 1).toBe(1);
    // Setting location.hash on a srcdoc document is the same navigation this
    // bridge exists to avoid, so it never writes to location at all.
    expect(script).not.toContain("location");
    expect(script).not.toContain("postMessage");
  });

  it("reaches published sites through the same serve-time preparation as the studio preview", () => {
    const pageSource = readFileSync(path.join(process.cwd(), "app", "[slug]", "page.tsx"), "utf8");
    expect(pageSource).toContain("prepareGeneratedPageForPreview(html as string, site.heroImage)");

    const frameSource = readFileSync(
      path.join(process.cwd(), "components", "public-site-frame.tsx"),
      "utf8",
    );
    // The bridge is an inline script, so the published frame must keep
    // allow-scripts (it does; this pins the dependency).
    expect(frameSource).toContain('sandbox="allow-scripts allow-popups"');

    const studioSource = readFileSync(
      path.join(process.cwd(), "components", "full-website-generator.tsx"),
      "utf8",
    );
    expect(studioSource).toContain('frame.setAttribute("sandbox", "allow-scripts")');
  });
});
