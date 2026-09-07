import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Queue tab draft-card action row (issue #356)", () => {
  it("sources X and Telegram brand marks from one shared component, not inline duplicate paths", async () => {
    const brandIcons = await source("components", "brand-icons.tsx");
    const social = await source("components", "social-hub.tsx");

    expect(brandIcons).toContain("export function XMark(");
    expect(brandIcons).toContain("export function TelegramMark(");

    // The old inline, generic (non-official) Telegram paper-plane path is gone.
    expect(social).not.toContain("function XIcon()");
    expect(social).not.toContain("function TelegramIcon()");
    expect(social).not.toContain("M21.94 4.3 18.9 19.1");

    // social-hub.tsx uses the shared components everywhere it shows a brand mark.
    expect(social).toContain('import { TelegramMark, XMark } from "@/components/brand-icons";');
    expect(social).not.toContain("<XIcon");
    expect(social).not.toContain("<TelegramIcon");
    expect(social).toContain("<XMark />");
    expect(social).toContain("<TelegramMark />");
  });

  it("ships an official Telegram brand asset alongside the existing X one", async () => {
    const telegramSvg = await source("public", "logos", "telegram.svg");
    const xSvg = await source("public", "logos", "x.svg");

    expect(telegramSvg).toContain("<svg");
    expect(telegramSvg).toContain("viewBox=");
    expect(xSvg).toContain("<svg");
  });

  it("gives each Queue tab draft-card action its own hierarchy class instead of four equal-weight tiles", async () => {
    const social = await source("components", "social-hub.tsx");

    const actionsBlock = social.slice(social.indexOf("styles.queueItemActions"), social.indexOf("styles.queueItemActions") + 2200);

    expect(social).toContain("className={styles.queueItemActions}");
    expect(actionsBlock).toContain("className={styles.queueActionApprove}");
    expect(actionsBlock).toContain("className={styles.queueActionSecondary}");
    expect(actionsBlock).toContain("className={styles.queueActionDelete}");

    // Approve is still primary and still disabled with nowhere to send, mid-request, or pending an
    // unedited-template acknowledgement (one-tap approvals, 6 Sep 2026: the shared approveDisabled /
    // approveLabel are computed once per card and used by both the row and the card button).
    expect(actionsBlock).toContain("disabled={approveDisabled}");
    expect(actionsBlock).toContain("{approveLabel}");
    expect(social).toContain("const approveDisabled = isApproving || destinations.length === 0 || requiresTemplateAck;");
    expect(social).toContain('const approveLabel = isApproving ? (postImageBusyId === item.id ? "Making the image…" : "Approving…") : "Approve";');

    // Post to X / Send to Telegram keep their brand marks inline beside the label, but are now a
    // two-tap quick-send confirm step through handleQuickSendClick, same pattern as Approve (issue #382).
    expect(actionsBlock).toContain('onClick={() => handleQuickSendClick(item, "x")}');
    expect(actionsBlock).toContain('onClick={() => handleQuickSendClick(item, "telegram")}');
    expect(actionsBlock).toContain('<XMark /> {isPendingQuickSendX ? "Confirm & post to X" : "Post to X"}');
    expect(actionsBlock).toContain(
      '<TelegramMark /> {isPendingQuickSendTelegram ? "Confirm & send to Telegram" : "Send to Telegram"}',
    );

    // Delete is unchanged behaviourally.
    expect(actionsBlock).toContain("onClick={() => removeQueueItem(item.id)}");

    // The disabled-destinations explanatory copy is preserved.
    expect(social).toContain("Connect X or Telegram in Setup before approving a post.");
  });

  it("keeps the announcement composer's plain button rows on their own unrelated class", async () => {
    const social = await source("components", "social-hub.tsx");

    // Regression guard: the Queue tab restyle must not have been done by
    // repurposing .composerActions, which the Calendar's announcement
    // composer (Setup's Compose now until 7 Sep 2026) still uses.
    expect(social).toContain('<div className={styles.composerActions}>\n                                  <button type="button" className={styles.ownPostAdd} onClick={() => void postNowToTelegram()} disabled={busy}>');
  });

  it("sizes brand marks for an inline row (14-16px) and keeps every action's touch target at least 44px even though the visible row is shorter", async () => {
    const css = await source("components", "social-hub.module.css");

    const rowBlock = css.slice(css.indexOf(".queueItemActions {"), css.indexOf(".statusPill {"));

    expect(rowBlock).toContain(".queueItemActions svg { width: 14px; height: 14px;");
    expect(rowBlock).toContain("min-height: 38px;");

    // A pseudo-element expands the hit area beyond the visible ~38px box to a 44px+ touch target.
    expect(rowBlock).toContain("::after");
    expect(rowBlock).toContain("inset: -4px;");
  });

  it("applies the plan-card lime primary / ghost secondary / quiet-then-red-destructive hierarchy", async () => {
    const css = await source("components", "social-hub.module.css");
    const rowBlock = css.slice(css.indexOf(".queueItemActions {"), css.indexOf(".statusPill {"));

    // Approve: the shared solid-lime CTA recipe (token page rule: solid, never a gradient; owner direction 4 Sep 2026).
    expect(rowBlock).toContain(".queueActionApprove {");
    expect(rowBlock).toContain("background: var(--cta-bg);");

    // Post to X / Send to Telegram: ghost/outline secondary.
    expect(rowBlock).toContain(".queueActionSecondary {");
    expect(rowBlock).toContain("border: 1px solid rgba(198, 245, 62, 0.28);");
    expect(rowBlock).toContain("background: rgba(255, 255, 255, 0.03);");

    // Delete: quiet by default, red only on hover/focus.
    expect(rowBlock).toContain(".queueActionDelete {");
    expect(rowBlock).toContain("color: #7f8780;");
    expect(rowBlock).toContain(".queueActionDelete:hover,");
    expect(rowBlock).toContain("color: #ff8080;");

    // Disabled states stay visually distinct, not just faded.
    expect(rowBlock).toContain(".queueActionApprove:disabled {");
    expect(rowBlock).toContain(".queueActionSecondary:disabled {");
  });
});
