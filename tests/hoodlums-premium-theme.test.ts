import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Owner direction (4 Sep 2026): every page should follow the token page v2's
// look — tabs, colours, fonts, panelling — exactly, not "close". The token
// page's own variable block is the design source of truth; this file lifts it
// into a shared `.hoodlums-premium` scope and these tests hold the two sets
// identical so the homepage can never drift from the token page by a shade.

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

/** Parses `--name: value;` declarations out of one CSS rule block, whitespace-normalised. */
function parseVariables(block: string): Map<string, string> {
  const withoutComments = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations: string[] = [];
  let buffer = "";
  let depth = 0;
  for (const char of withoutComments) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === ";" && depth === 0) {
      declarations.push(buffer.trim());
      buffer = "";
    } else {
      buffer += char;
    }
  }
  const variables = new Map<string, string>();
  for (const declaration of declarations) {
    if (!declaration.startsWith("--")) continue;
    const [name, ...rest] = declaration.split(":");
    variables.set(name.trim(), rest.join(":").replace(/\s+/g, " ").trim());
  }
  return variables;
}

/** The rule whose selector list is exactly `selector` (anchored at line start, so `.tabActive {` never matches `.tab,\n.tabActive {` or `.tabMuted.tabActive {`). */
function ruleBlock(css: string, selector: string): string {
  // A standalone rule: the selector starts a line that is not a `,` continuation of a combined selector list.
  const match = new RegExp(`(?:^|(?<!,)\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`).exec(css);
  expect(match, `${selector} rule`).not.toBeNull();
  const start = match!.index;
  const end = css.indexOf("\n}", start);
  // Body only (after the opening brace), so the first declaration is never glued to the selector.
  const bodyStart = css.indexOf(`${selector} {`, start);
  return css.slice(css.indexOf("{", bodyStart) + 1, end);
}

const HOMEPAGE_STYLESHEETS = [
  "components/hoodlums-market-home.module.css",
  "components/hoodlums-token-grid.module.css",
  "components/robinhood-trending-panel.module.css",
  "components/hoodlums-graduating-row.module.css",
];

// The older palette the homepage was tuned to by eye before this pass.
const LEGACY_HEXES = ["#bce759", "#566054", "#4dff2e", "#3a4238", "#0d120e", "#060a07", "#f4f7ef", "#929693", "#8a9488", "#2e3a2c"];

describe("shared premium theme (token page design tokens)", () => {
  it("defines exactly the token page's `.page` variable set, value for value", async () => {
    const theme = parseVariables(ruleBlock(await source("app/hoodlums-premium-theme.css"), ".hoodlums-premium"));
    const tokenPage = parseVariables(ruleBlock(await source("components/token-page/token-page.module.css"), ".page"));
    expect(theme.size).toBeGreaterThan(40);
    expect([...theme.keys()].sort()).toEqual([...tokenPage.keys()].sort());
    for (const [name, value] of tokenPage) {
      expect(theme.get(name), name).toBe(value);
    }
    // The values that define the look, pinned by name so a rename can't slip past.
    expect(theme.get("--accent-lime")).toBe("#c6f53e");
    expect(theme.get("--accent-down")).toBe("#8d918c");
    expect(theme.get("--cta-bg")).toBe("#c6f53e");
    expect(theme.get("--display")).toBe('"Archivo Black", "Inter", sans-serif');
  });

  it("is scoped to a class, not :root, so pages opt in one at a time (globals.css still carries the older --display)", async () => {
    const theme = await source("app/hoodlums-premium-theme.css");
    expect(theme).toContain(".hoodlums-premium {");
    expect(theme).not.toMatch(/^:root/m);
    const layout = await source("app/(app)/layout.tsx");
    expect(layout).toContain('import "../hoodlums-premium-theme.css";');
  });

  it("loads Archivo Black alongside the existing fonts so --display resolves on opted-in pages", async () => {
    const globals = await source("app/globals.css");
    expect(globals).toContain("family=Archivo+Black&");
  });

  it("opts the homepage root in", async () => {
    const home = await source("components/hoodlums-market-home.tsx");
    expect(home).toContain("<div className={`${styles.page} hoodlums-premium`}>");
  });
});

