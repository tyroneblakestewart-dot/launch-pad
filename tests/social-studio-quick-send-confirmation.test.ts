import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Quick-send confirmation (issue #382)", () => {
  it("Post to X and Send to Telegram are two-tap actions gated through handleQuickSendClick, not immediate sends", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("function handleQuickSendClick(item: QueueItem, platform: SocialPlatform)");
    expect(social).toContain(
      "const [pendingQuickSendId, setPendingQuickSendId] = useState<{ itemId: string; platform: SocialPlatform } | null>(null);",
    );

    const handlerBlock = social.slice(
      social.indexOf("function handleQuickSendClick"),
      social.indexOf("function handleQuickSendClick") + 900,
    );
    // The first tap never posts: it force-expands the card and records the
    // pending item/platform, exactly like handleApproveClick's first tap.
    expect(handlerBlock).toContain(
      "const isPending = pendingQuickSendId?.itemId === item.id && pendingQuickSendId.platform === platform;",
    );
    expect(handlerBlock).toContain("if (!isPending) {");
    expect(handlerBlock).toContain("setExpandedQueueItemIds((current) => ({ ...current, [item.id]: true }));");
    expect(handlerBlock).toContain("setPendingQuickSendId({ itemId: item.id, platform });");
    expect(handlerBlock).toContain("return;");
    // Only past that early return does it call the real network actions.
    expect(handlerBlock).toContain("postQueueItemToX(item);");
    expect(handlerBlock).toContain("void sendQueueItemToTelegram(item);");
  });

  it("the Queue tab wires both quick-send buttons through handleQuickSendClick with the correct platform, not a direct call", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain('onClick={() => handleQuickSendClick(item, "x")}');
    expect(social).toContain('onClick={() => handleQuickSendClick(item, "telegram")}');
    // The old one-tap wiring is gone.
    expect(social).not.toContain("onClick={() => postQueueItemToX(item)}");
    expect(social).not.toContain("onClick={() => sendQueueItemToTelegram(item)}");
  });

  it("relabels each quick-send button to 'Confirm & ...' only once that destination's tap is pending", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain('<XMark /> {isPendingQuickSendX ? "Confirm & post to X" : "Post to X"}');
    expect(social).toContain(
      '<TelegramMark /> {isPendingQuickSendTelegram ? "Confirm & send to Telegram" : "Send to Telegram"}',
    );
  });

  it("shows a confirm panel naming the exact destination and reusing the existing confirm-panel styling (no new density, rule 7)", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("isPendingQuickSendX || isPendingQuickSendTelegram");
    const quickSendPanelBlock = social.slice(
      social.indexOf("isPendingQuickSendX || isPendingQuickSendTelegram"),
      social.indexOf("isPendingQuickSendX || isPendingQuickSendTelegram") + 600,
    );
    // Reuses the same confirmPanel class as the Approve confirmation (issue #380) rather than a new component.
    expect(quickSendPanelBlock).toContain("className={styles.confirmPanel}");
    expect(quickSendPanelBlock).toContain("this is exactly what will be sent");
  });

  it("clears a stale quick-send confirmation whenever the item's text, destinations, or expand state changes, same as approval", async () => {
    const social = await source("components", "social-hub.tsx");

    const clearFnBlock = social.slice(
      social.indexOf("function clearApprovalConfirmation"),
      social.indexOf("function clearApprovalConfirmation") + 500,
    );
    expect(clearFnBlock).toContain(
      "setPendingQuickSendId((current) => (current?.itemId === id ? null : current));",
    );

    // clearApprovalConfirmation is already wired into updateQueueItem, toggleItemDestination and
    // toggleQueueItemExpanded (issue #380) — extending it covers quick-send for free, no separate wiring needed.
    const updateQueueItemBlock = social.slice(social.indexOf("function updateQueueItem"), social.indexOf("function updateQueueItem") + 400);
    expect(updateQueueItemBlock).toContain("clearApprovalConfirmation(id);");
  });

  it("computes isPendingQuickSendX/isPendingQuickSendTelegram per card from the shared pendingQuickSendId state", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain(
      'const isPendingQuickSendX = pendingQuickSendId?.itemId === item.id && pendingQuickSendId.platform === "x";',
    );
    expect(social).toContain('pendingQuickSendId.platform === "telegram";');
  });
});
