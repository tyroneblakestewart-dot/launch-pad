import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...parts), "utf8");
}

/**
 * Owner report, 7 Sep 2026: a token launched from the studio never appeared
 * on the homepage and showed no artwork. Two causes in this modal: the
 * artwork was read from an index entry that has not carried it since issue
 * #307, and a failed listing request was a one-line warning with no way
 * back — the token was live on-chain and simply lost to the grid.
 */
describe("studio launch: a failed listing is loud and recoverable", () => {
  it("keeps the listing request after a failure and clears it only once recorded", async () => {
    const controller = await source("components", "robinhood-testnet-deployment-controller.tsx");
    expect(controller).toContain("const [pendingRecord, setPendingRecord] = useState<PendingRecord | null>(null);");
    const attempt = controller.slice(controller.indexOf("const pending: PendingRecord = {"), controller.indexOf("return {\n      contractAddress: tokenAddress,"));
    expect(attempt).toContain("setPendingRecord(pending);");
    expect(attempt).toContain("await recordTokenLaunch(walletClient, account, pending, artworkThumbnail);\n      setPendingRecord(null);");
    // A fresh deployment never inherits an earlier launch's pending request.
    expect(controller).toContain("setResult(null);\n    setMismatch(null);\n    setPendingRecord(null);");
  });

  it("retries with one signature and no on-chain step, re-reading the artwork rather than keeping it in state", async () => {
    const controller = await source("components", "robinhood-testnet-deployment-controller.tsx");
    const retry = controller.slice(controller.indexOf("async function retryRecordListing() {"), controller.indexOf("async function deploy() {"));
    expect(retry).toContain("if (!pendingRecord || recordRetryBusy) return;");
    expect(retry).toContain("const [account] = await walletClient.getAddresses();");
    expect(retry).not.toContain("deployContract");
    expect(retry).not.toContain("writeContract");
    expect(retry).toContain("const artworkThumbnail = project ? await captureProjectArtworkThumbnail(project) : null;");
    expect(retry).toContain("await recordTokenLaunch(walletClient, account, pendingRecord, artworkThumbnail);");
    expect(retry).toContain("setPendingRecord(null);");
    expect(retry).toContain("recordWarning: undefined");
    expect(retry).toContain("recordWarning: reason");
    // Never threaded into React state (CLAUDE.md's PR #118 iPhone Safari memory rule).
    expect(controller).not.toMatch(/setArtwork\w*\(/);
  });

  it("reports the reason to the client-error store /admin already reads, without ever blocking the launch", async () => {
    const controller = await source("components", "robinhood-testnet-deployment-controller.tsx");
    const report = controller.slice(controller.indexOf("function reportListingFailure("), controller.indexOf("async function retryRecordListing() {"));
    expect(report).toContain('void fetch("/api/client-errors", {');
    expect(report).toContain("keepalive: true,");
    expect(report).toContain("message: `Token launch listing could not be recorded (${tokenAddress}): ${reason}`,");
    expect(report).toContain('routePath: window.location.pathname || "/",');
    expect(report).toContain(".catch(() => undefined);");
    // Called on the first failure and on a failed retry.
    expect(controller.match(/reportListingFailure\(/g)).toHaveLength(3);
  });

  it("shows the reason, a Record listing button and the test-lab fallback in the result panel", async () => {
    const controller = await source("components", "robinhood-testnet-deployment-controller.tsx");
    const panel = controller.slice(controller.indexOf("{result.recordWarning && ("), controller.indexOf("<footer>"));
    expect(panel).toContain("<div className={styles.recordWarningBox}>");
    expect(panel).toContain("Launched on-chain, but the homepage listing could not be recorded yet: {result.recordWarning}");
    expect(panel).toContain("Your token is live. Record the listing now — one signature, no new deployment.");
    expect(panel).toContain("onClick={retryRecordListing}");
    expect(panel).toContain("disabled={!pendingRecord || recordRetryBusy}");
    expect(panel).toContain('{recordRetryBusy ? "CHECK YOUR WALLET…" : "RECORD LISTING"}');
    expect(panel).toContain('<a href="/testnet" target="_blank" rel="noreferrer">');
    const css = await source("components", "robinhood-testnet-deployment-controller.module.css");
    expect(css).toContain(".recordWarningBox {");
    expect(css).toContain(".recordRetryButton {");
    expect(css).toContain("  .recordRetryButton { min-height: 44px; }");
  });
});