describe("homepage stylesheets use the shared recipes, never the legacy palette", () => {
  it("contains no legacy hard-coded palette colours (the pinned sparkline semantics excepted)", async () => {
    for (const file of HOMEPAGE_STYLESHEETS) {
      const css = await source(file);
      for (const hex of LEGACY_HEXES) {
        expect(css, `${file} still uses ${hex}`).not.toContain(hex);
      }
      expect(css, `${file} still uses the old lime rgba`).not.toContain("rgba(188, 231, 89");
    }
    // Chart semantics pinned since issue #440 stay exactly as they were.
    const grid = await source("components/hoodlums-token-grid.module.css");
    expect(grid).toContain(".sparklineUp {\n  color: #91f0b6;\n}");
    expect(grid).toContain(".sparklineDown {\n  color: #ff5f56;\n}");
  });

  it("uses the token page's chip track + glowing chip recipe for the grid tabs and the trending tabs", async () => {
    for (const file of ["components/hoodlums-token-grid.module.css", "components/robinhood-trending-panel.module.css"]) {
      const css = await source(file);
      const track = ruleBlock(css, ".tabs");
      expect(track).toContain("border-radius: 999px;");
      expect(track).toContain("background: linear-gradient(180deg, rgba(0, 0, 0, 0.4), rgba(255, 255, 255, 0.02));");
      expect(track).toContain("box-shadow: 0 2px 6px 0 rgba(0, 0, 0, 0.5) inset;");
      const active = ruleBlock(css, ".tabActive");
      expect(active).toContain("border-color: var(--chip-active-border-color);");
      expect(active).toContain("background: var(--chip-active-bg);");
      expect(active).toContain("box-shadow: var(--chip-active-shadow);");
      expect(active).toContain("text-shadow: var(--chip-active-text-shadow);");
      expect(active).toContain("color: var(--chip-active-color);");
    }
  });

  it("uses the master panel recipe for cards and the trending panel, and the inset well for art tiles", async () => {
    const grid = await source("components/hoodlums-token-grid.module.css");
    const trending = await source("components/robinhood-trending-panel.module.css");
    const graduating = await source("components/hoodlums-graduating-row.module.css");
    for (const block of [ruleBlock(grid, ".card"), ruleBlock(trending, ".panel"), ruleBlock(graduating, ".card")]) {
      expect(block).toContain("border: var(--panel-border);");
      expect(block).toContain("border-radius: var(--panel-radius);");
      expect(block).toContain("background: var(--panel-bg);");
      expect(block).toContain("box-shadow: var(--panel-shadow);");
    }
    for (const block of [ruleBlock(grid, ".art"), ruleBlock(graduating, ".art")]) {
      expect(block).toContain("background: var(--well-bg);");
      expect(block).toContain("box-shadow: var(--well-shadow);");
      expect(block).toContain("color: var(--accent-lime);");
    }
  });

  it("uses the solid-lime CTA recipe (never a gradient) for every homepage button, in the sans face", async () => {
    const home = await source("components/hoodlums-market-home.module.css");
    const grid = await source("components/hoodlums-token-grid.module.css");
    for (const block of [
      ruleBlock(home, ".primaryCta"),
      ruleBlock(home, ".savedLaunchesButton"),
      ruleBlock(grid, ".createTokenButton"),
      ruleBlock(grid, ".emptyCta"),
    ]) {
      expect(block).toContain("background: var(--cta-bg);");
      expect(block).toContain("color: var(--cta-color);");
      expect(block).toContain("var(--sans)");
      expect(block).not.toContain("linear-gradient");
    }
  });

  it("sets the hero headline in the display face and the down colour to the design's grey token", async () => {
    const home = await source("components/hoodlums-market-home.module.css");
    expect(ruleBlock(home, ".headline")).toContain("font-family: var(--display);");
    const trending = await source("components/robinhood-trending-panel.module.css");
    expect(ruleBlock(trending, ".dn")).toContain("color: var(--accent-down);");
    expect(ruleBlock(trending, ".up")).toContain("color: var(--accent-lime);");
  });
});

describe("sidebar follows the same recipe (shared chrome — every page's sidebar)", () => {
  it("uses the token page lime, white hairlines and the glowing chip recipe for the active item, keeping the fixed 238px layout", async () => {
    const css = await source("components/app-navigation.module.css");
    expect(css).toContain(".sidebar { position:fixed; inset:0 auto 0 0; z-index:90; width:238px;");
    expect(css).not.toContain("#b9ef4d");
    expect(css).not.toContain("rgba(185,239,77");
    expect(css).not.toContain("rgba(131,183,139");
    expect(css).toContain(
      ".sideNav a.active, .sidebarUtility a.active, .mobileMenu a.active { border-color:rgba(198,245,62,.5); background:linear-gradient(180deg, rgba(198,245,62,.2), rgba(198,245,62,.05)); box-shadow:0 1px 0 0 rgba(198,245,62,.22) inset, 0 6px 16px -8px rgba(198,245,62,.5); color:#f4f7f1; }",
    );
    expect(css).toContain(".active .step { border-color:transparent; background:#c6f53e; color:#071008;");
  });
});
