import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Approval integrity: one tap, template badging, reschedule (issue #380, one-tap approvals 6 Sep 2026)", () => {
  it("Approve is ONE tap through handleApproveClick — the two-tap confirm was removed on owner direction; quick-send keeps its confirm", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("function handleApproveClick(item: QueueItem)");
    const handlerBlock = social.slice(social.indexOf("function handleApproveClick"), social.indexOf("function handleApproveClick") + 200);
    expect(handlerBlock).toContain("void approveQueueItem(item);");
    expect(handlerBlock).not.toContain("setPendingApprovalItemId");
    expect(social).not.toContain("pendingApprovalItemId");
    // Approve is not blocked while an unrelated card is approving; only its own row shows the progress label.
    expect(social).toContain("const isApproving = approvingItemId === item.id;");
  });

  it("clears a stale quick-send confirmation and template acknowledgement whenever the item's text or expand state changes", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("function clearApprovalConfirmation(id: string)");
    const updateQueueItemBlock = social.slice(social.indexOf("function updateQueueItem"), social.indexOf("function updateQueueItem") + 400);
    expect(updateQueueItemBlock).toContain("clearApprovalConfirmation(id);");
    const toggleExpandedBlock = social.slice(social.indexOf("function toggleQueueItemExpanded"), social.indexOf("function toggleQueueItemExpanded") + 200);
    expect(toggleExpandedBlock).toContain("clearApprovalConfirmation(id);");
  });

  it("the quick-send confirm panel still names the exact destination before an immediate publish", async () => {
    const social = await source("components", "social-hub.tsx");
    expect(social).toContain("className={styles.confirmPanel}");
    expect(social).toContain("this is exactly what will be sent");
  });

  it("marks unedited canned template copy with a persistent badge and refuses to approve it without the explicit checkbox", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("import {");
    expect(social).toContain("isUneditedTemplateText,");
    expect(social).toContain("const templateOutputs = useMemo(");
    expect(social).toContain("const xIsTemplate = isUneditedTemplateText(item.xText, templateOutputs);");
    expect(social).toContain("const telegramIsTemplate = isUneditedTemplateText(item.telegramText, templateOutputs);");
    // Persistent badge, visible even collapsed.
    expect(social).toContain('{isTemplateItem ? <span className={styles.templateBadge}>Template</span> : null}');
    // Explicit acknowledgement checkbox, inline on the expanded card, and enforced in approveQueueItem itself.
    expect(social).toContain("This is unedited template text — I want to send it as-is.");
    expect(social).toContain("const requiresTemplateAck = sendingTemplate && !templateAcknowledged;");
    const approveBlock = social.slice(social.indexOf("async function approveQueueItem"), social.indexOf("async function approveQueueItem") + 2000);
    expect(approveBlock).toContain("if (sendingTemplate && !templateAcknowledgedIds[item.id]) {");
  });

  it("decides the schedule at approve time (not item-creation time) unless the user picked their own, and never in the past", async () => {
    const social = await source("components", "social-hub.tsx");

    expect(social).toContain("const [scheduleManuallySet, setScheduleManuallySet] = useState<Record<string, boolean>>({});");
    const approveBlock = social.slice(social.indexOf("async function approveQueueItem"), social.indexOf("async function approveQueueItem") + 5200);
    expect(approveBlock).toContain("scheduleManuallySet[item.id] && itemScheduledAt[item.id]");
    expect(approveBlock).toContain("computeDefaultScheduledAt(awaitingIso, now, cadenceSpreadHoursMs(postingCadence))");
    expect(approveBlock).toContain("ensureFutureScheduledAt(picked, now)");

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
