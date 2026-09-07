import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function source(...segments: string[]) {
  return readFile(path.join(process.cwd(), ...segments), "utf8");
}

/**
 * Owner recording, 7 Sep 2026 (iPhone, /social → Calendar): "outside of
 * restraints, no full view" — the week strip, the Add-to card and the
 * Telegram note all ran past the right edge of the phone.
 */
describe("Social Studio Calendar tab fits the phone", () => {
  it("floors the single mobile column at 0 so the scrolling week strip cannot widen it", async () => {
    const css = await source("components", "social-hub.module.css");
    const start = css.indexOf("@media (max-width: 860px) {");
    const block = css.slice(start, css.indexOf("@media (max-width: 480px) {", start));
    // A bare 1fr is minmax(auto, 1fr) — its floor is the content's min-content width.
    expect(block).toContain(".calendarLayout { grid-template-columns: minmax(0, 1fr); }");
    expect(block).toContain(".calendarLayout > div,\n  .calendarLayout > aside { min-width: 0; max-width: 100%; }");
    expect(block).not.toMatch(/\.calendarLayout,\s*\.botList/);
    // The strip itself is the scroll container and never asks for more than the column.
    expect(block).toContain(".mobileWeek { display: flex; gap: 8px; min-width: 0; max-width: 100%; overflow-x: auto;");
    expect(block).toContain(".desktopCalendar { display: none; }");
  });

  it("keeps the desktop two-column calendar layout untouched", async () => {
    const css = await source("components", "social-hub.module.css");
    expect(css).toContain(".mascotGrid,\n.calendarLayout {\n  display: grid;\n  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);");
  });
});

/**
 * Same session, the Tell-us-about-your-token form: its placeholders read
 * "Hoodlums / HOODS / hoodlums", which looked like another token's details
 * already saved in the fields. The launch studio settled this once before
 * (tests/new-project-blank-identity.test.ts): generic hints, never a
 * real-sounding value.
 */
describe("Social Studio token-details form placeholders", () => {
  it("uses generic hints, never the Hoodlums brand as if it were a saved value", async () => {
    const hub = await source("components", "social-hub.tsx");
    const form = hub.slice(hub.indexOf("value={externalForm.name}"), hub.indexOf("value={externalForm.description}"));
    expect(form).toContain('placeholder="Token name"');
    expect(form).toContain('placeholder="TICKER"');
    expect(form).toContain('placeholder="yourhandle"');
    expect(form).toContain('placeholder="yourchannel"');
    expect(hub).not.toContain('placeholder="Hoodlums"');
    expect(hub).not.toContain('placeholder="HOODS"');
    expect(hub).not.toContain('placeholder="hoodlums"');
  });
});
