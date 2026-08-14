import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function gateSource() {
  return readFile(path.join(ROOT, "components", "build-site-gate.tsx"), "utf8");
}

function refreshBody(gate: string): string {
  const start = gate.indexOf("function refresh(fromPoll = false) {");
  const end = gate.indexOf("\n    function onGenerated(event: Event) {", start);
  return gate.slice(start, end);
}

// Issue #323 part 2.5: the 250ms poll used to rewrite the checklist
// innerHTML on every tick, even when nothing changed, and even while the
// visitor was typing — a contributor to the page-skipping bug reported on
// iPhone. Only the routine poll is guarded by input focus; every real
// state-change call site (generated/failed/reopen) still applies
// immediately.
describe("BuildSiteGate refresh() only mutates the DOM when content changed (issue #323 part 2.5)", () => {
  it("only rewrites the checklist innerHTML when its content actually changed", async () => {
    const gate = await gateSource();
    const body = refreshBody(gate);

    expect(body).toContain("if (checklistHtml !== lastChecklistHtml) {");
    expect(body).toContain("checklist.innerHTML = checklistHtml;");
    expect(body).toContain("lastChecklistHtml = checklistHtml;");
  });

  it("skips the poll-triggered refresh while a builder-panel text input has focus, unless readiness flipped", async () => {
    const gate = await gateSource();
    const body = refreshBody(gate);

    expect(body).toContain("const readinessFlipped = ready !== lastReady;");
    expect(body).toContain(
      "if (fromPoll && !readinessFlipped && isBuilderTextInputFocused(elements.panel)) return;",
    );
    expect(gate).toContain("function isBuilderTextInputFocused(panel: Element): boolean {");
  });

  it("marks only the routine 250ms poll as fromPoll — every event-driven refresh() call still applies immediately", async () => {
    const gate = await gateSource();

    expect(gate).toContain("const interval = window.setInterval(() => refresh(true), 250);");
    // The direct calls below are event-driven (real state changes), not
    // polling, so they must NOT pass fromPoll=true.
    expect(gate).toContain("refresh();");
    expect(gate).toContain("window.requestAnimationFrame(() => refresh());");
    expect((gate.match(/refresh\(true\)/g) || []).length).toBe(1);
  });
});
