import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Support hub UI (issue #393)", () => {
  it("is reachable at /support", async () => {
    const page = await source("app", "(app)", "support", "page.tsx");
    expect(page).toContain("SupportHub");
  });

  it("resolves its hero chrome through the Pages CMS registry (CLAUDE.md rule 10)", async () => {
    const page = await source("app", "(app)", "support", "page.tsx");
    expect(page).toContain('resolvePageContent("support"');
    expect(page).toContain("heroEyebrow");
    expect(page).toContain("heroTitle");
    expect(page).toContain("heroIntro");

    const registry = await source("lib", "page-content-registry.ts");
    expect(registry).toContain('id: "support"');
  });

  it("collects category, subject and description", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain("CATEGORY_OPTIONS");
    expect(component).toContain("setSubject");
    expect(component).toContain("setBody");
  });

  it("submits with a wallet-signed support:ticket-create challenge", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain('"support:ticket-create"');
    expect(component).toContain("/api/support/challenge");
    expect(component).toContain("/api/support/tickets");
  });

  it("offers an optional screenshot attachment, restricted to PNG/JPEG/WEBP, with a remove control (issue #398)", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain("Add a screenshot (optional)");
    expect(component).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(component).toContain("handleScreenshotChange");
    expect(component).toContain("removeAttachment");
  });

  it("binds the attachment to the signed payload with a SHA-256 image hash, computed the same way the server does (issue #398)", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain("sha256Hex");
    expect(component).toContain("imageHash");
    expect(component).toContain('crypto.subtle.digest("SHA-256"');
  });

  it("lets a user post a wallet-signed follow-up with support:ticket-reply", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain('"support:ticket-reply"');
    expect(component).toContain("/reply");
  });

  it("is reachable from the account overlay's 'Report a problem' link (issue #393) and, as of issue #396, the main nav too", async () => {
    const overlay = await source("components", "account-overlay.tsx");
    expect(overlay).toContain('href="/support"');
    expect(overlay).toContain("Report a problem");

    const navigation = await source("components", "app-navigation.tsx");
    expect(navigation).toContain('href: "/support"');
  });

  it("is mobile-first and safe at a 390px iPhone Safari viewport (CLAUDE.md rule 7)", async () => {
    const css = await source("components", "support-hub.module.css");
    expect(css).toContain("@media (max-width: 390px)");
    expect(css).toContain("min-width: 0");
    expect(css).not.toMatch(/width:\s*\d{4,}px/);
  });

  it("reacts to an accountsChanged event so ticket history follows the active wallet (issue #393 review)", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain('provider.on?.("accountsChanged"');
    expect(component).toContain('provider.removeListener?.("accountsChanged"');
    expect(component).toContain("setWalletAddress(nextAccount || null)");
  });

  it("gives every actionable control a real 44px touch target (issue #393 review)", async () => {
    const css = await source("components", "support-hub.module.css");
    const minHeightCount = (css.match(/min-height:\s*44px/g) || []).length;
    // connectButton/submitButton, select/input/textarea, ticketSummary, replyButton.
    expect(minHeightCount).toBeGreaterThanOrEqual(4);

    const overlayCss = await source("components", "account-overlay.module.css");
    expect(overlayCss).toContain(".supportLink");
    expect(overlayCss).toMatch(/\.supportLink\s*\{[^}]*min-height:\s*44px/s);
  });

  it("offers a Done control on the success state that resets the form and scrolls to Your reports (issue #401)", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain("function handleDone()");
    expect(component).toContain("historyRef.current?.scrollIntoView");
    // Resets every field the New report form tracks, not just subject/body.
    expect(component).toMatch(/function handleDone\(\)[\s\S]*?setSubmitted\(false\)/);
    expect(component).toMatch(/function handleDone\(\)[\s\S]*?setCategory\("other"\)/);
    expect(component).toMatch(/function handleDone\(\)[\s\S]*?setSubject\(""\)/);
    expect(component).toMatch(/function handleDone\(\)[\s\S]*?setBody\(""\)/);
    expect(component).toMatch(/function handleDone\(\)[\s\S]*?setAttachmentDataUrl\(null\)/);
    expect(component).toContain('<button type="button" className={styles.doneButton} onClick={handleDone}>');

    const css = await source("components", "support-hub.module.css");
    expect(css).toContain(".doneButton");
    expect(css).toMatch(/\.doneButton\s*\{[^}]*min-height:\s*44px/s);
  });

  it("lets a user close their own open/needs_user ticket with a wallet-signed support:ticket-close action, gated behind a two-tap confirm (issue #401)", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain('"support:ticket-close"');
    expect(component).toContain("/api/support/tickets/${encodeURIComponent(ticketId)}/close");
    expect(component).toContain("async function handleClose(ticketId: string)");

    // One tap to request, a second, separate tap to confirm — a mis-tap on
    // "Close this report" alone must not close the ticket.
    expect(component).toContain("closeConfirmId");
    expect(component).toContain("setCloseConfirmId(ticket.id)");
    expect(component).toContain("Close this report");
    expect(component).toContain("Confirm close");
    expect(component).toContain("Cancel");
    expect(component).toContain("void handleClose(ticket.id)");

    // Gated to REPLYABLE_STATUSES — a solved/closed ticket never offers a
    // close action, and the reply composer already hides for the same set.
    expect(component).toContain("styles.closeRow");
    const replyableGateCount = (component.match(/REPLYABLE_STATUSES\.has\(ticket\.status\)/g) || []).length;
    expect(replyableGateCount).toBeGreaterThanOrEqual(2);

    const css = await source("components", "support-hub.module.css");
    expect(css).toContain(".closeRequestButton");
    expect(css).toContain(".closeConfirmButton");
    expect(css).toMatch(/\.closeRequestButton\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/\.closeConfirmButton\s*\{[^}]*min-height:\s*44px/s);
  });
});
