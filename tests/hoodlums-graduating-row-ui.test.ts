import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string) {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("Hoodlums graduating row UI (issue #297)", () => {
  it("polls every 5 minutes, matching the server cache TTL, with a comment noting the Bitquery API-point tradeoff", async () => {
    const component = await source("components/hoodlums-graduating-row.tsx");
    expect(component).toContain("const POLL_INTERVAL_MS = 300_000;");
    expect(component).toMatch(/Bitquery API points/);
  });

  it("shows the letter tile as the loading placeholder from the start, not an empty box", async () => {
    const component = await source("components/hoodlums-graduating-row.tsx");
    // The initial letter <span> renders unconditionally, before the image is known to have loaded.
    expect(component).toContain("<span>{initial(token.name)}</span>");
    expect(component).toMatch(/useState<"loading" \| "loaded" \| "failed">\(/);
    expect(component).toMatch(/token\.artworkUrl \? "loading" : "failed"/);
  });

  it("gives up on a hanging image after ~5s and swaps to the letter tile", async () => {
    const component = await source("components/hoodlums-graduating-row.tsx");
    expect(component).toContain("const ARTWORK_LOAD_TIMEOUT_MS = 5_000;");
    expect(component).toMatch(/window\.setTimeout\(\(\) => \{/);
    expect(component).toMatch(/setStatus\(\(prev\) => \(prev === "loading" \? "failed" : prev\)\)/);
    expect(component).toContain("ARTWORK_LOAD_TIMEOUT_MS);");
    expect(component).toContain("window.clearTimeout(timeout);");
  });

  it("hides the image (and swaps to the letter tile) once status is failed, and marks it onLoad/onError", async () => {
    const component = await source("components/hoodlums-graduating-row.tsx");
    expect(component).toMatch(/showImage = status !== "failed" && Boolean\(token\.artworkUrl\)/);
    expect(component).toContain('onLoad={() => setStatus("loaded")}');
    expect(component).toContain('onError={() => setStatus("failed")}');
  });

  it("tracks and displays an updated-ago hint next to the row caption, in minutes once a minute has passed", async () => {
    const component = await source("components/hoodlums-graduating-row.tsx");
    expect(component).toContain("setUpdatedAt(Date.now());");
    expect(component).toContain("updated {formatUpdatedAgo(updatedSecondsAgo)}");
    expect(component).toContain("styles.updatedHint");
    expect(component).toMatch(/function formatUpdatedAgo\(seconds: number\): string \{/);
    expect(component).toContain('return `${seconds}s ago`;');
    expect(component).toContain('return `${Math.floor(seconds / 60)}m ago`;');
  });

  it("animates progress-bar width changes with a CSS transition", async () => {
    const css = await source("components/hoodlums-graduating-row.module.css");
    expect(css).toMatch(/\.gradBar span\s*\{[^}]*transition:\s*width/);
  });

  it("fades the artwork image in on load rather than popping it in over an empty box", async () => {
    const css = await source("components/hoodlums-graduating-row.module.css");
    expect(css).toContain(".artImageLoading");
    expect(css).toContain(".artImageLoaded");
  });
});
