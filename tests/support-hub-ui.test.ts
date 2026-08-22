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
    // "Mark as resolved" alone must not close the ticket. Renamed from
    // "Close this report" (issue #405) to read distinctly from the
    // collapse/expand chevron, which never calls an API.
    expect(component).toContain("closeConfirmId");
    expect(component).toContain("setCloseConfirmId(ticket.id)");
    expect(component).toContain("Mark as resolved — I&apos;m done with this");
    expect(component).toContain("This closes the report. It does not just hide this box.");
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

  it("gives ticket cards an explicit collapse/expand chevron that only ever touches local UI state, never an API (issue #405)", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toMatch(/className=\{expanded \? styles\.chevronExpanded : styles\.chevron\}/);
    expect(component).toContain("never calls an API, unlike \"Mark as resolved\" below");

    const css = await source("components", "support-hub.module.css");
    expect(css).toContain(".chevron");
    expect(css).toContain(".chevronExpanded");
  });

  it("adds a corner X to the success card that does exactly the same reset/dismiss as Done, both 44px-safe (issue #405)", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toMatch(/className=\{styles\.successDismissX\}\s*onClick=\{handleDone\}/);
    expect(component).toContain('<button type="button" className={styles.doneButton} onClick={handleDone}>');

    const css = await source("components", "support-hub.module.css");
    expect(css).toMatch(/\.successDismissX\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s);
  });
});

describe("Support hub client crash hardening (issue #405)", () => {
  it("defines a safeInvoke helper and uses it to guard every non-user-initiated browser/extension API call", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain("function safeInvoke(fn: () => void): void {");

    // Wallet-extension listener (un)registration — an extension's on/removeListener
    // implementation is not guaranteed not to throw synchronously.
    expect(component).toContain('safeInvoke(() => provider.on?.("accountsChanged", handleAccountsChanged));');
    expect(component).toContain('safeInvoke(() => provider.removeListener?.("accountsChanged", handleAccountsChanged));');

    // The 60s visible-only timer's listener setup/cleanup and clearInterval.
    expect(component).toContain('safeInvoke(() => document.addEventListener("visibilitychange", handleBecameVisible));');
    expect(component).toContain('safeInvoke(() => window.addEventListener("focus", handleBecameVisible));');
    expect(component).toContain('safeInvoke(() => document.removeEventListener("visibilitychange", handleBecameVisible));');
    expect(component).toContain('safeInvoke(() => window.removeEventListener("focus", handleBecameVisible));');
    expect(component).toContain("safeInvoke(() => clearInterval(id));");

    // Done/X dismissal's scrollIntoView.
    expect(component).toContain("safeInvoke(() => historyRef.current?.scrollIntoView({ behavior: \"smooth\", block: \"start\" }));");
  });

  it("narrows an untrusted accountsChanged payload to a single string address instead of trusting Array.isArray alone", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain("function firstStringAccount(accounts: unknown): string | undefined {");
    expect(component).toContain("if (!Array.isArray(accounts)) return undefined;");
    expect(component).toContain('typeof first === "string" && first ? first : undefined;');
    expect(component).toContain("const nextAccount = firstStringAccount(accounts);");
  });

  it("contains screenshot object-URL/canvas/FileReader failures instead of letting an onload/onerror callback throw uncaught", async () => {
    const component = await source("components", "support-hub.tsx");
    // loadImageFromFile: createObjectURL, image.src assignment, and both
    // onload/onerror bodies are each wrapped.
    expect(component).toMatch(/try \{\s*objectUrl = URL\.createObjectURL\(file\);\s*\} catch \{/);
    expect(component).toMatch(/image\.onload = \(\) => \{\s*safeInvoke\(\(\) => URL\.revokeObjectURL\(objectUrl\)\);\s*try \{/);
    expect(component).toMatch(/try \{\s*image\.src = objectUrl;\s*\} catch \{/);
    // readFileAsDataUrl: FileReader construction and readAsDataURL are wrapped.
    expect(component).toMatch(/try \{\s*reader = new FileReader\(\);\s*\} catch \{/);
    expect(component).toMatch(/try \{\s*reader\.readAsDataURL\(file\);\s*\} catch \{/);
    // Canvas creation/draw/encode per compression step is wrapped and
    // continues to the next step rather than aborting the whole pass.
    expect(component).toMatch(/const canvas = document\.createElement\("canvas"\);[\s\S]*?\} catch \{[\s\S]*?continue;/);
  });

  it("contains the hidden file-input click, showing a plain error instead of an uncaught throw", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toMatch(
      /try \{\s*attachmentInputRef\.current\?\.click\(\);\s*\} catch \{\s*setAttachmentError\("The file picker could not be opened\. Try again\."\);/,
    );
  });

  it("resets the file input value defensively, and guards the timer visibility check", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toMatch(/safeInvoke\(\(\) => \{\s*event\.target\.value = "";\s*\}\);/);
    expect(component).toContain("function isPageVisible(): boolean {");
    expect(component).toMatch(/if \(!isPageVisible\(\)\) \{\s*stopTimer\(\);/);
  });
});
