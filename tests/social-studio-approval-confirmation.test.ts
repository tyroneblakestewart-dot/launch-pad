import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Approval integrity: confirm-before-sign, template badging, reschedule (issue #380)", () => {
  it("Approve is a two-tap action gated through handleApproveClick, not an immediate sign", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("function handleApproveClick(item: QueueItem)");
    expect(social).toContain("const [pendingApprovalItemId, setPendingApprovalItemId] = useState<string | null>(null);");
    // The first tap force-expands the card and sets pending state, without calling approveQueueItem.
    const handlerBlock = social.slice(social.indexOf("function handleApproveClick"), social.indexOf("function handleApproveClick") + 1200);
    expect(handlerBlock).toContain("setExpandedQueueItemIds((current) => ({ ...current, [item.id]: true }));");
    expect(handlerBlock).toContain("setPendingApprovalItemId(item.id);");
    expect(handlerBlock).toContain("void approveQueueItem(item);");
  });

  it("clears a stale confirmation whenever the item's text, destinations, or expand state changes", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("function clearApprovalConfirmation(id: string)");
    const updateQueueItemBlock = social.slice(social.indexOf("function updateQueueItem"), social.indexOf("function updateQueueItem") + 400);
    expect(updateQueueItemBlock).toContain("clearApprovalConfirmation(id);");
    const toggleDestinationBlock = social.slice(social.indexOf("function toggleItemDestination"), social.indexOf("function toggleItemDestination") + 400);
    expect(toggleDestinationBlock).toContain("clearApprovalConfirmation(itemId);");
    const toggleExpandedBlock = social.slice(social.indexOf("function toggleQueueItemExpanded"), social.indexOf("function toggleQueueItemExpanded") + 200);
    expect(toggleExpandedBlock).toContain("clearApprovalConfirmation(id);");
  });

  it("shows a confirm panel naming exactly which destinations will receive the visible text before signing", async () => {
    const social = await source("components", "social-hub.tsx");
    expect(social).toContain("className={styles.confirmPanel}");
    expect(social).toContain("this is exactly what each destination will receive");
  });

  it("marks unedited canned template copy with a persistent badge and gates its approval on an explicit checkbox", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("import {");
    expect(social).toContain("isUneditedTemplateText,");
    expect(social).toContain("const templateOutputs = useMemo(");
    expect(social).toContain("const xIsTemplate = isUneditedTemplateText(item.xText, templateOutputs);");
    expect(social).toContain("const telegramIsTemplate = isUneditedTemplateText(item.telegramText, templateOutputs);");
    // Persistent badge, visible even collapsed — not only inside the confirm step.
    expect(social).toContain('{isTemplateItem ? <span className={styles.templateBadge}>Template</span> : null}');
    // Explicit, non-blocking acknowledgement checkbox.
    expect(social).toContain("This is unedited template text — I want to send it as-is.");
    expect(social).toContain("const requiresTemplateAck = isPendingApproval && selectedTextIsTemplate && !templateAcknowledged;");
  });

  it("recomputes the default schedule at approve time (not item-creation time) unless the user picked their own", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("const [scheduleManuallySet, setScheduleManuallySet] = useState<Record<string, boolean>>({});");
    const handlerBlock = social.slice(social.indexOf("function handleApproveClick"), social.indexOf("function handleApproveClick") + 1200);
    expect(handlerBlock).toContain("if (!scheduleManuallySet[item.id]) {");
    expect(handlerBlock).toContain("computeDefaultScheduledAt(awaitingIso, new Date(), cadenceSpreadHoursMs(postingCadence))");

    // needs_composer must not permanently anchor the spread (it never sends automatically).
    expect(social).toContain(
      "scheduledPosts.filter((post) => isPendingSendStatus(post.status)).map((post) => post.scheduledAt);",
    );
  });

  it("adds a reschedule control to an already-approved, still-scheduled post", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("async function reschedulePost(post: ScheduledPostSummary)");
    expect(social).toContain('fetch("/api/social/posts/reschedule"');
    expect(social).toContain("SOCIAL_STUDIO_ACTION_PURPOSES.postReschedule");
    expect(social).toContain("postReschedule: \"social:post-reschedule\",");
    expect(social).toContain("Save new time");
  });

  it("the reschedule API route implements the move as cancel-old + create-new via the existing store's own methods", async () => {
    const route = await source("app", "api", "social", "posts", "reschedule", "route.ts");

    expect(route).toContain('purpose: "social:post-reschedule"');
    expect(route).toContain("await store.cancel(postId, authorisation.walletAddress);");
    expect(route).toContain("await store.create({");
  });

  it("the posts route replaces a duplicate approval instead of creating a second row, via existing store methods only", async () => {
    const route = await source("app", "api", "social", "posts", "route.ts");

    expect(route).toContain("import { findDuplicateScheduledPost } from \"@/lib/server/social-post-duplicate-detection\";");
    expect(route).toContain("const duplicate = findDuplicateScheduledPost(");
    expect(route).toContain("await store.cancel(duplicate.id, authorisation.walletAddress);");
    expect(route).toContain("replacedPostId: duplicate?.id ?? null");
  });
});
