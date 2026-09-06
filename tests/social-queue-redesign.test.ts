import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getStats } from "@/app/api/social/stats/route";
import {
  createMemoryAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import { resetSocialStudioRateLimitsForTests } from "@/lib/server/api-protection";
import { resetSocialConnectionsStoreForTests, setSocialConnectionsStoreForTests } from "@/lib/server/social-connections-store";
import { getSocialStats, setSocialStatsDepsForTests } from "@/lib/server/social-stats";
import { getChatMemberCount } from "@/lib/server/telegram";
import { createMemorySocialConnectionsStore } from "./social-connections-test-helpers";

const ROOT = process.cwd();
async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}
function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

const WALLET = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x00000000000000000000000000000000000000a1";

/**
 * Queue tab redesign (owner direction, 6 Sep 2026): the design's slim rows —
 * Approve from the row, expand for the editors, artwork, destination choice
 * and delete — with no Autopilot mode, a "Coming up" list, an "Already
 * published" table and a private "How it's going" panel showing honest
 * numbers only.
 */
describe("Queue tab layout (source pins)", () => {
  it("has no Autopilot: the header says approve-first is the only mode and nothing toggles it", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("<p>Nothing goes out until you say so.</p>");
    expect(hub).toContain("Approve first · every post");
    expect(hub).not.toMatch(/autopilot/i);
  });

  it("renders each waiting draft as a slim row with a destination tag, Approve and an expand toggle; the editors, toggles, schedule and action row only when expanded", async () => {
    const hub = await source("components", "social-hub.tsx");
    const queue = hub.slice(hub.indexOf('{activeTab === "queue" ? ('), hub.indexOf('{activeTab === "rules" ? ('));
    expect(queue).toContain("<span className={styles.eyebrow}>WAITING FOR YOU</span>");
    expect(queue).toContain("<span className={styles.queueCountBadge}>{queue.length}</span>");
    expect(queue).toContain('selectedDestinations.length === 2 ? "Both" : selectedDestinations.length === 1 ? platformLabel(selectedDestinations[0]) : "Pick where"');
    expect(queue).toContain("<article className={isExpanded ? styles.queueItemExpanded : styles.queueItem} key={item.id}>");
    // Row-level Approve is the same handler as before (auto-expands into the confirm step), only shown while collapsed.
    const rowActions = queue.slice(queue.indexOf("<div className={styles.queueRowActions}>"), queue.indexOf("<div className={styles.queueRowActions}>") + 1800);
    expect(rowActions).toContain("{!isExpanded ? (");
    expect(rowActions).toContain("onClick={() => handleApproveClick(item)}");
    expect(rowActions).toContain('{isExpanded ? "Less ▴" : "More ▾"}');
    // The clamped preview shows only while collapsed; the editors only while expanded.
    expect(queue).toContain("{!isExpanded ? (\n                                  <button\n                                    type=\"button\"\n                                    className={styles.queuePreview}");
    expect(queue).toContain("{isExpanded ? (\n                              <div className={styles.queueItemBody}>");
    // Everything wired survives inside the expanded body.
    for (const kept of ["updateQueueItem(item.id, { xText: event.target.value })", "toggleItemDestination(item.id, platform)", "className={styles.scheduleCompact}", "className={styles.confirmPanel}", "className={styles.queueItemActions}", 'handleQuickSendClick(item, "x")', 'handleQuickSendClick(item, "telegram")', "removeQueueItem(item.id)"]) {
      expect(queue, kept).toContain(kept);
    }
  });

  it("lists approved posts as Coming up rows (when · destination · text · expand) with the composer hand-off, reschedule and cancel behind the expand", async () => {
    const hub = await source("components", "social-hub.tsx");
    const queue = hub.slice(hub.indexOf('{activeTab === "queue" ? ('), hub.indexOf('{activeTab === "rules" ? ('));
    expect(queue).toContain("<span className={styles.eyebrow}>COMING UP</span>");
    expect(queue).toContain("<span className={styles.queueWhen}>{formatScheduledAt(post.scheduledAt)}</span>");
    expect(queue).toContain("const postExpanded = Boolean(expandedQueueItemIds[post.id]);");
    expect(queue).toContain("openComposerForPost(post)");
    expect(queue).toContain("reschedulePost(post)");
    expect(queue).toContain("cancelScheduledPost(post.id)");
  });

  it("renders history as the design's table with the per-destination outcome and the Reconnect tap", async () => {
    const hub = await source("components", "social-hub.tsx");
    const queue = hub.slice(hub.indexOf('{activeTab === "queue" ? ('), hub.indexOf('{activeTab === "rules" ? ('));
    expect(queue).toContain("<span className={styles.eyebrow}>ALREADY PUBLISHED</span>");
    expect(queue).toContain("<div className={styles.historyTable}>");
    expect(queue).toContain("<div className={styles.historyRow} key={post.id}>");
    expect(queue).toContain('const needsReconnect = destination.status === "failed" && connection?.status === "reconnect_needed";');
    expect(queue).toContain("Canceled before it was sent.");
  });

  it("shows How it's going with only real figures — holders and Telegram members — and says the rest is not tracked yet", async () => {
    const hub = await source("components", "social-hub.tsx");
    const queue = hub.slice(hub.indexOf('{activeTab === "queue" ? ('), hub.indexOf('{activeTab === "rules" ? ('));
    expect(queue).toContain("<h2>How it&apos;s going</h2>");
    expect(queue).toContain("ONLY YOU CAN SEE THIS");
    expect(queue).toContain("<span className={styles.eyebrow}>HOLDERS</span>");
    expect(queue).toContain("<span className={styles.eyebrow}>TELEGRAM MEMBERS</span>");
    expect(queue).toContain("<span className={styles.eyebrow}>X FOLLOWERS</span>");
    expect(queue).toContain("<small>not tracked yet</small>");
    expect(queue).toContain('{["Views", "Reactions", "Replies"].map((label) => (');
    // Never a fabricated delta or zero: a missing figure renders as an em dash.
    expect(queue).not.toContain("last 7 days");
    expect(hub).toContain("fetch(`/api/social/stats?${params.toString()}`, { cache: \"no-store\" })");
    expect(hub).toContain('if (activeTab !== "queue" || !walletAddress) return;');
  });

  it("carries the design's row-card, lime pending-card, history-table and nested-panel recipes", async () => {
    const css = await source("components", "social-hub.module.css");
    const row = ruleBlock(css, ".queueItem,\n.queueItemExpanded");
    expect(row).toContain("border-radius: 14px;");
    expect(row).toContain("padding: 14px 16px;");
    expect(css).toContain("\n.queueItemExpanded {\n  border-color: rgba(198, 245, 62, 0.34);");
    expect(ruleBlock(css, ".queueWhen")).toContain("width: 118px;");
    expect(ruleBlock(css, ".historyRow + .historyRow")).toContain("border-top: 1px solid rgba(255, 255, 255, 0.06);");
    expect(ruleBlock(css, ".howPanel")).toContain("border-radius: 22px;");
    expect(ruleBlock(css, ".howStat b")).toContain("font: 400 26px var(--display);");
    expect(ruleBlock(css, ".queueCountBadge")).toContain("box-shadow: 0 0 18px rgba(198, 245, 62, 0.5);");
    // The #356 action-row rule block is untouched.
    expect(css).toContain(".queueItemActions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }");
  });
});

