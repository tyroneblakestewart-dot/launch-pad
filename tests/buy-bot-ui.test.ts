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
 * Buy Bot in the Social Studio (owner direction, 5 Sep 2026): the first of
 * the three bots to go live. Source-pattern pins on the card, its own channel
 * drawer, the wallet-signed handlers and the now-live Rules row.
 */
describe("Social Studio Buy Bot card", () => {
  it("keeps Hype Bot and Watchtower as disabled coming-soon cards while the Buy Bot gets a real action", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('{bot.name !== "Buy Bot" ? <ComingSoon compact /> : null}');
    expect(hub).toContain('{bot.name !== "Buy Bot" ? (\n                            <button type="button" disabled>Add to your channel</button>');
    // The section-level badge is gone — one bot is live now.
    const heading = hub.slice(hub.indexOf("PICK A HOODLUMS BOT"), hub.indexOf("<div className={styles.botList}>"));
    expect(heading).not.toContain("<ComingSoon compact />");
    expect(heading).toContain("Each bot posts into a channel of its own.");
  });

  it("binds the bot to its own Telegram channel through a drawer with a channel field and threshold select — never the posting connection", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("const [buyBotChannelInput, setBuyBotChannelInput] = useState(\"\");");
    expect(hub).toContain('placeholder="@yourbuyschannel or -1001234567890"');
    expect(hub).toContain("Only buys after you add it are announced — never old ones.");
    expect(hub).toContain("{BUY_BOT_THRESHOLD_PRESETS.map((preset) => (");
    expect(hub).toContain("useState(DEFAULT_BUY_BOT_THRESHOLD_WEI)");
    expect(hub).toContain('{buyBotBusy ? "Verifying…" : "Verify & add"}');
    // The enable call never reads telegramConnection — the bot's channel is its own.
    const enable = hub.slice(hub.indexOf("async function enableBuyBot()"), hub.indexOf("async function updateBuyBot("));
    expect(enable).not.toContain("telegramConnection");
    expect(enable).toContain("SOCIAL_STUDIO_ACTION_PURPOSES.buyBotEnable");
    expect(enable).toContain('fetch("/api/social/buy-bot", {');
  });

  it("matches the selected project's bot by contract address on Robinhood only, and explains exactly why the action is unavailable", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('if (!contract || selectedProject?.chain !== "robinhood") return null;');
    expect(hub).toContain("bot.tokenAddress.toLowerCase() === contract && bot.chainId === ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL");
    expect(hub).toContain('"Launch this token on Robinhood Chain Testnet first — the Buy Bot watches its curve."');
    expect(hub).toContain("title={buyBotUnavailableReason ?? undefined}");
  });

  it("shows live/paused state with threshold, Pause/Resume and Remove once a bot exists, and an Add-again path when the channel was lost", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('{selectedBuyBot.status === "active" ? "Live" : "Paused"} · {selectedBuyBot.channelDisplayName}');
    expect(hub).toContain('{selectedBuyBot.status === "active" ? "Pause" : "Resume"}');
    expect(hub).toContain('updateBuyBot({ status: selectedBuyBot.status === "active" ? "paused" : "active" })');
    expect(hub).toContain('{selectedBuyBot?.status === "reconnect_needed" ? "Add again" : "Add to your channel"}');
    expect(hub).toContain("Add it again below, or remove it.");
    expect(hub).toContain("SOCIAL_STUDIO_ACTION_PURPOSES.buyBotUpdate");
    expect(hub).toContain("SOCIAL_STUDIO_ACTION_PURPOSES.buyBotDisable");
    expect(hub).toContain('fetch("/api/social/buy-bot/update", {');
    expect(hub).toContain('fetch("/api/social/buy-bot/disable", {');
  });

  it("loads the wallet's bots on wallet change without ever clearing them on a failed read", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("async function loadBuyBots()");
    expect(hub).toContain("fetch(`/api/social/buy-bot?walletAddress=${encodeURIComponent(walletAddress)}`, { cache: \"no-store\" })");
    const loader = hub.slice(hub.indexOf("async function loadBuyBots()"), hub.indexOf("useEffect(() => {\n    void loadBuyBots();"));
    expect(loader).not.toContain("setBuyBots([])\n    }");
    expect(loader).toContain("// A failed read keeps whatever was last shown");
  });

  it("gives the primary action the solid CTA recipe inside the card's ghost-button rule, and lays the live chip out with a lit dot", async () => {
    const css = await source("components", "social-hub.module.css");
    const primary = ruleBlock(css, ".botRow .botActionPrimary");
    expect(primary).toContain("background: var(--cta-bg);");
    expect(primary).toContain("color: var(--cta-color);");
    const live = ruleBlock(css, ".botLiveState::before");
    expect(live).toContain("border-radius: 50%;");
    expect(ruleBlock(css, ".botRow .botActions button")).toContain("width: auto;");
    // The shared three-selector button rule from #501 is untouched.
    expect(css).toContain(".botRow button,\n.disabledActions button,\n.mascotDrop button {");
  });

  it("keeps the Rules threshold row in lockstep with the bot: the same wei presets, label-keyed for the design's select", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain('"Add the Buy Bot in Setup and we\'ll drop a message in its channel each time someone buys."');
    expect(hub).toContain("`The Buy Bot is ${selectedBuyBot.status === \"active\" ? \"live\" : selectedBuyBot.status === \"paused\" ? \"paused\" : \"waiting to be re-added\"} in ${selectedBuyBot.channelDisplayName}.`");
  });
});

describe("Buy Bot migration 032", () => {
  it("creates the encrypted per-token registry idempotently and widens both admin service-key constraints for buy-bot", async () => {
    const sql = await source("db", "migrations", "032_social_buy_bots.sql");
    expect(sql).toContain("BEGIN;");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS social_buy_bots");
    expect(sql).toContain("encrypted_channel TEXT NOT NULL");
    expect(sql).toContain("threshold_wei NUMERIC(78, 0) NOT NULL CHECK (threshold_wei >= 0)");
    expect(sql).toContain("CHECK (status IN ('active', 'paused', 'reconnect_needed'))");
    expect(sql).toContain("cursor_block_number NUMERIC(78, 0) NOT NULL DEFAULT 0");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS social_buy_bots_wallet_token_idx");
    expect(sql).toContain("ON social_buy_bots (LOWER(wallet_address), chain_id, LOWER(token_address));");
    expect(sql).toContain("INSERT INTO admin_service_controls (service_key)\nVALUES ('buy-bot')\nON CONFLICT (service_key) DO NOTHING;");
    const statements = sql.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
    expect(statements.match(/'buy-bot'/g)?.length).toBe(3);
    for (const constraint of ["admin_service_controls_known_service", "admin_activity_log_known_service"]) {
      const block = statements.slice(statements.indexOf(`ADD CONSTRAINT ${constraint}`));
      expect(block.slice(0, block.indexOf(");"))).toContain("'buy-bot'");
    }
    expect(sql).toContain("COMMIT;");
    // No plaintext channel column anywhere.
    expect(sql).not.toMatch(/\bchat_id\b/);
  });
});
