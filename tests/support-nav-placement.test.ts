import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Support in main navigation (issue #396)", () => {
  it("defines Support as a utility item with no workflow step number", async () => {
    const navigation = await source("components", "app-navigation.tsx");
    const supportIndex = navigation.indexOf('href: "/support"');
    expect(supportIndex).toBeGreaterThan(-1);

    const supportLine = navigation.slice(supportIndex, navigation.indexOf("\n", supportIndex));
    expect(supportLine).toContain('label: "Support"');
    expect(supportLine).toContain('icon: "support"');
    expect(supportLine).toContain('description: "Report a problem, get help"');
    expect(supportLine).toContain("utility: true");

    // Declared last so the mobile pill (which renders VISIBLE_NAV_ITEMS
    // as-is) appends it as the final, rightmost tab automatically.
    const bondingCurveIndex = navigation.indexOf('href: "/bonding-curve"');
    expect(supportIndex).toBeGreaterThan(bondingCurveIndex);
  });

  it("gives Support its own life-ring icon in the shared icon set", async () => {
    const navigation = await source("components", "app-navigation.tsx");
    expect(navigation).toContain('if (name === "support") {');
  });

  it("splits the desktop sidebar into a numbered workflow list and a separate bottom-pinned utility group", async () => {
    const navigation = await source("components", "app-navigation.tsx");

    expect(navigation).toContain(
      'const WORKFLOW_NAV_ITEMS = VISIBLE_NAV_ITEMS.filter((item) => !("utility" in item && item.utility));',
    );
    expect(navigation).toContain(
      'const UTILITY_NAV_ITEMS = VISIBLE_NAV_ITEMS.filter((item) => "utility" in item && item.utility);',
    );

    // Desktop: workflow items keep their numbered step badge; utility items
    // (Support) render in their own <nav> with an icon instead of a number,
    // and that group appears after the workflow list, right before the
    // testnet note.
    const sideNavIndex = navigation.indexOf("styles.sideNav");
    const utilityNavIndex = navigation.indexOf("styles.sidebarUtility");
    const sidebarNoteIndex = navigation.indexOf("styles.sidebarNote");
    expect(sideNavIndex).toBeGreaterThan(-1);
    expect(utilityNavIndex).toBeGreaterThan(sideNavIndex);
    expect(sidebarNoteIndex).toBeGreaterThan(utilityNavIndex);

    expect(navigation).toContain("WORKFLOW_NAV_ITEMS.map((item) => {");
    expect(navigation).toContain("UTILITY_NAV_ITEMS.map((item) => {");
    expect(navigation).toContain("<span className={styles.step}><NavIcon name={item.icon} /></span>");
  });

  it("still renders the mobile pill from the single flat VISIBLE_NAV_ITEMS list, so Support lands last", async () => {
    const navigation = await source("components", "app-navigation.tsx");
    expect(navigation).toContain("{VISIBLE_NAV_ITEMS.map((item) => (");
  });

  it("reuses the existing isActive startsWith logic for /support, same as every other tab", async () => {
    const navigation = await source("components", "app-navigation.tsx");
    expect(navigation).toContain("function isActive(pathname: string, href: string)");
    // Both the desktop groups and the mobile pill compute active state the
    // same way for every item, Support included — no special-casing.
    expect(navigation).toContain("const active = isActive(pathname, item.href);");
    expect(navigation).toContain("isActive(pathname, href) || optimisticActive");
  });

  it("styles the utility group and its icon without shrinking the existing 46px/44px mobile touch targets", async () => {
    const css = await source("components", "app-navigation.module.css");

    expect(css).toContain(".sidebarUtility");
    expect(css).toContain(".step svg");
    // The mobile pill's fixed touch-target size and column count are
    // untouched — VISIBLE_NAV_ITEMS.length (now including Support) simply
    // divides the same grid, so no width/height values needed to change.
    expect(css).toContain("width:46px; height:46px;");
    expect(css).toContain("grid-template-columns:repeat(var(--nav-count,5),minmax(0,1fr))");
    expect(css).not.toMatch(/\.bottomNav a[^{]*\{[^}]*width:\s*(?:[0-3]?\d|4[0-3])px/);
  });

  it("keeps the Account overlay's Report a problem link alongside the new nav entry (two doors, one room)", async () => {
    const overlay = await source("components", "account-overlay.tsx");
    expect(overlay).toContain('href="/support"');
    expect(overlay).toContain("Report a problem");
  });
});
