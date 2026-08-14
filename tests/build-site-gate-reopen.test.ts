import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function gateSource() {
  return readFile(path.join(ROOT, "components", "build-site-gate.tsx"), "utf8");
}

describe("BuildSiteGate unlocks and scrolls to a reopened saved site (issue #311)", () => {
  it("imports the shared reopen event and wires/unwires a listener for it", async () => {
    const gate = await gateSource();

    expect(gate).toContain(
      'import { REOPEN_GENERATED_SITE_EVENT } from "@/components/full-website-generator"',
    );
    expect(gate).toContain("function onReopen()");
    expect(gate).toContain("window.addEventListener(REOPEN_GENERATED_SITE_EVENT, onReopen)");
    expect(gate).toContain("window.removeEventListener(REOPEN_GENERATED_SITE_EVENT, onReopen)");

    const addIndex = gate.indexOf("window.addEventListener(REOPEN_GENERATED_SITE_EVENT, onReopen)");
    const removeIndex = gate.indexOf("window.removeEventListener(REOPEN_GENERATED_SITE_EVENT, onReopen)");
    const returnIndex = gate.indexOf("return () => {");
    expect(addIndex).toBeLessThan(returnIndex);
    expect(removeIndex).toBeGreaterThan(returnIndex);
  });

  function onReopenBody(gate: string): string {
    const start = gate.indexOf("function onReopen() {");
    const end = gate.indexOf("\n    }\n", start);
    return gate.slice(start, end);
  }

  it("unlocks the gate and stops any in-flight generation state", async () => {
    const gate = await gateSource();
    const body = onReopenBody(gate);

    expect(body).toContain("clearGenerationTimeout();");
    expect(body).toContain("generating = false;");
    expect(body).toContain("unlocked = true;");
  });

  it("clears the lock class and hides the overlay synchronously, without waiting on the readiness-gated refresh()", async () => {
    // Root cause 1: refresh() re-derives `unlocked` from the live builder-panel
    // DOM ("if (!ready) unlocked = false;"), but the reopen event fires
    // synchronously before React has re-rendered those inputs with the
    // reopened project's values. Calling refresh() immediately could read the
    // *previous* project's stale/incomplete fields and instantly re-lock. The
    // overlay/lock class must therefore be cleared directly, and the
    // readiness recompute deferred to the next frame.
    const gate = await gateSource();
    const body = onReopenBody(gate);

    expect(body).toContain('elements.previewPanel.classList.remove("site-builder-locked")');
    expect(body).toContain("overlay.hidden = true;");
    // Not `requestAnimationFrame(refresh)` directly (issue #323 part 2.5):
    // rAF invokes its callback with a high-res timestamp, which would land
    // in refresh's new `fromPoll` parameter and wrongly apply the
    // input-focus poll guard to this real, event-driven reopen refresh.
    expect(body).toContain("window.requestAnimationFrame(() => refresh());");
  });

  it("scrolls the preview panel into view, matching the fresh-generation path", async () => {
    const gate = await gateSource();
    const generatedStart = gate.indexOf("function onGenerated(event: Event) {");
    const generatedEnd = gate.indexOf("function onFailed(event: Event) {");
    const onGeneratedBody = gate.slice(generatedStart, generatedEnd);
    const reopenBody = onReopenBody(gate);

    const scrollCall = '.scrollIntoView({ behavior: "smooth", block: "start" })';
    expect(onGeneratedBody).toContain(scrollCall);
    expect(reopenBody).toContain(scrollCall);
  });

  it("leaves the fresh-generation unlock/scroll behaviour untouched (regression)", async () => {
    const gate = await gateSource();
    const generatedStart = gate.indexOf("function onGenerated(event: Event) {");
    const generatedEnd = gate.indexOf("function onFailed(event: Event) {");
    const onGeneratedBody = gate.slice(generatedStart, generatedEnd);

    expect(onGeneratedBody).toContain("const next = finishSitePreviewGeneration();");
    expect(onGeneratedBody).toContain("unlocked = next.unlocked;");
    expect(onGeneratedBody).toContain("refresh();");
  });
});