describe("getSocialStats (lib/server/social-stats.ts)", () => {
  afterEach(() => {
    setSocialStatsDepsForTests(null);
  });

  it("returns holders and Telegram members from the injected readers and never invents X figures", async () => {
    const stats = await getSocialStats(WALLET, TOKEN, {
      readHolderCount: async () => 247,
      readTelegramMembers: async () => 613,
    });
    expect(stats).toEqual({ holders: 247, telegramMembers: 613, xFollowers: null });
  });

  it("degrades each figure to null on its own — a Blockscout failure never hides the Telegram count, a missing token skips the holder read", async () => {
    const readHolderCount = vi.fn(async () => {
      throw new Error("blockscout down");
    });
    expect(await getSocialStats(WALLET, TOKEN, { readHolderCount, readTelegramMembers: async () => 613 })).toEqual({ holders: null, telegramMembers: 613, xFollowers: null });
    expect(await getSocialStats(WALLET, "", { readHolderCount, readTelegramMembers: async () => null })).toEqual({ holders: null, telegramMembers: null, xFollowers: null });
    expect(readHolderCount).toHaveBeenCalledTimes(1);
    expect(await getSocialStats(WALLET, TOKEN, { readHolderCount: async () => Number.NaN, readTelegramMembers: async () => 1 })).toMatchObject({ holders: null });
  });

  it("reads the Telegram count only when the bot token and a connected channel both exist, via getChatMemberCount", async () => {
    const connections = createMemorySocialConnectionsStore();
    setSocialConnectionsStoreForTests(connections);
    const calls: string[] = [];
    vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${url.toString().split("/").pop()} ${String(init?.body)}`);
      return new Response(JSON.stringify({ ok: true, result: 613 }), { status: 200 });
    }) as typeof fetch);
    try {
      // No connection yet: null, no Telegram call.
      expect((await getSocialStats(WALLET, "", { env: { TELEGRAM_BOT_TOKEN: "12345:tok-aaaaaaaaaaaaaaaaaaaaaaaa" } })).telegramMembers).toBeNull();
      expect(calls).toEqual([]);
      await connections.upsert({ walletAddress: WALLET, platform: "telegram", displayName: "HOODS", externalId: "@hoods", credentials: JSON.stringify({ chatId: "@hoods" }) });
      // Bot token unset: still null, still no call.
      expect((await getSocialStats(WALLET, "", { env: {} })).telegramMembers).toBeNull();
      expect(calls).toEqual([]);
      expect((await getSocialStats(WALLET, "", { env: { TELEGRAM_BOT_TOKEN: "12345:tok-aaaaaaaaaaaaaaaaaaaaaaaa" } })).telegramMembers).toBe(613);
      expect(calls).toEqual(['getChatMemberCount {"chat_id":"@hoods"}']);
    } finally {
      vi.unstubAllGlobals();
      resetSocialConnectionsStoreForTests();
    }
  });

  it("getChatMemberCount posts to the Bot API method of that name and returns a number", async () => {
    vi.stubGlobal("fetch", (async () => new Response(JSON.stringify({ ok: true, result: "42" }), { status: 200 })) as typeof fetch);
    try {
      expect(await getChatMemberCount("12345:tok-aaaaaaaaaaaaaaaaaaaaaaaa", "@hoods")).toBe(42);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("GET /api/social/stats", () => {
  beforeEach(() => {
    resetSocialStudioRateLimitsForTests();
    setAdminOperationsStoreForTests(createMemoryAdminOperationsStore());
    setSocialStatsDepsForTests({ readHolderCount: async () => 247, readTelegramMembers: async () => 613 });
  });
  afterEach(() => {
    setSocialStatsDepsForTests(null);
    resetAdminOperationsStoreForTests();
  });

  it("400s a bad wallet or token address", async () => {
    expect((await getStats(new Request("http://localhost:3000/api/social/stats?walletAddress=nope"))).status).toBe(400);
    expect((await getStats(new Request(`http://localhost:3000/api/social/stats?walletAddress=${WALLET}&tokenAddress=0x12`))).status).toBe(400);
  });

  it("returns the honest figures with no-store caching, and null holders when no token is given", async () => {
    const response = await getStats(new Request(`http://localhost:3000/api/social/stats?walletAddress=${WALLET}&tokenAddress=${TOKEN}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ holders: 247, telegramMembers: 613, xFollowers: null });
    const noToken = await getStats(new Request(`http://localhost:3000/api/social/stats?walletAddress=${WALLET}`));
    expect(await noToken.json()).toEqual({ holders: null, telegramMembers: 613, xFollowers: null });
  });

  it("503s when the social-posting service is isolated", async () => {
    const operationsStore = createMemoryAdminOperationsStore();
    setAdminOperationsStoreForTests(operationsStore);
    await operationsStore.setServiceIsolation({ key: "social-posting", isolated: true, reason: "maintenance" });
    expect((await getStats(new Request(`http://localhost:3000/api/social/stats?walletAddress=${WALLET}`))).status).toBe(503);
  });
});
