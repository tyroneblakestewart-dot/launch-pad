import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

/**
 * The Social Studio design pass against `design/app-pages/hoodlums-social-studio.html`
 * and its style spec. Everything here is shape and finish — no wiring changed,
 * so anything the design draws that we cannot honestly power yet stays visibly
 * disabled rather than faked.
 */
describe("Social Studio design pass", () => {
  it("gives the connection cards the design's row shape, with X's connect action disabled and Telegram's real disconnect in its place", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('<button type="button" className={styles.connectionActionPrimary} disabled>');
    expect(hub).toContain("Connect X");
    // The browser-handoff path is still the honest thing to point at, and is
    // still the only way to post to X today.
    expect(hub).toContain("it opens");
    expect(hub).toContain("X&apos;s own composer");
    expect(hub).toContain("className={styles.connectionAction}");
    expect(hub).toContain("onClick={disconnectTelegramChannel}");
    // Disconnect now lives in the card's own action slot, not a separate row.
    expect(hub).not.toContain("<div className={styles.composerActions}>\n                              <button type=\"button\" onClick={disconnectTelegramChannel}");

    const css = await source("components", "social-hub.module.css");
    expect(css).toMatch(/\.connectionActionPrimary \{\n  border: 0;\n  color: var\(--cta-color\);\n  background: var\(--cta-bg\);/);
    expect(css).toMatch(/\.connectionAction \{[^}]*background: var\(--studio-ghost-bg\);/s);
  });

  it("renders the three Hoodlums bots as cards with their mark and kind, three across", async () => {
    const hub = await source("components", "social-hub.tsx");
    for (const [mark, kind] of [["B", "ALERTS"], ["H", "COMMUNITY"], ["W", "MILESTONES"]]) {
      expect(hub).toContain(`mark: "${mark}"`);
      expect(hub).toContain(`kind: "${kind}"`);
    }
    expect(hub).toContain("<span className={styles.botMark} aria-hidden=\"true\">{bot.mark}</span>");
    expect(hub).toContain("<em>{bot.kind}</em>");

    const css = await source("components", "social-hub.module.css");
    const list = ruleBlock(css, ".botList");
    expect(list).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    const card = ruleBlock(css, ".botRow");
    expect(card).toContain("flex-direction: column;");
    expect(card).toContain("border-radius: 16px;");
  });

  it("makes each tone dial a single inset-well select rather than a segmented row", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("<select disabled defaultValue={options[1]}>");
    expect(hub).not.toContain("className={index === 1 ? styles.dialSelected : undefined}");

    const css = await source("components", "social-hub.module.css");
    expect(css).toMatch(/\.buyAlertThreshold select \{[^}]*background: var\(--well-bg\);/s);
    expect(css).toMatch(/\.buyAlertThreshold select \{[^}]*box-shadow: var\(--well-shadow\);/s);
  });

  it("draws the buy-alert row from the design, with its threshold and an explicit coming-soon badge", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("Tell Telegram about every buy");
    expect(hub).toContain('const BUY_ALERT_THRESHOLDS = ["0.01 ETH", "0.05 ETH", "0.1 ETH"] as const;');
    expect(hub).toContain("<label className={styles.buyAlertThreshold}>");
    // Nothing here is wired, so it must say so rather than look live.
    const row = hub.slice(hub.indexOf("Tell Telegram about every buy"));
    expect(row.slice(0, 900)).toContain("<ComingSoon compact />");
    expect(hub).toContain('<select disabled defaultValue="0.01 ETH">');
  });

  it("selects a calendar day as a lime-tinted card, never a solid lime block", async () => {
    const css = await source("components", "social-hub.module.css");
    const selected = ruleBlock(css, ".calendarSelected");
    expect(selected).toContain("background: var(--studio-lime-card-bg);");
    expect(selected).toContain("color: var(--accent-lime);");
    expect(selected).not.toContain("background: var(--cta-bg);");
    expect(css).toMatch(/\.cadenceOptionActive \{\n  border-color: rgba\(198, 245, 62, 0\.45\);\n  background: var\(--studio-lime-card-bg\);/);
    expect(css).not.toMatch(/\.cadenceOptionActive \{[^}]*background: var\(--cta-bg\);/s);
  });

  it("shows the design's TODAY posts pill from real approved posts and this cadence's own ceiling", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("<span className={styles.metaLabel}>TODAY</span>");
    expect(hub).toContain("{postsScheduledToday}/{cadencePostsPerDay}");
    expect(hub).toContain("countPostsScheduledToday(");
    expect(hub).toContain('post.status !== "canceled"');
    expect(hub).toContain("const cadencePostsPerDay = cadenceQueueTarget(postingCadence);");
    // Holder count and the AI-image half of the design's pill are not tracked
    // yet, so neither is rendered — a made-up number is worse than none.
    expect(hub).not.toContain("AI images");
  });

  it("keeps the page's own card, lime-card and ghost recipes local rather than widening the shared theme", async () => {
    const css = await source("components", "social-hub.module.css");
    const shell = ruleBlock(css, ".shell");
    for (const token of ["--studio-card-bg:", "--studio-card-shadow:", "--studio-lime-card-bg:", "--studio-ghost-bg:"]) {
      expect(shell, token).toContain(token);
    }
    const theme = await source("app", "hoodlums-premium-theme.css");
    expect(theme).not.toContain("--studio-card-bg");
  });
});
